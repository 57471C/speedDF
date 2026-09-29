use std::cell::RefCell;

use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateFontIndirectW, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint,
    FillRect, SelectObject, SetBkMode, SetTextColor, DT_LEFT, DT_NOPREFIX, DT_TOP, DT_WORDBREAK,
    FONT_QUALITY, HDC, HFONT, LOGFONTW, TRANSPARENT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DefWindowProcW, GetClientRect, GetWindowLongPtrW, SetWindowLongPtrW, CREATESTRUCTW,
    GWLP_USERDATA, WM_ERASEBKGND, WM_NCCREATE, WM_NCDESTROY, WM_PAINT,
};

use crate::handler::PreviewState;

/// RGB(11, 110, 79) stored as COLORREF (0x00BBGGRR).
pub const PREVIEW_BG: u32 = 0x004F_6E_0B;
const PREVIEW_FG: u32 = 0x00FF_FFFF;

pub(crate) unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wnd_proc_inner(hwnd, msg, wparam, lparam)
    }));
    run.unwrap_or(LRESULT(0))
}

fn wnd_proc_inner(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_NCCREATE => {
            let cs = unsafe { &*(lparam.0 as *const CREATESTRUCTW) };
            unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, cs.lpCreateParams as isize) };
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_NCDESTROY => {
            if let Some(state) = state_ptr(hwnd) {
                if let Ok(mut guard) = state.try_borrow_mut() {
                    if guard.hwnd == hwnd.0 as isize {
                        guard.hwnd = 0;
                    }
                }
            }
            unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_ERASEBKGND => {
            let hdc = HDC(wparam.0 as *mut core::ffi::c_void);
            fill_background(hwnd, hdc);
            LRESULT(1)
        }
        WM_PAINT => {
            let text = read_text(hwnd);
            let mut ps = windows::Win32::Graphics::Gdi::PAINTSTRUCT::default();
            let hdc = unsafe { BeginPaint(hwnd, &mut ps) };
            if !hdc.is_invalid() {
                fill_background(hwnd, hdc);
                draw_text(hwnd, hdc, &text);
            }
            let _ = unsafe { EndPaint(hwnd, &ps) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn state_ptr(hwnd: HWND) -> Option<&'static RefCell<PreviewState>> {
    let raw = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const RefCell<PreviewState>;
    if raw.is_null() {
        None
    } else {
        Some(unsafe { &*raw })
    }
}

fn read_text(hwnd: HWND) -> String {
    state_ptr(hwnd)
        .map(|state| state.borrow().text.clone())
        .unwrap_or_default()
}

fn fill_background(hwnd: HWND, hdc: HDC) {
    if hdc.is_invalid() {
        return;
    }
    let mut rect = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut rect) };
    let brush = unsafe { CreateSolidBrush(COLORREF(PREVIEW_BG)) };
    if !brush.is_invalid() {
        unsafe { FillRect(hdc, &rect, brush) };
        unsafe { let _ = DeleteObject(brush.into()); }
    }
}

fn draw_text(hwnd: HWND, hdc: HDC, text: &str) {
    if hdc.is_invalid() || text.is_empty() {
        return;
    }
    let mut rect = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut rect) };
    rect.left += 16;
    rect.top += 16;
    rect.right -= 16;
    rect.bottom -= 16;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return;
    }

    unsafe {
        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, COLORREF(PREVIEW_FG));
    }

    let font = make_font();
    let previous = if font.is_invalid() {
        None
    } else {
        Some(unsafe { SelectObject(hdc, font.into()) })
    };

    let mut wide: Vec<u16> = text.encode_utf16().collect();
    if !wide.is_empty() {
        unsafe {
            DrawTextW(
                hdc,
                &mut wide,
                &mut rect,
                DT_LEFT | DT_TOP | DT_WORDBREAK | DT_NOPREFIX,
            );
        }
    }

    if let Some(previous) = previous {
        unsafe { SelectObject(hdc, previous) };
    }
    if !font.is_invalid() {
        unsafe { let _ = DeleteObject(font.into()); }
    }
}

fn make_font() -> HFONT {
    let mut lf = LOGFONTW::default();
    lf.lfHeight = -20;
    lf.lfWeight = 400;
    lf.lfQuality = FONT_QUALITY(5);
    for (index, unit) in "Segoe UI".encode_utf16().take(31).enumerate() {
        lf.lfFaceName[index] = unit;
    }
    unsafe { CreateFontIndirectW(&lf) }
}
