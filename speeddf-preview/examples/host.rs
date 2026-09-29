//! Loads speeddf_preview.dll and drives the preview-handler interfaces.
//! Confirms the child window, the solid colour, the drawn label, and the log.

use std::ffi::c_void;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use speeddf_preview::{log_path, CLSID_SPEEDDF_PREVIEW, PREVIEW_BG};
use windows::core::{s, Interface, GUID, HRESULT, PCWSTR, BOOL};
use windows::Win32::Foundation::{FreeLibrary, HWND, LPARAM, RECT, WPARAM, HMODULE};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetPixel,
    ReleaseDC, SelectObject, UpdateWindow,
};
use std::os::windows::ffi::OsStrExt;
use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, STGM_READ, STGM_SHARE_DENY_NONE,
};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithFile, IInitializeWithStream};
use windows::Win32::UI::Shell::{IPreviewHandler, SHCreateMemStream, SHCreateStreamOnFileEx};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, GetClassNameW, GetClientRect,
    GetWindowTextW, IsWindow, PeekMessageW, SendMessageW, ShowWindow, TranslateMessage, MSG,
    PM_REMOVE, SW_SHOW, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};
use windows::Win32::System::Ole::{IObjectWithSite, IOleWindow};

type DllGetClassObject =
    unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;

fn main() {
    match run() {
        Ok(()) => println!("HOST_OK"),
        Err(err) => {
            eprintln!("HOST_FAIL {err}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<(), String> {
    let _ = std::fs::remove_file(log_path());
    let dll = dll_path()?;
    if !dll.exists() {
        return Err(format!("missing {}", dll.display()));
    }

    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if hr.is_err() {
        return Err(format!("CoInitializeEx 0x{:08X}", hr.0 as u32));
    }

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| exercise(&dll)));
    unsafe { CoUninitialize() };
    match result {
        Ok(value) => value,
        Err(_) => Err("host panicked".to_string()),
    }
}

fn exercise(dll: &std::path::Path) -> Result<(), String> {
    let module = unsafe { LoadLibraryW(pcwstr(&wide(dll))) }.map_err(|err| err.to_string())?;
    let outcome = exercise_loaded(module);
    unsafe { FreeLibrary(module).map_err(|err| err.to_string())? };
    outcome
}

fn exercise_loaded(module: HMODULE) -> Result<(), String> {
    let get_class = unsafe { GetProcAddress(module, s!("DllGetClassObject")) }
        .ok_or("DllGetClassObject missing")?;
    let get_class: DllGetClassObject = unsafe { std::mem::transmute(get_class) };

    let mut factory_ptr = std::ptr::null_mut();
    let hr = unsafe {
        get_class(
            &CLSID_SPEEDDF_PREVIEW,
            &windows::Win32::System::Com::IClassFactory::IID,
            &mut factory_ptr,
        )
    };
    if hr.is_err() || factory_ptr.is_null() {
        return Err(format!("DllGetClassObject 0x{:08X}", hr.0 as u32));
    }
    let factory = unsafe {
        windows::Win32::System::Com::IClassFactory::from_raw(factory_ptr)
    };

    let preview: IPreviewHandler = unsafe { factory.CreateInstance(None) }
        .map_err(|err| format!("CreateInstance {err}"))?;
    let init: IInitializeWithStream = preview.cast().map_err(|err| format!("QI stream {err}"))?;
    let _ole: IOleWindow = preview.cast().map_err(|err| format!("QI IOleWindow {err}"))?;
    let site: IObjectWithSite = preview.cast().map_err(|err| format!("QI site {err}"))?;
    if preview.cast::<IInitializeWithFile>().is_ok() {
        return Err("IInitializeWithFile was exposed; stream-only spike".to_string());
    }

    let bytes = b"SPEEDDF-SPIKE-TOKEN\nmemory stream body for the preview spike.\n";
    let memory = unsafe { SHCreateMemStream(Some(bytes)) }.ok_or("SHCreateMemStream failed")?;
    unsafe { init.Initialize(&memory, 0) }.map_err(|err| format!("Initialize {err}"))?;

    let parent = create_parent()?;
    let rect = RECT {
        left: 0,
        top: 0,
        right: 480,
        bottom: 280,
    };
    unsafe { preview.SetWindow(parent, &rect) }.map_err(|err| format!("SetWindow {err}"))?;
    unsafe { preview.DoPreview() }.map_err(|err| format!("DoPreview {err}"))?;
    pump(Duration::from_millis(200));

    let child = find_child(parent, "SpeedDFPreviewPane").ok_or("child window missing")?;
    let color = pixel(child).map_err(|err| err)?;
    if color != PREVIEW_BG {
        return Err(format!("pixel 0x{color:08X} expected 0x{PREVIEW_BG:08X}"));
    }
    let caption = window_text(child);
    if !caption.starts_with("SPEEDDF-SPIKE-TOKEN") {
        return Err(format!("caption was {caption:?}"));
    }

    let resized = RECT {
        left: 8,
        top: 6,
        right: 308,
        bottom: 156,
    };
    unsafe { preview.SetRect(&resized) }.map_err(|err| format!("SetRect {err}"))?;
    let mut client = RECT::default();
    unsafe { GetClientRect(child, &mut client) }.map_err(|err| err.to_string())?;
    if client.right != 300 || client.bottom != 150 {
        return Err(format!(
            "SetRect size {}x{}, expected 300x150",
            client.right, client.bottom
        ));
    }

    let window = site_window(&preview)?;
    if window != child {
        return Err("IOleWindow::GetWindow did not return the child".to_string());
    }

    let stream_unknown: windows::core::IUnknown = memory.cast().map_err(|err| err.to_string())?;
    unsafe { site.SetSite(&stream_unknown) }.map_err(|err| format!("SetSite {err}"))?;
    let roundtrip: windows::core::IUnknown =
        unsafe { site.GetSite() }.map_err(|err| format!("GetSite {err}"))?;
    if roundtrip.as_raw() != stream_unknown.as_raw() {
        return Err("GetSite returned a different object".to_string());
    }

    unsafe { preview.Unload() }.map_err(|err| format!("Unload {err}"))?;
    if unsafe { IsWindow(Some(child)) }.as_bool() {
        return Err("Unload left the child window alive".to_string());
    }

    exercise_file(&factory)?;
    check_log()?;
    unsafe { DestroyWindow(parent) }.map_err(|err| err.to_string())?;
    drop(init);
    drop(site);
    drop(preview);
    drop(factory);
    Ok(())
}

fn exercise_file(factory: &windows::Win32::System::Com::IClassFactory) -> Result<(), String> {
    let preview: IPreviewHandler =
        unsafe { factory.CreateInstance(None) }.map_err(|err| format!("file CreateInstance {err}"))?;
    let init: IInitializeWithStream = preview.cast().map_err(|err| err.to_string())?;
    let fixture = fixture_path()?;
    let stream = unsafe {
        SHCreateStreamOnFileEx(
            pcwstr(&wide(&fixture)),
            STGM_READ.0 | STGM_SHARE_DENY_NONE.0,
            0,
            false,
            None,
        )
    }
    .map_err(|err| format!("file stream {err}"))?;
    unsafe { init.Initialize(&stream, 0) }.map_err(|err| format!("file Initialize {err}"))?;
    let parent = create_parent()?;
    let rect = RECT {
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
    };
    unsafe { preview.SetWindow(parent, &rect) }.map_err(|err| err.to_string())?;
    unsafe { preview.DoPreview() }.map_err(|err| err.to_string())?;
    pump(Duration::from_millis(100));
    let child = find_child(parent, "SpeedDFPreviewPane").ok_or("file child missing")?;
    let caption = window_text(child);
    if caption != "spike.md" {
        return Err(format!("file caption was {caption:?}, expected spike.md"));
    }
    let color = pixel(child)?;
    if color != PREVIEW_BG {
        return Err(format!("file pixel 0x{color:08X}"));
    }
    unsafe { preview.Unload() }.map_err(|err| err.to_string())?;
    unsafe { DestroyWindow(parent) }.map_err(|err| err.to_string())?;
    let _ = stream;
    Ok(())
}

fn check_log() -> Result<(), String> {
    let text = std::fs::read_to_string(log_path()).map_err(|err| format!("log {err}"))?;
    for token in ["CoCreate", "Initialize", "SetWindow", "SetRect", "DoPreview", "Unload", "hr=0x"] {
        if !text.contains(token) {
            return Err(format!("log missing {token}\n{text}"));
        }
    }
    println!("log {}", log_path().display());
    Ok(())
}

fn site_window(preview: &IPreviewHandler) -> Result<HWND, String> {
    let ole: IOleWindow = preview.cast().map_err(|err| err.to_string())?;
    unsafe { ole.GetWindow() }.map_err(|err| err.to_string())
}

fn create_parent() -> Result<HWND, String> {
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            windows::core::w!("Static"),
            windows::core::w!("speedDF preview spike host"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            40,
            40,
            520,
            360,
            None,
            None,
            None,
            None,
        )
        .map_err(|err| format!("parent window {err}"))
    }
}

fn find_child(parent: HWND, class_name: &str) -> Option<HWND> {
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;
    struct Search {
        class_name: String,
        found: Option<HWND>,
    }
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf);
        let name = String::from_utf16_lossy(&buf[..n as usize]);
        if name == search.class_name {
            search.found = Some(hwnd);
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut search = Search {
        class_name: class_name.to_string(),
        found: None,
    };
    let _ = unsafe {
        EnumChildWindows(Some(parent), Some(each), LPARAM(&mut search as *mut Search as isize))
    };
    search.found
}

fn pixel(hwnd: HWND) -> Result<u32, String> {
    let _ = unsafe { ShowWindow(hwnd, SW_SHOW) };
    let _ = unsafe { UpdateWindow(hwnd) };
    pump(Duration::from_millis(50));
    let direct = unsafe { GetDC(Some(hwnd)) };
    if !direct.is_invalid() {
        let color = unsafe { GetPixel(direct, 4, 4) };
        unsafe { ReleaseDC(Some(hwnd), direct) };
        if color.0 != 0xFFFF_FFFF {
            return Ok(color.0 & 0x00FF_FFFF);
        }
    }
    // The window DC was not readable. Ask the child to paint into a memory DC.
    let screen = unsafe { GetDC(Some(hwnd)) };
    if screen.is_invalid() {
        return Err("GetDC failed".to_string());
    }
    let mem = unsafe { CreateCompatibleDC(Some(screen)) };
    let bmp = unsafe { CreateCompatibleBitmap(screen, 32, 32) };
    if mem.is_invalid() || bmp.is_invalid() {
        unsafe {
            ReleaseDC(Some(hwnd), screen);
        }
        return Err("compatible DC failed".to_string());
    }
    let old = unsafe { SelectObject(mem, bmp.into()) };
    unsafe {
        let _ = SendMessageW(
            hwnd,
            0x0318,
            Some(WPARAM(mem.0 as usize)),
            Some(LPARAM(0x4 | 0x8)),
        );
    }
    let color = unsafe { GetPixel(mem, 4, 4) };
    unsafe {
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(Some(hwnd), screen);
    }
    if color.0 == 0xFFFF_FFFF {
        return Err("GetPixel returned CLR_INVALID".to_string());
    }
    Ok(color.0 & 0x00FF_FFFF)
}

fn window_text(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n as usize])
}

fn pump(duration: Duration) {
    let start = Instant::now();
    while start.elapsed() < duration {
        let mut msg = MSG::default();
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn dll_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let mut candidates = Vec::new();
    if let Some(dir) = exe.parent() {
        candidates.push(dir.join("speeddf_preview.dll"));
        if let Some(parent) = dir.parent() {
            candidates.push(parent.join("speeddf_preview.dll"));
            candidates.push(parent.join("deps").join("speeddf_preview.dll"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| format!("missing speeddf_preview.dll near {}", exe.display()))
}

fn fixture_path() -> Result<PathBuf, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("spike.md");
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("missing {}", path.display()))
    }
}

fn wide(path: &std::path::Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn pcwstr(wide: &[u16]) -> PCWSTR {
    PCWSTR(wide.as_ptr())
}


