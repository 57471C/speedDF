use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_ALPHA_MODE_IGNORE, D2D1_COLOR_F, D2D1_PIXEL_FORMAT,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, D2D1_DRAW_TEXT_OPTIONS_NONE,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES,
    D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1_RENDER_TARGET_USAGE_NONE,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT, DWRITE_FONT_WEIGHT_BOLD,
    DWRITE_FONT_WEIGHT_NORMAL, DWRITE_TEXT_RANGE,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateFontIndirectW, CreateSolidBrush, DeleteObject, EndPaint, FillRect, GdiFlush,
    GetTextExtentPoint32W, SelectObject, SetBkMode, SetTextColor, TextOutW, FONT_QUALITY, HDC,
    HFONT, LOGFONTW, TRANSPARENT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DefWindowProcW, GetClientRect, GetWindowLongPtrW, SetWindowLongPtrW, CREATESTRUCTW,
    GWLP_USERDATA, WM_ERASEBKGND, WM_NCCREATE, WM_NCDESTROY, WM_PAINT, WM_SIZE,
};

use windows_numerics::Vector2;

use crate::handler::PreviewState;
use crate::logutil::log_event;
use crate::markdown::{markdown_blocks, MdBlock, MdKind, MdRun};

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
        WM_SIZE => {
            if let Some(state) = state_ptr(hwnd) {
                crate::webview::resize(state);
            }
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_PAINT => {
            let (filename, text) = read_paint(hwnd);
            let mut ps = windows::Win32::Graphics::Gdi::PAINTSTRUCT::default();
            let hdc = unsafe { BeginPaint(hwnd, &mut ps) };
            if !hdc.is_invalid() {
                fill_background(hwnd, hdc);
                draw_text(hwnd, hdc, &filename, &text);
            }
            let _ = unsafe { EndPaint(hwnd, &ps) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

pub(crate) fn state_from_hwnd(hwnd: HWND) -> Option<&'static RefCell<PreviewState>> {
    state_ptr(hwnd)
}

fn state_ptr(hwnd: HWND) -> Option<&'static RefCell<PreviewState>> {
    let raw = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const RefCell<PreviewState>;
    if raw.is_null() {
        None
    } else {
        Some(unsafe { &*raw })
    }
}

fn read_paint(hwnd: HWND) -> (String, String) {
    state_ptr(hwnd)
        .map(|state| {
            let state = state.borrow();
            (state.filename.clone(), state.text.clone())
        })
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

fn draw_text(hwnd: HWND, hdc: HDC, filename: &str, source: &str) {
    if hdc.is_invalid() || (filename.is_empty() && source.is_empty()) {
        return;
    }
    let mut client = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut client) };
    let width = client.right.saturating_sub(client.left);
    let height = client.bottom.saturating_sub(client.top);
    if width < 8 || height < 8 {
        return;
    }
    if draw_directwrite(hdc, width, height, filename, source) {
        return;
    }
    let mut rect = client;
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
    let mut fonts = FontCache::default();
    if !filename.is_empty() {
        let header = MdBlock {
            kind: MdKind::Heading(2),
            runs: vec![MdRun {
                text: filename.to_string(),
                strong: true,
                code: false,
            }],
        };
        if !draw_block(hdc, &mut rect, &header, &mut fonts) {
            return;
        }
    }
    for block in markdown_blocks(source) {
        if !draw_block(hdc, &mut rect, &block, &mut fonts) {
            break;
        }
    }
}

fn draw_directwrite(hdc: HDC, width: i32, height: i32, filename: &str, source: &str) -> bool {
    match draw_directwrite_inner(hdc, width, height, filename, source) {
        Ok(()) => {
            note_directwrite(true, 0);
            true
        }
        Err(err) => {
            note_directwrite(false, err.code().0);
            false
        }
    }
}

fn note_directwrite(ok: bool, hr: i32) {
    static LOGGED: AtomicBool = AtomicBool::new(false);
    if LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    if ok {
        log_event("DirectWrite", "ready paint=gdi", 0);
    } else {
        log_event("DirectWrite", "fallback paint=gdi", hr);
    }
}

fn draw_directwrite_inner(
    hdc: HDC,
    width: i32,
    height: i32,
    filename: &str,
    source: &str,
) -> windows::core::Result<()> {
    let (wide, spans) = layout_spans(filename, source);
    unsafe {
        let _ = GdiFlush();
    }
    let d2d: ID2D1Factory =
        unsafe { D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None) }?;
    let props = D2D1_RENDER_TARGET_PROPERTIES {
        r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
        pixelFormat: D2D1_PIXEL_FORMAT {
            format: DXGI_FORMAT_B8G8R8A8_UNORM,
            alphaMode: D2D1_ALPHA_MODE_IGNORE,
        },
        dpiX: 0.0,
        dpiY: 0.0,
        usage: D2D1_RENDER_TARGET_USAGE_NONE,
        minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
    };
    let target = unsafe { d2d.CreateDCRenderTarget(&props) }?;
    let bind = RECT {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
    };
    unsafe { target.BindDC(hdc, &bind) }?;
    let factory: IDWriteFactory = unsafe { DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED) }?;
    let format = unsafe {
        factory.CreateTextFormat(
            windows::core::w!("Segoe UI"),
            None,
            DWRITE_FONT_WEIGHT_NORMAL,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            16.0,
            windows::core::w!("en-us"),
        )
    }?;
    let layout = if wide.is_empty() {
        None
    } else {
        let layout = unsafe {
            factory.CreateTextLayout(
                &wide,
                &format,
                (width - 32).max(1) as f32,
                (height - 32).max(1) as f32,
            )
        }?;
        for span in &spans {
            let range = DWRITE_TEXT_RANGE {
                startPosition: span.start,
                length: span.len,
            };
            unsafe {
                layout.SetFontSize(span.size, range)?;
                layout.SetFontWeight(span.weight, range)?;
                if span.code {
                    layout.SetFontFamilyName(windows::core::w!("Consolas"), range)?;
                }
            }
        }
        Some(layout)
    };
    let green = D2D1_COLOR_F {
        r: 11.0 / 255.0,
        g: 110.0 / 255.0,
        b: 79.0 / 255.0,
        a: 1.0,
    };
    let white = D2D1_COLOR_F {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };
    unsafe { target.BeginDraw() };
    unsafe { target.Clear(Some(&green)) };
    let brush = unsafe { target.CreateSolidColorBrush(&white, None) }?;
    if let Some(layout) = layout.as_ref() {
        unsafe {
            target.DrawTextLayout(
                Vector2 { X: 16.0, Y: 16.0 },
                layout,
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
            );
        }
    }
    unsafe { target.EndDraw(None, None) }
}

struct Span {
    start: u32,
    len: u32,
    size: f32,
    weight: DWRITE_FONT_WEIGHT,
    code: bool,
}

fn layout_spans(filename: &str, source: &str) -> (Vec<u16>, Vec<Span>) {
    let mut wide = Vec::new();
    let mut spans = Vec::new();
    if !filename.is_empty() {
        push_span(
            &mut wide,
            &mut spans,
            &format!("{filename}\n\n"),
            22.0,
            DWRITE_FONT_WEIGHT_BOLD,
            false,
        );
    }
    for block in markdown_blocks(source) {
        let (size, weight, code_block) = match block.kind {
            MdKind::Heading(1) => (28.0, DWRITE_FONT_WEIGHT_BOLD, false),
            MdKind::Heading(2) => (22.0, DWRITE_FONT_WEIGHT_BOLD, false),
            MdKind::Heading(_) => (18.0, DWRITE_FONT_WEIGHT_BOLD, false),
            MdKind::Code => (15.0, DWRITE_FONT_WEIGHT_NORMAL, true),
            MdKind::Paragraph | MdKind::Bullet | MdKind::Numbered(_) => {
                (16.0, DWRITE_FONT_WEIGHT_NORMAL, false)
            }
        };
        for run in &block.runs {
            let weight = if run.strong {
                DWRITE_FONT_WEIGHT_BOLD
            } else {
                weight
            };
            push_span(
                &mut wide,
                &mut spans,
                &run.text,
                size,
                weight,
                code_block || run.code,
            );
        }
        push_span(&mut wide, &mut spans, "\n", size, weight, code_block);
    }
    (wide, spans)
}

fn push_span(
    wide: &mut Vec<u16>,
    spans: &mut Vec<Span>,
    text: &str,
    size: f32,
    weight: DWRITE_FONT_WEIGHT,
    code: bool,
) {
    if text.is_empty() {
        return;
    }
    let start = wide.len() as u32;
    wide.extend(text.encode_utf16());
    let len = wide.len() as u32 - start;
    if len == 0 {
        return;
    }
    spans.push(Span {
        start,
        len,
        size,
        weight,
        code,
    });
}

fn draw_block(hdc: HDC, area: &mut RECT, block: &MdBlock, fonts: &mut FontCache) -> bool {
    let (height, weight, face, gap) = block_metrics(block.kind);
    let line_h = height.unsigned_abs() as i32 + 6;
    if area.top + line_h > area.bottom {
        return false;
    }
    let left = area.left;
    let right = area.right;
    let mut x = left;
    let mut y = area.top;

    for run in &block.runs {
        let run_weight = if run.strong { 700 } else { weight };
        let face = if run.code { 1 } else { face };
        let font = fonts.get(height, run_weight, face);
        let previous = if font.is_invalid() {
            None
        } else {
            Some(unsafe { SelectObject(hdc, font.into()) })
        };
        for token in tokens(&run.text) {
            if token == "\n" {
                x = left;
                y += line_h;
                if y + line_h > area.bottom {
                    restore(hdc, previous);
                    return false;
                }
                continue;
            }
            let mut piece = token.as_str();
            if x == left {
                piece = piece.trim_start();
                if piece.is_empty() {
                    continue;
                }
            }
            let mut wide: Vec<u16> = piece.encode_utf16().collect();
            let width = text_width(hdc, &wide);
            if x > left && x + width > right {
                x = left;
                y += line_h;
                if y + line_h > area.bottom {
                    restore(hdc, previous);
                    return false;
                }
                piece = piece.trim_start();
                if piece.is_empty() {
                    continue;
                }
                wide = piece.encode_utf16().collect();
            }
            if !wide.is_empty() {
                unsafe {
                    let _ = TextOutW(hdc, x, y, &wide);
                }
                x += text_width(hdc, &wide);
            }
        }
        restore(hdc, previous);
    }

    area.top = y + line_h + gap;
    area.top < area.bottom
}

fn restore(hdc: HDC, previous: Option<windows::Win32::Graphics::Gdi::HGDIOBJ>) {
    if let Some(previous) = previous {
        unsafe { SelectObject(hdc, previous) };
    }
}

fn block_metrics(kind: MdKind) -> (i32, i32, u8, i32) {
    match kind {
        MdKind::Heading(1) => (-32, 700, 0, 10),
        MdKind::Heading(2) => (-26, 700, 0, 8),
        MdKind::Heading(_) => (-22, 700, 0, 6),
        MdKind::Code => (-16, 400, 1, 8),
        MdKind::Paragraph | MdKind::Bullet | MdKind::Numbered(_) => (-18, 400, 0, 6),
    }
}

fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    for ch in text.chars() {
        if ch == '\n' {
            if !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
            out.push("\n".to_string());
        } else if ch.is_whitespace() {
            if !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
            out.push(ch.to_string());
        } else {
            word.push(ch);
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out
}

fn text_width(hdc: HDC, wide: &[u16]) -> i32 {
    if wide.is_empty() {
        return 0;
    }
    let mut size = SIZE::default();
    let ok = unsafe { GetTextExtentPoint32W(hdc, wide, &mut size) };
    if ok.as_bool() {
        size.cx
    } else {
        0
    }
}

#[derive(Default)]
struct FontCache {
    fonts: Vec<(i32, i32, u8, HFONT)>,
}

impl FontCache {
    fn get(&mut self, height: i32, weight: i32, face: u8) -> HFONT {
        if let Some((_, _, _, font)) = self
            .fonts
            .iter()
            .find(|(h, w, f, _)| *h == height && *w == weight && *f == face)
        {
            return *font;
        }
        let font = make_font(height, weight, face);
        self.fonts.push((height, weight, face, font));
        font
    }
}

impl Drop for FontCache {
    fn drop(&mut self) {
        for (_, _, _, font) in self.fonts.drain(..) {
            if !font.is_invalid() {
                unsafe {
                    let _ = DeleteObject(font.into());
                }
            }
        }
    }
}

fn make_font(height: i32, weight: i32, face: u8) -> HFONT {
    let mut lf = LOGFONTW::default();
    lf.lfHeight = height;
    lf.lfWeight = weight;
    lf.lfQuality = FONT_QUALITY(5);
    let name = if face == 1 { "Consolas" } else { "Segoe UI" };
    for (index, unit) in name.encode_utf16().take(31).enumerate() {
        lf.lfFaceName[index] = unit;
    }
    unsafe { CreateFontIndirectW(&lf) }
}
