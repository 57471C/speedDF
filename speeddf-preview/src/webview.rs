//! WebView2 child of the preview HWND. One environment per process, created
//! against %LOCALAPPDATA%\speedDF\preview-wv2\<pid>\. A failed create leaves the
//! GDI text on the same HWND.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU8, Ordering};
use std::time::{Duration, Instant};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, GetAvailableCoreWebView2BrowserVersionString,
    COREWEBVIEW2_WEB_ERROR_STATUS, ICoreWebView2, ICoreWebView2Controller,
    ICoreWebView2DownloadStartingEventArgs, ICoreWebView2Environment,
    ICoreWebView2EnvironmentOptions, ICoreWebView2NavigationCompletedEventArgs,
    ICoreWebView2NavigationStartingEventArgs,
    ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2_4,
};
use webview2_com::{
    CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler, DownloadStartingEventHandler,
    NavigationCompletedEventHandler, NavigationStartingEventHandler, NewWindowRequestedEventHandler,
};
use windows::core::{BOOL, Error, HRESULT, Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_FAIL, E_POINTER, HWND, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::InvalidateRect;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetClientRect, IsWindow, MsgWaitForMultipleObjects,
    PeekMessageW, PostQuitMessage, TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT, WM_QUIT,
};

use crate::handler::PreviewState;
use crate::logutil::log_event;
use crate::paint::state_from_hwnd;

const BUSY_HR: i32 = 0x8007_00AA_u32 as i32;
const PUMP_LIMIT: Duration = Duration::from_millis(3000);
const OWNER_WAIT: Duration = Duration::from_millis(1200);
const BUSY_WAIT: Duration = Duration::from_millis(700);

static ENV_OWNER: AtomicU32 = AtomicU32::new(0);
static ENV_FAILED: AtomicI32 = AtomicI32::new(0);
static ENV_STARTING: AtomicBool = AtomicBool::new(false);
static CONTROLLERS: AtomicU32 = AtomicU32::new(0);
static BUSY_USED: AtomicU8 = AtomicU8::new(0);
static LABELED: AtomicBool = AtomicBool::new(false);
static LOGGED_DIR: AtomicBool = AtomicBool::new(false);

thread_local! {
    static IN_PUMP: Cell<bool> = const { Cell::new(false) };
    static IN_START: Cell<bool> = const { Cell::new(false) };
    static ALLOW_DATA: Cell<bool> = const { Cell::new(false) };
    static LOCAL_ENV: RefCell<Option<ICoreWebView2Environment>> = const { RefCell::new(None) };
}

pub(crate) struct WebSession {
    pub controller: Option<ICoreWebView2Controller>,
    pub generation: u64,
    pub pending: bool,
    pub failed: bool,
    pub navigated_epoch: u64,
    pub html_nav_id: u64,
    pub capture_nav: bool,
    pub nav_fixups: u8,
}

impl Default for WebSession {
    fn default() -> Self {
        Self {
            controller: None,
            generation: 1,
            pending: false,
            failed: false,
            navigated_epoch: 0,
            html_nav_id: 0,
            capture_nav: false,
            nav_fixups: 0,
        }
    }
}

pub(crate) fn present(hwnd: HWND, state: &RefCell<PreviewState>) {
    if !alive_window(hwnd) || state.borrow().html.is_empty() || state.borrow().web.failed {
        return;
    }
    if show_current(state) {
        return;
    }
    if IN_PUMP.with(|flag| flag.get()) {
        kick(hwnd, state);
        return;
    }
    IN_PUMP.with(|flag| flag.set(true));
    let _guard = PumpGuard;
    let started = Instant::now();
    while started.elapsed() < PUMP_LIMIT {
        if settled(state) {
            return;
        }
        kick(hwnd, state);
        if settled(state) {
            return;
        }
        pump_slice();
    }
    if !settled(state) {
        log_event("WebView", "timeout paint=gdi", 0);
        close(state);
        if alive_window(hwnd) {
            let _ = unsafe { InvalidateRect(Some(hwnd), None, true) };
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
    if !alive_window(window) {
        return;
    }
    let _ = unsafe { controller.SetBounds(client_rect(window)) };
}

pub(crate) fn close(state: &RefCell<PreviewState>) {
    let controller = {
        let mut guard = state.borrow_mut();
        guard.web.generation = guard.web.generation.wrapping_add(1);
        guard.web.pending = false;
        guard.web.navigated_epoch = 0;
        guard.web.html_nav_id = 0;
        guard.web.capture_nav = false;
        guard.web.nav_fixups = 0;
        guard.web.controller.take()
    };
    if let Some(controller) = controller {
        let _ = unsafe { controller.Close() };
        release_controller_slot();
    }
}

struct PumpGuard;

impl Drop for PumpGuard {
    fn drop(&mut self) {
        IN_PUMP.with(|flag| flag.set(false));
    }
}

fn settled(state: &RefCell<PreviewState>) -> bool {
    let guard = state.borrow();
    if guard.web.failed {
        return true;
    }
    guard.web.controller.is_some()
        && !guard.web.pending
        && guard.web.navigated_epoch == guard.html_epoch
}

fn show_current(state: &RefCell<PreviewState>) -> bool {
    let (controller, epoch, navigated, pending, hwnd, nav_id, capture) = {
        let guard = state.borrow();
        (
            guard.web.controller.clone(),
            guard.html_epoch,
            guard.web.navigated_epoch,
            guard.web.pending,
            guard.hwnd,
            guard.web.html_nav_id,
            guard.web.capture_nav,
        )
    };
    let Some(controller) = controller else {
        return false;
    };
    if pending {
        return false;
    }
    if hwnd != 0 {
        let window = hwnd_from(hwnd);
        if alive_window(window) {
            let _ = unsafe { controller.SetBounds(client_rect(window)) };
            let _ = unsafe { controller.SetIsVisible(true) };
        }
    }
    if navigated == epoch || capture || (nav_id != 0 && navigated != epoch) {
        return true;
    }
    let webview = match unsafe { controller.CoreWebView2() } {
        Ok(webview) => webview,
        Err(err) => {
            mark_failed(state, "fallback core", err.code().0);
            return true;
        }
    };
    if let Err(err) = send_html(state, &webview) {
        mark_failed(state, "fallback navigate", err.code().0);
    }
    true
}

fn kick(hwnd: HWND, state: &RefCell<PreviewState>) {
    if state.borrow().web.failed || show_current(state) {
        return;
    }
    let failed = ENV_FAILED.load(Ordering::Acquire);
    if failed != 0 {
        let detail = if failed == BUSY_HR {
            "fallback busy"
        } else {
            "fallback env"
        };
        mark_failed(state, detail, failed);
        return;
    }
    if state.borrow().web.pending {
        return;
    }
    if let Some(environment) = fetch_env() {
        spawn_controller(hwnd, state, environment);
        return;
    }
    start_env(hwnd, state);
}

fn start_env(hwnd: HWND, state: &RefCell<PreviewState>) {
    if IN_START.with(|flag| flag.get()) {
        return;
    }
    if let Some(environment) = fetch_env() {
        spawn_controller(hwnd, state, environment);
        return;
    }
    if ENV_FAILED.load(Ordering::Acquire) != 0 {
        return;
    }
    IN_START.with(|flag| flag.set(true));
    let _guard = StartGuard;
    let owner = ENV_OWNER.load(Ordering::Acquire);
    let me = unsafe { GetCurrentThreadId() };
    if owner != 0 && owner != me {
        log_event("WebView", "wait-owner", 0);
        let started = Instant::now();
        while ENV_OWNER.load(Ordering::Acquire) != 0 && started.elapsed() < OWNER_WAIT {
            pump_slice();
        }
    }
    if let Some(environment) = fetch_env() {
        spawn_controller(hwnd, state, environment);
        return;
    }
    if ENV_STARTING.swap(true, Ordering::AcqRel) {
        return;
    }
    let dir = match user_data_dir() {
        Ok(dir) => dir,
        Err(hr) => {
            ENV_STARTING.store(false, Ordering::Release);
            ENV_FAILED.store(hr, Ordering::Release);
            mark_failed(state, "fallback user-data", hr);
            return;
        }
    };
    if !runtime_available() {
        ENV_STARTING.store(false, Ordering::Release);
        let hr = 0x8007_0002_u32 as i32;
        ENV_FAILED.store(hr, Ordering::Release);
        mark_failed(state, "fallback runtime-missing", hr);
        return;
    }
    let hwnd_bits = hwnd.0 as isize;
    let generation = state.borrow().web.generation;
    let wide = wide_null(&dir);
    let options = CoreWebView2EnvironmentOptions::default();
    unsafe {
        options.set_exclusive_user_data_folder_access(true);
        // prevhost is Low IL. The GPU process and renderer code-integrity check
        // never finish a navigation there, so the pane stays on about:blank.
        options.set_additional_browser_arguments(
            "--disable-gpu --disable-features=RendererCodeIntegrity".to_string(),
        );
    }
    let options: ICoreWebView2EnvironmentOptions = options.into();
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
            &options,
            &handler,
        )
    };
    match started {
        Ok(()) => log_event("WebView", "begin", 0),
        Err(err) => {
            ENV_STARTING.store(false, Ordering::Release);
            on_environment(hwnd_bits, generation, Err(err), None);
        }
    }
}

fn on_environment(
    hwnd_bits: isize,
    generation: u64,
    result: windows::core::Result<()>,
    environment: Option<ICoreWebView2Environment>,
) {
    let hwnd = hwnd_from(hwnd_bits);
    match result {
        Ok(()) => {
            let Some(environment) = environment else {
                ENV_STARTING.store(false, Ordering::Release);
                ENV_FAILED.store(E_POINTER.0, Ordering::Release);
                if let Some(state) = live_state(hwnd, generation) {
                    mark_failed(state, "fallback env-null", E_POINTER.0);
                }
                return;
            };
            publish_env(&environment);
            ENV_STARTING.store(false, Ordering::Release);
            if let Some(state) = live_state(hwnd, generation) {
                spawn_controller(hwnd, state, environment);
            }
        }
        Err(err) => {
            ENV_STARTING.store(false, Ordering::Release);
            let hr = err.code().0;
            if hr == BUSY_HR && take_busy_retry() {
                log_event("WebView", "retry busy", hr);
                let started = Instant::now();
                while started.elapsed() < BUSY_WAIT {
                    pump_slice();
                }
                if let Some(state) = live_state(hwnd, generation) {
                    start_env(hwnd, state);
                }
                return;
            }
            ENV_FAILED.store(hr, Ordering::Release);
            let detail = if hr == BUSY_HR {
                "fallback busy"
            } else {
                "fallback env"
            };
            if let Some(state) = live_state(hwnd, generation) {
                mark_failed(state, detail, hr);
            } else {
                log_event("WebView", &format!("{detail} paint=gdi"), hr);
            }
        }
    }
}

fn spawn_controller(hwnd: HWND, state: &RefCell<PreviewState>, environment: ICoreWebView2Environment) {
    if state.borrow().web.controller.is_some() {
        state.borrow_mut().web.pending = false;
        return;
    }
    if state.borrow().web.pending {
        return;
    }
    let generation = {
        let mut guard = state.borrow_mut();
        guard.web.pending = true;
        guard.web.generation
    };
    let hwnd_bits = hwnd.0 as isize;
    let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
        move |result, controller| {
            on_controller(hwnd_bits, generation, result, controller);
            Ok(())
        },
    ));
    if let Err(err) = unsafe { environment.CreateCoreWebView2Controller(hwnd, &handler) } {
        if let Some(state) = live_state(hwnd, generation) {
            state.borrow_mut().web.pending = false;
            fail_controller(hwnd, state, err.code().0);
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
                state.borrow_mut().web.pending = false;
                fail_controller(hwnd, state, err.code().0);
            }
            return;
        }
    };
    let Some(controller) = controller else {
        if let Some(state) = live_state(hwnd, generation) {
            state.borrow_mut().web.pending = false;
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
    watch_navigation(&webview, hwnd_bits, generation);
    {
        let mut guard = state.borrow_mut();
        guard.web.controller = Some(controller);
        guard.web.pending = false;
    }
    CONTROLLERS.fetch_add(1, Ordering::AcqRel);
    if let Err(err) = send_html(state, &webview) {
        mark_failed(state, "fallback navigate", err.code().0);
    }
}

fn fail_controller(hwnd: HWND, state: &RefCell<PreviewState>, hr: i32) {
    if hr == BUSY_HR && take_busy_retry() {
        log_event("WebView", "retry busy", hr);
        if let Some(environment) = fetch_env() {
            spawn_controller(hwnd, state, environment);
            return;
        }
    }
    let detail = if hr == BUSY_HR {
        "fallback busy"
    } else {
        "fallback controller-hr"
    };
    mark_failed(state, detail, hr);
}

fn take_busy_retry() -> bool {
    BUSY_USED
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

struct StartGuard;

impl Drop for StartGuard {
    fn drop(&mut self) {
        IN_START.with(|flag| flag.set(false));
    }
}

fn publish_env(environment: &ICoreWebView2Environment) {
    LOCAL_ENV.with(|slot| *slot.borrow_mut() = Some(environment.clone()));
    ENV_OWNER.store(unsafe { GetCurrentThreadId() }, Ordering::Release);
}

fn fetch_env() -> Option<ICoreWebView2Environment> {
    LOCAL_ENV.with(|slot| slot.borrow().clone())
}

fn release_controller_slot() {
    if CONTROLLERS.fetch_sub(1, Ordering::AcqRel) == 1 {
        release_env_if_owner();
    }
}

fn release_env_if_owner() {
    let me = unsafe { GetCurrentThreadId() };
    if ENV_OWNER.load(Ordering::Acquire) != me {
        return;
    }
    LOCAL_ENV.with(|slot| *slot.borrow_mut() = None);
    ENV_OWNER.store(0, Ordering::Release);
    ENV_STARTING.store(false, Ordering::Release);
    log_event("WebView", "release", 0);
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
    if let Ok(newer) = webview.cast::<ICoreWebView2_4>() {
        let mut download = 0i64;
        let _ = unsafe {
            newer.add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(|_sender, args| {
                    block_download(args);
                    Ok(())
                })),
                &mut download,
            )
        };
    }
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
        let scheme = text.split(':').next().unwrap_or("").chars().take(16).collect::<String>();
        log_event("WebView", &format!("cancel scheme={scheme}"), 0);
        let _ = unsafe { args.SetCancel(true) };
    }
}

fn block_popup(args: Option<ICoreWebView2NewWindowRequestedEventArgs>) {
    if let Some(args) = args {
        let _ = unsafe { args.SetHandled(true) };
    }
}

fn block_download(args: Option<ICoreWebView2DownloadStartingEventArgs>) {
    if let Some(args) = args {
        let _ = unsafe { args.SetCancel(true) };
        let _ = unsafe { args.SetHandled(true) };
    }
}

fn should_cancel(uri: &str) -> bool {
    let lower = uri.trim().to_ascii_lowercase();
    if lower.is_empty() || lower.starts_with("about:") {
        return false;
    }
    // NavigateToString is a data:text/html navigation. Allow only the one
    // send_html just started. Later data:, file:, and network navigations cancel.
    if lower.starts_with("data:text/html") && ALLOW_DATA.with(|flag| flag.replace(false)) {
        return false;
    }
    true
}

fn watch_navigation(webview: &ICoreWebView2, hwnd_bits: isize, generation: u64) {
    let mut starting = 0i64;
    let _ = unsafe {
        webview.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
                capture_nav_id(hwnd_bits, generation, args);
                Ok(())
            })),
            &mut starting,
        )
    };
    let mut completed = 0i64;
    let _ = unsafe {
        webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_sender, args| {
                on_nav_completed(hwnd_bits, generation, args);
                Ok(())
            })),
            &mut completed,
        )
    };
}

fn capture_nav_id(
    hwnd_bits: isize,
    generation: u64,
    args: Option<ICoreWebView2NavigationStartingEventArgs>,
) {
    let Some(args) = args else {
        return;
    };
    let mut id = 0u64;
    if unsafe { args.NavigationId(&mut id) }.is_err() {
        return;
    }
    let Some(state) = live_state(hwnd_from(hwnd_bits), generation) else {
        return;
    };
    let mut guard = state.borrow_mut();
    if guard.web.capture_nav {
        guard.web.html_nav_id = id;
        guard.web.capture_nav = false;
    }
}

fn on_nav_completed(
    hwnd_bits: isize,
    generation: u64,
    args: Option<ICoreWebView2NavigationCompletedEventArgs>,
) {
    let Some(args) = args else {
        return;
    };
    let mut id = 0u64;
    if unsafe { args.NavigationId(&mut id) }.is_err() {
        return;
    }
    let mut success = BOOL::default();
    let _ = unsafe { args.IsSuccess(&mut success) };
    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS(0);
    let _ = unsafe { args.WebErrorStatus(&mut status) };
    let hwnd = hwnd_from(hwnd_bits);
    let Some(state) = live_state(hwnd, generation) else {
        return;
    };
    let (matches, epoch, fixups, tracked) = {
        let guard = state.borrow();
        (
            id == guard.web.html_nav_id && guard.web.html_nav_id != 0,
            guard.html_epoch,
            guard.web.nav_fixups,
            guard.web.html_nav_id != 0,
        )
    };
    if !tracked {
        return;
    }
    if matches && success.as_bool() {
        state.borrow_mut().web.navigated_epoch = epoch;
        log_event("WebView", "ready paint=webview", 0);
        return;
    }
    log_event(
        "WebView",
        &format!("nav-fail id={id} status={}", status.0),
        0,
    );
    if fixups >= 1 {
        return;
    }
    state.borrow_mut().web.nav_fixups = fixups.saturating_add(1);
    let webview = {
        let guard = state.borrow();
        let Some(controller) = guard.web.controller.clone() else {
            return;
        };
        match unsafe { controller.CoreWebView2() } {
            Ok(webview) => webview,
            Err(err) => {
                drop(guard);
                mark_failed(state, "fallback core", err.code().0);
                return;
            }
        }
    };
    if let Err(err) = send_html(state, &webview) {
        mark_failed(state, "fallback navigate", err.code().0);
    }
}

fn send_html(state: &RefCell<PreviewState>, webview: &ICoreWebView2) -> Result<(), Error> {
    let html = {
        let mut guard = state.borrow_mut();
        guard.web.capture_nav = true;
        guard.web.navigated_epoch = 0;
        guard.html.clone()
    };
    ALLOW_DATA.with(|flag| flag.set(true));
    let result = navigate(webview, &html);
    if result.is_ok() {
        log_event("WebView", "navigate paint=webview", 0);
    }
    result
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
        release_controller_slot();
    }
    let detail = if detail.contains("paint=") {
        detail.to_string()
    } else {
        format!("{detail} paint=gdi")
    };
    log_event("WebView", &detail, hr);
}

fn live_state(hwnd: HWND, generation: u64) -> Option<&'static RefCell<PreviewState>> {
    if !alive_window(hwnd) {
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

fn user_data_dir() -> Result<PathBuf, i32> {
    let local = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty());
    let Some(local) = local else {
        return Err(E_FAIL.0);
    };
    let speed_df = PathBuf::from(local).join("speedDF");
    let base = speed_df.join("preview-wv2");
    let dir = base.join(std::process::id().to_string());
    // The preview-wv2 root is created at medium integrity and labeled Low.
    // Low IL prevhost must not CreateDirectory that medium parent: create_dir_all
    // turns ERROR_ALREADY_EXISTS plus a failed stat into 0x800700B7. Create only
    // the per-pid folder. If the root is missing, create one level at a time.
    match ensure_dir(&dir) {
        Ok(()) => {}
        Err(hr) if hr == HRESULT::from_win32(3).0 => {
            let _ = ensure_dir(&speed_df);
            ensure_dir(&base)?;
            ensure_dir(&dir)?;
        }
        Err(hr) => return Err(hr),
    }
    if !LABELED.swap(true, Ordering::AcqRel) {
        for path in [&base, &dir] {
            let _ = std::process::Command::new("icacls")
                .arg(path)
                .args(["/setintegritylevel", "(OI)(CI)L"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x0800_0000)
                .status();
        }
    }
    if !LOGGED_DIR.swap(true, Ordering::AcqRel) {
        log_event(
            "WebView",
            &format!("user-data pid={}", std::process::id()),
            0,
        );
    }
    Ok(dir)
}

fn ensure_dir(path: &std::path::Path) -> Result<(), i32> {
    match std::fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(err)
            if err.kind() == std::io::ErrorKind::AlreadyExists || err.raw_os_error() == Some(183) =>
        {
            Ok(())
        }
        Err(err) => Err(io_code(err)),
    }
}

fn io_code(err: std::io::Error) -> i32 {
    let code = err.raw_os_error().unwrap_or(5);
    if code <= 0 {
        E_FAIL.0
    } else {
        HRESULT::from_win32(code as u32).0
    }
}

fn pump_slice() {
    unsafe {
        let mut msg = MSG::default();
        for _ in 0..32 {
            if !PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                break;
            }
            if msg.message == WM_QUIT {
                PostQuitMessage(wparam_i32(msg.wParam));
                return;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = MsgWaitForMultipleObjects(None, false, 15, QS_ALLINPUT);
    }
}

fn wparam_i32(value: WPARAM) -> i32 {
    value.0 as i32
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

fn alive_window(hwnd: HWND) -> bool {
    !hwnd.is_invalid() && unsafe { IsWindow(Some(hwnd)) }.as_bool()
}
