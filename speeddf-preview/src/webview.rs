//! WebView2 child of the preview HWND. A missing runtime or a failed create
//! leaves the GDI text in place. CoCreate does not depend on this module.

use std::cell::RefCell;
use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, GetAvailableCoreWebView2BrowserVersionString,
    ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Environment,
    ICoreWebView2EnvironmentOptions, ICoreWebView2NavigationStartingEventArgs,
    ICoreWebView2NewWindowRequestedEventArgs,
};
use webview2_com::{
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    NavigationStartingEventHandler, NewWindowRequestedEventHandler,
};
use windows::core::{Error, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_FAIL, E_POINTER, HWND, RECT};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, IsWindow};

use crate::handler::PreviewState;
use crate::logutil::log_event;
use crate::paint::state_from_hwnd;

pub(crate) struct WebSession {
    pub controller: Option<ICoreWebView2Controller>,
    pub generation: u64,
    pub pending: bool,
    pub failed: bool,
}

impl Default for WebSession {
    fn default() -> Self {
        Self {
            controller: None,
            generation: 1,
            pending: false,
            failed: false,
        }
    }
}

pub(crate) fn attach(hwnd: HWND, state: &RefCell<PreviewState>) {
    // WebView2 is only for the in-process host.exe test. prevhost and Outlook
    // stay on the GDI/DirectWrite paint and never call CreateCoreWebView2*.
    if !crate::logutil::host_exe().eq_ignore_ascii_case("host.exe") {
        let log_skip = {
            let mut guard = state.borrow_mut();
            if guard.web.failed {
                false
            } else {
                guard.web.failed = true;
                true
            }
        };
        if log_skip {
            log_event("WebView", "skipped paint=gdi", 0);
        }
        return;
    }
    {
        let guard = state.borrow();
        if guard.web.failed || guard.web.pending || guard.web.controller.is_some() || guard.html.is_empty()
        {
            return;
        }
    }
    if !runtime_available() {
        mark_failed(state, "fallback runtime-missing", 0x8007_0002_u32 as i32);
        return;
    }
    let dir = match user_data_dir() {
        Ok(dir) => dir,
        Err(_) => {
            mark_failed(state, "fallback user-data", E_FAIL.0);
            return;
        }
    };
    let generation = {
        let mut guard = state.borrow_mut();
        guard.web.pending = true;
        guard.web.generation
    };
    let hwnd_bits = hwnd.0 as isize;
    let wide = wide_null(&dir);
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |result, environment| {
            on_environment(hwnd_bits, generation, result, environment);
            Ok(())
        },
    ));
    let started = unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            PCWSTR(wide.as_ptr()),
            None::<&ICoreWebView2EnvironmentOptions>,
            &handler,
        )
    };
    match started {
        Ok(()) => log_event("WebView", "begin", 0),
        Err(err) => {
            let mut guard = state.borrow_mut();
            guard.web.pending = false;
            guard.web.failed = true;
            log_event("WebView", "fallback create-env paint=gdi", err.code().0);
        }
    }
}

pub(crate) fn resize(state: &RefCell<PreviewState>) {
    let (hwnd, controller) = {
        let guard = state.borrow();
        (guard.hwnd, guard.web.controller.clone())
    };
    let Some(controller) = controller else {
        return;
    };
    if hwnd == 0 {
        return;
    }
    let window = hwnd_from(hwnd);
    if !unsafe { IsWindow(Some(window)) }.as_bool() {
        return;
    }
    let _ = unsafe { controller.SetBounds(client_rect(window)) };
}

pub(crate) fn close(state: &RefCell<PreviewState>) {
    let controller = {
        let mut guard = state.borrow_mut();
        guard.web.generation = guard.web.generation.wrapping_add(1);
        guard.web.pending = false;
        guard.web.controller.take()
    };
    if let Some(controller) = controller {
        let _ = unsafe { controller.Close() };
    }
}

fn on_environment(
    hwnd_bits: isize,
    generation: u64,
    result: windows::core::Result<()>,
    environment: Option<ICoreWebView2Environment>,
) {
    let hwnd = hwnd_from(hwnd_bits);
    if live_state(hwnd, generation).is_none() {
        return;
    }
    let environment = match result {
        Ok(()) => environment,
        Err(err) => {
            if let Some(state) = live_state(hwnd, generation) {
                mark_failed(state, "fallback env", err.code().0);
            }
            return;
        }
    };
    let Some(environment) = environment else {
        if let Some(state) = live_state(hwnd, generation) {
            mark_failed(state, "fallback env-null", E_POINTER.0);
        }
        return;
    };
    let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
        move |result, controller| {
            on_controller(hwnd_bits, generation, result, controller);
            Ok(())
        },
    ));
    if let Err(err) = unsafe { environment.CreateCoreWebView2Controller(hwnd, &handler) } {
        if let Some(state) = live_state(hwnd, generation) {
            mark_failed(state, "fallback controller", err.code().0);
        }
    }
}

fn on_controller(
    hwnd_bits: isize,
    generation: u64,
    result: windows::core::Result<()>,
    controller: Option<ICoreWebView2Controller>,
) {
    let hwnd = hwnd_from(hwnd_bits);
    let controller = match result {
        Ok(()) => controller,
        Err(err) => {
            if let Some(state) = live_state(hwnd, generation) {
                mark_failed(state, "fallback controller-hr", err.code().0);
            }
            return;
        }
    };
    let Some(controller) = controller else {
        if let Some(state) = live_state(hwnd, generation) {
            mark_failed(state, "fallback controller-null", E_POINTER.0);
        }
        return;
    };
    let Some(state) = live_state(hwnd, generation) else {
        let _ = unsafe { controller.Close() };
        return;
    };
    let _ = unsafe { controller.SetBounds(client_rect(hwnd)) };
    let _ = unsafe { controller.SetIsVisible(true) };
    let webview = match unsafe { controller.CoreWebView2() } {
        Ok(webview) => webview,
        Err(err) => {
            let _ = unsafe { controller.Close() };
            mark_failed(state, "fallback core", err.code().0);
            return;
        }
    };
    harden(&webview);
    let html = state.borrow().html.clone();
    {
        let mut guard = state.borrow_mut();
        guard.web.controller = Some(controller);
        guard.web.pending = false;
    }
    if let Err(err) = navigate(&webview, &html) {
        close(state);
        mark_failed(state, "fallback navigate", err.code().0);
        return;
    }
    log_event("WebView", "ready paint=webview", 0);
}

fn harden(webview: &ICoreWebView2) {
    if let Ok(settings) = unsafe { webview.Settings() } {
        let _ = unsafe { settings.SetIsScriptEnabled(false) };
        let _ = unsafe { settings.SetAreDefaultScriptDialogsEnabled(false) };
        let _ = unsafe { settings.SetIsWebMessageEnabled(false) };
        let _ = unsafe { settings.SetAreDevToolsEnabled(false) };
        let _ = unsafe { settings.SetAreHostObjectsAllowed(false) };
        let _ = unsafe { settings.SetIsStatusBarEnabled(false) };
        let _ = unsafe { settings.SetAreDefaultContextMenusEnabled(false) };
    }
    let mut token = 0i64;
    let _ = unsafe {
        webview.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(|_sender, args| {
                block_navigation(args);
                Ok(())
            })),
            &mut token,
        )
    };
    let mut popup = 0i64;
    let _ = unsafe {
        webview.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(|_sender, args| {
                block_popup(args);
                Ok(())
            })),
            &mut popup,
        )
    };
}

fn block_navigation(args: Option<ICoreWebView2NavigationStartingEventArgs>) {
    let Some(args) = args else {
        return;
    };
    let mut uri = PWSTR::null();
    if unsafe { args.Uri(&mut uri) }.is_err() {
        return;
    }
    let text = pwstr_string(&uri);
    free_pwstr(uri);
    if should_cancel(&text) {
        let _ = unsafe { args.SetCancel(true) };
    }
}

fn block_popup(args: Option<ICoreWebView2NewWindowRequestedEventArgs>) {
    if let Some(args) = args {
        let _ = unsafe { args.SetHandled(true) };
    }
}

fn should_cancel(uri: &str) -> bool {
    let lower = uri.trim().to_ascii_lowercase();
    lower.starts_with("http:")
        || lower.starts_with("https:")
        || lower.starts_with("file:")
        || lower.starts_with("javascript:")
        || lower.starts_with("data:")
}

fn navigate(webview: &ICoreWebView2, html: &str) -> Result<(), Error> {
    let wide = wide_from_str(html);
    unsafe { webview.NavigateToString(PCWSTR(wide.as_ptr())) }
}

fn mark_failed(state: &RefCell<PreviewState>, detail: &str, hr: i32) {
    let controller = {
        let mut guard = state.borrow_mut();
        guard.web.pending = false;
        guard.web.failed = true;
        guard.web.controller.take()
    };
    if let Some(controller) = controller {
        let _ = unsafe { controller.Close() };
    }
    let detail = if detail.contains("paint=") {
        detail.to_string()
    } else {
        format!("{detail} paint=gdi")
    };
    log_event("WebView", &detail, hr);
}

fn live_state(hwnd: HWND, generation: u64) -> Option<&'static RefCell<PreviewState>> {
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return None;
    }
    let state = state_from_hwnd(hwnd)?;
    let guard = state.borrow();
    if guard.web.generation != generation || guard.hwnd != hwnd.0 as isize {
        return None;
    }
    drop(guard);
    Some(state)
}

fn runtime_available() -> bool {
    let mut version = PWSTR::null();
    let result = unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) };
    let ok = result.is_ok() && !version.is_null();
    free_pwstr(version);
    ok
}

fn user_data_dir() -> Result<PathBuf, ()> {
    // Low-IL prevhost gets %TEMP%\Low from GetTempPath, which it can write.
    let dir = std::env::temp_dir().join("speeddf-preview-wv2");
    std::fs::create_dir_all(&dir).map_err(|_| ())?;
    Ok(dir)
}

fn client_rect(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut rect) };
    if rect.right <= 0 {
        rect.right = 1;
    }
    if rect.bottom <= 0 {
        rect.bottom = 1;
    }
    rect
}

fn pwstr_string(value: &PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe { value.to_string() }.unwrap_or_default()
}

fn free_pwstr(value: PWSTR) {
    if !value.is_null() {
        unsafe { CoTaskMemFree(Some(value.0 as *const c_void)) };
    }
}

fn wide_null(path: &std::path::Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn wide_from_str(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn hwnd_from(value: isize) -> HWND {
    HWND(value as *mut c_void)
}
