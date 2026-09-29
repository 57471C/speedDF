use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use windows::core::{w, Error, HRESULT, IUnknown, Interface, Ref, GUID, BOOL};
use windows_core::implement;
use windows::Win32::Foundation::{
    E_FAIL, E_INVALIDARG, E_NOTIMPL, E_POINTER, E_UNEXPECTED, ERROR_CLASS_ALREADY_EXISTS,
    GetLastError, HINSTANCE, HWND, RECT, S_FALSE,
};
use windows::Win32::Graphics::Gdi::{InvalidateRect, UpdateWindow};
use windows::Win32::System::Com::{
    CoTaskMemFree, IStream, STATFLAG_DEFAULT, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::System::Ole::{
    IObjectWithSite, IObjectWithSite_Impl, IOleWindow, IOleWindow_Impl,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetFocus, SetFocus as FocusWindow};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IInitializeWithStream, IInitializeWithStream_Impl,
};
use windows::Win32::UI::Shell::{IPreviewHandler, IPreviewHandler_Impl};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetClientRect, GetParent, IsWindow, LoadCursorW, MoveWindow,
    RegisterClassW, SetWindowTextW, CS_HREDRAW, CS_VREDRAW, HMENU, IDC_ARROW, MSG,
    WINDOW_EX_STYLE, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
};

use crate::logutil::finish;
use crate::paint::wnd_proc;

pub(crate) static MODULE: AtomicIsize = AtomicIsize::new(0);
static CLASS_READY: AtomicBool = AtomicBool::new(false);

const PREVIEW_CHARS: usize = 80;

pub(crate) struct PreviewState {
    pub parent: isize,
    pub hwnd: isize,
    pub rect: RECT,
    pub text: String,
    pub stream: Option<IStream>,
    pub site: Option<IUnknown>,
    pub shown: bool,
}

impl Default for PreviewState {
    fn default() -> Self {
        Self {
            parent: 0,
            hwnd: 0,
            rect: RECT::default(),
            text: String::new(),
            stream: None,
            site: None,
            shown: false,
        }
    }
}

#[implement(
    Agile = false,
    IPreviewHandler,
    IInitializeWithStream,
    IOleWindow,
    IObjectWithSite
)]
pub(crate) struct PreviewHandler {
    state: RefCell<PreviewState>,
}

impl PreviewHandler {
    pub(crate) fn new() -> Self {
        crate::lock_inc();
        Self {
            state: RefCell::new(PreviewState::default()),
        }
    }
}

impl Drop for PreviewHandler {
    fn drop(&mut self) {
        let hwnd = {
            let mut state = self.state.borrow_mut();
            let hwnd = state.hwnd;
            state.hwnd = 0;
            state.stream = None;
            state.site = None;
            hwnd
        };
        destroy_hwnd(hwnd);
        crate::lock_dec();
    }
}

impl IInitializeWithStream_Impl for PreviewHandler_Impl {
    fn Initialize(&self, pstream: Ref<'_, IStream>, grfmode: u32) -> windows::core::Result<()> {
        let detail = format!("mode={grfmode} stream={}", !pstream.is_null());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.initialize_inner(pstream, grfmode)
        }));
        finish("Initialize", &detail, result)
    }
}

impl IPreviewHandler_Impl for PreviewHandler_Impl {
    fn SetWindow(&self, hwnd: HWND, prc: *const RECT) -> windows::core::Result<()> {
        let detail = describe_window(hwnd, prc);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.set_window_inner(hwnd, prc)
        }));
        finish("SetWindow", &detail, result)
    }

    fn SetRect(&self, prc: *const RECT) -> windows::core::Result<()> {
        let detail = describe_rect(prc);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.set_rect_inner(prc)));
        finish("SetRect", &detail, result)
    }

    fn DoPreview(&self) -> windows::core::Result<()> {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.do_preview_inner()));
        let detail = {
            let state = self.state.borrow();
            format!(
                "source_len={} hwnd=0x{:X}",
                state.text.chars().count(),
                state.hwnd as usize
            )
        };
        finish("DoPreview", &detail, result)
    }

    fn Unload(&self) -> windows::core::Result<()> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.unload_inner()));
        finish("Unload", "", result)
    }

    fn SetFocus(&self) -> windows::core::Result<()> {
        let hwnd = self.state.borrow().hwnd;
        if hwnd == 0 || !alive(hwnd) {
            return S_FALSE.ok();
        }
        let _ = unsafe { FocusWindow(Some(hwnd_from(hwnd))) };
        Ok(())
    }

    fn QueryFocus(&self) -> windows::core::Result<HWND> {
        let focus = unsafe { GetFocus() };
        if !focus.is_invalid() {
            return Ok(focus);
        }
        let hwnd = self.state.borrow().hwnd;
        if alive(hwnd) {
            Ok(hwnd_from(hwnd))
        } else {
            Ok(HWND::default())
        }
    }

    fn TranslateAccelerator(&self, pmsg: *const MSG) -> windows::core::Result<()> {
        if pmsg.is_null() {
            return Err(E_INVALIDARG.into());
        }
        // The spike does not handle accelerators. S_FALSE lets the host keep the key.
        S_FALSE.ok()
    }
}

impl IOleWindow_Impl for PreviewHandler_Impl {
    fn GetWindow(&self) -> windows::core::Result<HWND> {
        let state = self.state.borrow();
        if alive(state.hwnd) {
            Ok(hwnd_from(state.hwnd))
        } else if alive(state.parent) {
            Ok(hwnd_from(state.parent))
        } else {
            Err(E_FAIL.into())
        }
    }

    fn ContextSensitiveHelp(&self, _fentermode: BOOL) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }
}

impl IObjectWithSite_Impl for PreviewHandler_Impl {
    fn SetSite(&self, punksite: Ref<'_, IUnknown>) -> windows::core::Result<()> {
        self.state.borrow_mut().site = punksite.cloned();
        Ok(())
    }

    fn GetSite(&self, riid: *const GUID, ppvsite: *mut *mut core::ffi::c_void) -> windows::core::Result<()> {
        if riid.is_null() || ppvsite.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppvsite = std::ptr::null_mut() };
        let site = self.state.borrow().site.clone();
        let Some(site) = site else {
            return Err(E_FAIL.into());
        };
        unsafe { site.query(riid, ppvsite).ok() }
    }
}

impl PreviewHandler_Impl {
    fn initialize_inner(&self, pstream: Ref<'_, IStream>, _grfmode: u32) -> windows::core::Result<()> {
        if pstream.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let mut state = self.state.borrow_mut();
        if state.stream.is_some() {
            return Err(already_initialized());
        }
        state.stream = pstream.cloned();
        Ok(())
    }

    fn set_window_inner(&self, hwnd: HWND, prc: *const RECT) -> windows::core::Result<()> {
        if hwnd.is_invalid() || prc.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let rect = unsafe { *prc };
        let shown = {
            let mut state = self.state.borrow_mut();
            state.parent = hwnd.0 as isize;
            state.rect = rect;
            state.shown
        };
        if shown {
            self.ensure_child()?;
        }
        Ok(())
    }

    fn set_rect_inner(&self, prc: *const RECT) -> windows::core::Result<()> {
        if prc.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let rect = unsafe { *prc };
        let hwnd = {
            let mut state = self.state.borrow_mut();
            state.rect = rect;
            state.hwnd
        };
        if alive(hwnd) {
            // MoveWindow can dispatch WM_PAINT. The RefCell borrow is already dropped.
            move_child(hwnd_from(hwnd), rect);
        }
        Ok(())
    }

    fn do_preview_inner(&self) -> windows::core::Result<()> {
        let stream = {
            let state = self.state.borrow();
            if state.parent == 0 {
                return Err(E_UNEXPECTED.into());
            }
            state.stream.clone()
        };
        let Some(stream) = stream else {
            return Err(E_UNEXPECTED.into());
        };
        let text = preview_text(&stream);
        {
            let mut state = self.state.borrow_mut();
            state.text = text;
            state.shown = true;
        }
        self.ensure_child()?;
        let hwnd = self.state.borrow().hwnd;
        if alive(hwnd) {
            let hwnd = hwnd_from(hwnd);
            unsafe {
                let _ = InvalidateRect(Some(hwnd), None, true);
                let _ = UpdateWindow(hwnd);
            }
        }
        Ok(())
    }

    fn unload_inner(&self) -> windows::core::Result<()> {
        let hwnd = {
            let mut state = self.state.borrow_mut();
            let hwnd = state.hwnd;
            state.hwnd = 0;
            state.shown = false;
            state.stream = None;
            state.text.clear();
            hwnd
        };
        destroy_hwnd(hwnd);
        Ok(())
    }

    fn ensure_child(&self) -> windows::core::Result<()> {
        ensure_class()?;
        let state_ptr = &self.state as *const RefCell<PreviewState>;
        let (parent, rect, existing, text) = {
            let state = self.state.borrow();
            (state.parent, state.rect, state.hwnd, state.text.clone())
        };
        if !alive(parent) {
            return Err(E_UNEXPECTED.into());
        }
        let parent_hwnd = hwnd_from(parent);
        if alive(existing) {
            let hwnd = hwnd_from(existing);
            let current_parent = unsafe { GetParent(hwnd) }.unwrap_or_default();
            if current_parent == parent_hwnd {
                move_child(hwnd, rect);
                set_caption(hwnd, &text);
                return Ok(());
            }
            // The host handed us a new parent. Recreate the child with CreateWindowEx
            // rather than SetParent onto whatever window the host is.
            destroy_hwnd(existing);
            self.state.borrow_mut().hwnd = 0;
        }

        let placed = effective_rect(parent_hwnd, rect);
        let (width, height) = size_of(&placed);
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("SpeedDFPreviewPane"),
                w!(""),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                placed.left,
                placed.top,
                width.max(1),
                height.max(1),
                Some(parent_hwnd),
                None::<HMENU>,
                Some(module_instance()?),
                Some(state_ptr as *const core::ffi::c_void),
            )?
        };
        self.state.borrow_mut().hwnd = hwnd.0 as isize;
        set_caption(hwnd, &text);
        Ok(())
    }
}

pub(crate) fn module_instance() -> windows::core::Result<HINSTANCE> {
    let value = MODULE.load(Ordering::Relaxed);
    if value == 0 {
        Err(E_FAIL.into())
    } else {
        Ok(HINSTANCE(value as *mut core::ffi::c_void))
    }
}

fn ensure_class() -> windows::core::Result<()> {
    if CLASS_READY.load(Ordering::Acquire) {
        return Ok(());
    }
    let instance = module_instance()?;
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        hInstance: instance,
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW)? },
        lpszClassName: w!("SpeedDFPreviewPane"),
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        let err = unsafe { GetLastError() };
        if err.0 != ERROR_CLASS_ALREADY_EXISTS.0 {
            return Err(Error::from_hresult(HRESULT::from_win32(err.0)));
        }
    }
    CLASS_READY.store(true, Ordering::Release);
    Ok(())
}

fn preview_text(stream: &IStream) -> String {
    if let Some(name) = stream_file_name(stream) {
        let label = file_label(&name);
        if !label.is_empty() {
            return label;
        }
    }
    let body = content_prefix(stream, PREVIEW_CHARS);
    if body.is_empty() {
        "(empty)".to_string()
    } else {
        body
    }
}

fn stream_file_name(stream: &IStream) -> Option<String> {
    let mut stat = STATSTG::default();
    if unsafe { stream.Stat(&mut stat, STATFLAG_DEFAULT) }.is_err() {
        return None;
    }
    if stat.pwcsName.is_null() {
        return None;
    }
    let name = unsafe { stat.pwcsName.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(stat.pwcsName.0 as *const core::ffi::c_void)) };
    name.filter(|value| !value.trim().is_empty())
}

fn file_label(full: &str) -> String {
    full.rsplit(['\\', '/'])
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(full)
        .to_string()
}

fn content_prefix(stream: &IStream, max_chars: usize) -> String {
    let _ = unsafe { stream.Seek(0, STREAM_SEEK_SET, None) };
    let mut buf = vec![0u8; 512];
    let mut read = 0u32;
    let hr = unsafe {
        stream.Read(
            buf.as_mut_ptr() as *mut core::ffi::c_void,
            buf.len() as u32,
            Some(&mut read),
        )
    };
    if hr.is_err() {
        return String::new();
    }
    let bytes = &buf[..read as usize];
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars || ch == '\u{0}' {
            break;
        }
        out.push(ch);
    }
    out
}

fn effective_rect(parent: HWND, given: RECT) -> RECT {
    let (width, height) = size_of(&given);
    if width > 0 && height > 0 {
        return given;
    }
    let mut client = RECT::default();
    if unsafe { GetClientRect(parent, &mut client) }.is_ok() && client.right > 0 && client.bottom > 0
    {
        return client;
    }
    RECT {
        left: 0,
        top: 0,
        right: 320,
        bottom: 180,
    }
}

fn size_of(rect: &RECT) -> (i32, i32) {
    (
        rect.right.saturating_sub(rect.left),
        rect.bottom.saturating_sub(rect.top),
    )
}

fn move_child(hwnd: HWND, rect: RECT) {
    let parent = unsafe { GetParent(hwnd) }.unwrap_or_default();
    let placed = effective_rect(parent, rect);
    let (width, height) = size_of(&placed);
    unsafe {
        let _ = MoveWindow(
            hwnd,
            placed.left,
            placed.top,
            width.max(1),
            height.max(1),
            true,
        );
    }
}

fn set_caption(hwnd: HWND, text: &str) {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = SetWindowTextW(hwnd, windows::core::PCWSTR(wide.as_ptr()));
    }
}

fn destroy_hwnd(hwnd: isize) {
    if !alive(hwnd) {
        return;
    }
    unsafe {
        let _ = DestroyWindow(hwnd_from(hwnd));
    }
}

fn alive(hwnd: isize) -> bool {
    hwnd != 0 && unsafe { IsWindow(Some(hwnd_from(hwnd))) }.as_bool()
}

fn hwnd_from(value: isize) -> HWND {
    HWND(value as *mut core::ffi::c_void)
}

fn describe_window(hwnd: HWND, prc: *const RECT) -> String {
    format!("hwnd=0x{:X} {}", hwnd.0 as usize, describe_rect(prc))
}

fn describe_rect(prc: *const RECT) -> String {
    if prc.is_null() {
        "rect=null".to_string()
    } else {
        let rect = unsafe { *prc };
        format!(
            "rect={},{},{},{}",
            rect.left, rect.top, rect.right, rect.bottom
        )
    }
}

fn already_initialized() -> Error {
    // HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED) = 0x800704DF
    Error::from_hresult(HRESULT(0x8007_04DF_u32 as i32))
}
