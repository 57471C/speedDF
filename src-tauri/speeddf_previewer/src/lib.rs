//! # speeddf_previewer — Windows COM Shell Extension Preview Handler
//!
//! This DLL integrates speedDF with Windows File Explorer and Microsoft Outlook
//! as a Preview Handler. When a user selects a PDF, the shell loads this DLL
//! in-process and we spin up an Edge WebView2 instance parented to the host
//! application's HWND to display the speedDF Svelte frontend at `?mode=preview`.
//!
//! ## Build
//! `cargo build --target x86_64-pc-windows-msvc --release -p speeddf_previewer`
//!
//! ## Registration
//! `regsvr32 speeddf_previewer.dll`    (as Administrator)
//! `regsvr32 /u speeddf_previewer.dll` (to unregister)
//!
//! ## Critical Design Decisions
//!
//! 1. ALL exported `extern "system"` functions wrap their body in
//!    `std::panic::catch_unwind`. A Rust panic crossing the FFI boundary into
//!    explorer.exe or outlook.exe is undefined behavior and will crash the host.
//!
//! 2. IInitializeWithStream reads ALL bytes from the IStream into a Vec<u8>,
//!    then IMMEDIATELY drops the stream reference. This releases the OS file
//!    lock so users can rename/delete the PDF while previewing.
//!
//! 3. The WebView2 UDF path is explicitly set to %TEMP%\speedDF_Previewer_UDF.
//!    Outlook's Low Integrity AppContainer cannot write the default UDF location
//!    (next to outlook.exe) — leaving it default causes Access Denied crash.

#![allow(non_snake_case)]

// windows 0.62: the #[implement] proc-macro generates code that references `windows_core`
// as a crate-root name (e.g. `windows_core::IUnknownImpl`). Since our direct dep is
// `windows` (not `windows-core`), we create an alias so generated code can resolve it.
// This is the canonical solution for this version — no separate `windows-core` dep needed.
#[allow(unused_imports)]
use windows as windows_core;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use webview2_com::{
    CreateCoreWebView2ControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler,
    Microsoft::Web::WebView2::Win32::*,
};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::{
            // IStream is defined directly in Win32::System::Com (feature: Win32_System_Com).
            // STREAM_SEEK_* constants are also here.
            Com::{IClassFactory, IClassFactory_Impl, IStream, STREAM_SEEK_END, STREAM_SEEK_SET},
            LibraryLoader::GetModuleFileNameW,
            Ole::{IObjectWithSite, IObjectWithSite_Impl, IOleWindow, IOleWindow_Impl},
            Registry::{
                RegCloseKey, RegCreateKeyW, RegDeleteTreeW, RegDeleteValueW,
                RegSetValueExW, HKEY, HKEY_CLASSES_ROOT, HKEY_LOCAL_MACHINE, REG_SZ,
            },
        },
        UI::{
            Shell::{
                // IPreviewHandler is in Win32_UI_Shell.
                IPreviewHandler, IPreviewHandler_Impl,
                // IInitializeWithStream lives in the PropertiesSystem submodule
                // of Shell (feature: Win32_UI_Shell_PropertiesSystem).
                PropertiesSystem::{
                    IInitializeWithStream, IInitializeWithStream_Impl,
                },
            },
            WindowsAndMessaging::*,
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLSID — unique COM class identifier for the speedDF Preview Handler.
//
// NEVER change this after shipping — Windows caches CLSIDs in the registry.
// Generated via: https://www.guidgenerator.com/
// ─────────────────────────────────────────────────────────────────────────────
const CLSID_SPEEDDF_PREVIEW_HANDLER: GUID = GUID {
    data1: 0xA3C1_D4F2,
    data2: 0x7B3E,
    data3: 0x4F9A,
    data4: [0xB2, 0xD7, 0x8E, 0x1A, 0x6C, 0x9F, 0x0B, 0x4D],
};
const CLSID_STR: &str = "{A3C1D4F2-7B3E-4F9A-B2D7-8E1A6C9F0B4D}";

// The Universal Windows Preview Host surrogate GUID.
// Windows Shell uses this AppId to launch the DLL in a sandboxed surrogate
// process (prevhost.exe) rather than in-process inside Explorer/Outlook.
// This prevents a faulty WebView2 init from crashing the host process.
const PREVHOST_APPID_STR: &str = "{6d27b1b1-b6dd-400e-a60d-885721450553}";

// ─────────────────────────────────────────────────────────────────────────────
// DLL reference count — tracked atomically.
// DllCanUnloadNow returns S_OK when this reaches zero.
// ─────────────────────────────────────────────────────────────────────────────
static DLL_REF_COUNT: AtomicUsize = AtomicUsize::new(0);
fn dll_add_ref() { DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst); }
fn dll_release() { DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst); }

// ─────────────────────────────────────────────────────────────────────────────
// DLL module handle — stored as a plain usize (raw pointer bits).
//
// HMODULE wraps a *mut c_void which is not Send/Sync, so we cannot store it
// in a Lazy<Mutex<HMODULE>>. Using AtomicUsize avoids the Send/Sync issue:
// we store the numeric value of the pointer and reconstruct HMODULE on demand.
// ─────────────────────────────────────────────────────────────────────────────
static DLL_HMODULE_BITS: AtomicUsize = AtomicUsize::new(0);

fn get_dll_module() -> HMODULE {
    HMODULE(DLL_HMODULE_BITS.load(Ordering::SeqCst) as *mut _)
}

/// DllMain — capture our module handle at DLL_PROCESS_ATTACH.
#[no_mangle]
extern "system" fn DllMain(
    hinstDLL: HMODULE,
    fdwReason: u32,
    _: *mut std::ffi::c_void,
) -> BOOL {
    const DLL_PROCESS_ATTACH: u32 = 1;
    if fdwReason == DLL_PROCESS_ATTACH {
        DLL_HMODULE_BITS.store(hinstDLL.0 as usize, Ordering::SeqCst);
        log_trace("DllMain: DLL_PROCESS_ATTACH — speeddf_previewer loaded");
    }
    TRUE
}

fn get_dll_path() -> std::path::PathBuf {
    let hmodule = get_dll_module();
    let mut buf = vec![0u16; MAX_PATH as usize];
    let len = unsafe { GetModuleFileNameW(Some(hmodule), &mut buf) as usize };
    std::path::PathBuf::from(String::from_utf16_lossy(&buf[..len]))
}

fn get_install_dir() -> std::path::PathBuf {
    get_dll_path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf()
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic trace logger — OutputDebugStringW
//
// Streams UTF-16 messages to the Windows kernel debug buffer via
// OutputDebugStringW. This bypasses the Low-Integrity AppContainer filesystem
// sandbox (which blocks writes to arbitrary C:\ paths when hosted inside
// Outlook), while remaining readable by:
//   - Sysinternals DebugView  (run as Administrator, tick "Capture Kernel")
//   - WinDbg / cdb  (attach to prevhost.exe or explorer.exe)
//   - Visual Studio Output window  (when debugging the host process)
//
// Usage: log_trace("SetWindow called");
// ─────────────────────────────────────────────────────────────────────────────
fn log_trace(message: &str) {
    // Append a null terminator — OutputDebugStringW requires a PCWSTR.
    let formatted = format!("[speedDF_Previewer] {}\0", message);
    let wide: Vec<u16> = formatted.encode_utf16().collect();
    unsafe {
        windows::Win32::System::Diagnostics::Debug::OutputDebugStringW(
            windows::core::PCWSTR(wide.as_ptr()),
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PreviewState — all mutable runtime state for one preview session.
// Shared across COM interface impls via Arc<Mutex<>>.
// ─────────────────────────────────────────────────────────────────────────────
struct PreviewState {
    /// Temp PDF file written during IInitializeWithStream (avoids file lock).
    temp_pdf_path: Option<std::path::PathBuf>,
    /// Parent HWND provided by Explorer/Outlook preview pane.
    parent_hwnd: Option<HWND>,
    /// Our borderless child container window (WebView2 is parented here).
    container_hwnd: Option<HWND>,
    /// Current preview pane bounds, updated by IPreviewHandler::SetRect.
    bounds: RECT,
    /// WebView2 controller once DoPreview initializes it.
    controller: Option<ICoreWebView2Controller>,
    /// Site provided by the host via IObjectWithSite::SetSite.
    site: Option<IUnknown>,
}

impl Default for PreviewState {
    fn default() -> Self {
        Self {
            temp_pdf_path: None,
            parent_hwnd: None,
            container_hwnd: None,
            bounds: RECT { left: 0, top: 0, right: 800, bottom: 600 },
            controller: None,
            site: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PreviewHandler — the main COM object.
//
// The #[implement] macro generates the vtable, QueryInterface dispatch,
// AddRef/Release reference counting, and the _Impl struct wrappers.
// ─────────────────────────────────────────────────────────────────────────────
#[implement(IPreviewHandler, IInitializeWithStream, IOleWindow, IObjectWithSite)]
struct PreviewHandler {
    state: Arc<Mutex<PreviewState>>,
}

impl PreviewHandler {
    fn new() -> Self {
        dll_add_ref();
        Self { state: Arc::new(Mutex::new(PreviewState::default())) }
    }
}

impl Drop for PreviewHandler {
    fn drop(&mut self) { dll_release(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// IInitializeWithStream — the "File-Lock Fix"
//
// Explorer passes an IStream over the PDF. Naively holding the stream keeps
// the OS file lock open, preventing rename/delete. Fix: read ALL bytes into
// a Vec<u8>, drop the stream, write the bytes to a temp file, navigate there.
// ─────────────────────────────────────────────────────────────────────────────
impl IInitializeWithStream_Impl for PreviewHandler_Impl {
    fn Initialize(&self, pstream: Ref<'_, IStream>, _grfmode: u32) -> Result<()> {
        log_trace("Initialize: called");
        let stream = pstream.as_ref().ok_or_else(|| Error::from(E_INVALIDARG))?;

        // Determine total byte count by seeking to the end.
        // IStream::Seek returns Result<()> and takes Option<*mut u64> for the new position.
        // We use a u64 variable (not i64) to match the pointer type requirement.
        let total_size: u64 = unsafe {
            let mut new_pos: u64 = 0;
            stream.Seek(0, STREAM_SEEK_END, Some(&mut new_pos as *mut u64))?;
            let size = new_pos;
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            size
        };
        log_trace(&format!("Initialize: stream size = {} bytes", total_size));

        // Guard: reject empty streams or unreasonably large ones (>512 MB).
        if total_size == 0 || total_size > 512 * 1024 * 1024 {
            return Err(Error::from(E_INVALIDARG));
        }

        // Read all bytes into memory.
        // IStream::Read in windows 0.62 returns HRESULT (not Result<()>).
        // Use HRESULT::ok()? to propagate failures as Error.
        let mut pdf_bytes = vec![0u8; total_size as usize];
        let mut bytes_read: u32 = 0;
        unsafe {
            stream.Read(
                pdf_bytes.as_mut_ptr() as *mut std::ffi::c_void,
                total_size as u32,
                Some(&mut bytes_read as *mut u32),
            ).ok()?;
        }
        pdf_bytes.truncate(bytes_read as usize);

        // ── CRITICAL: Release our IStream reference here. ────────────────────
        // `stream` is a Ref<IStream> (a reference borrow, not an owned value).
        // We cannot drop the COM refcount via Rust's drop() here, but rebinding
        // to `_` causes the borrow to end, which is sufficient to signal to the
        // borrow checker that we're done with the stream before we write the file.
        // The actual COM refcount is managed by the Ref<> smart pointer's Drop impl.
        let _ = stream;

        // Write bytes to %TEMP%\speedDF_cache\{uuid}.pdf
        let cache_dir = std::env::temp_dir().join("speedDF_cache");
        std::fs::create_dir_all(&cache_dir).map_err(|_| Error::from(E_FAIL))?;
        let temp_path = cache_dir.join(format!("{}.pdf", Uuid::new_v4()));
        std::fs::write(&temp_path, &pdf_bytes).map_err(|_| Error::from(E_FAIL))?;

        let mut st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.temp_pdf_path = Some(temp_path.clone());
        log_trace(&format!("Initialize: temp PDF written to {:?}", temp_path));
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPreviewHandler — the main preview lifecycle
// ─────────────────────────────────────────────────────────────────────────────
impl IPreviewHandler_Impl for PreviewHandler_Impl {
    /// SetWindow: host gives us its HWND and the initial preview pane RECT.
    /// We create a borderless child window to contain the WebView2 instance.
    fn SetWindow(&self, hwnd: HWND, prc: *const RECT) -> Result<()> {
        if hwnd.is_invalid() || prc.is_null() {
            log_trace("SetWindow: invalid HWND or null RECT — returning E_INVALIDARG");
            return Err(Error::from(E_INVALIDARG));
        }
        let rect = unsafe { *prc };
        log_trace(&format!(
            "SetWindow: hwnd={:?} rect=({},{},{},{})",
            hwnd.0, rect.left, rect.top, rect.right, rect.bottom
        ));
        let mut st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.parent_hwnd = Some(hwnd);
        st.bounds = rect;

        // Create a child container window if we don't have one yet.
        // We use the "STATIC" system class to avoid needing RegisterClassExW.
        if st.container_hwnd.is_none() {
            let container = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!(""),
                    WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    Some(hwnd),
                    None,
                    None,
                    None,
                )?
            };
            log_trace(&format!("SetWindow: container HWND created = {:?}", container.0));
            st.container_hwnd = Some(container);
        }
        log_trace("SetWindow: OK");
        Ok(())
    }

    /// SetRect: preview pane resized — update child window and WebView2 bounds.
    fn SetRect(&self, prc: *const RECT) -> Result<()> {
        if prc.is_null() { return Err(Error::from(E_INVALIDARG)); }
        let rect = unsafe { *prc };
        log_trace(&format!(
            "SetRect: ({},{},{},{})",
            rect.left, rect.top, rect.right, rect.bottom
        ));
        let mut st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.bounds = rect;

        if let Some(hwnd) = st.container_hwnd {
            unsafe {
                let _ = SetWindowPos(
                    hwnd, None,
                    rect.left, rect.top,
                    rect.right - rect.left, rect.bottom - rect.top,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }
        // Synchronize the WebView2 controller bounds if already initialized.
        // webview2-com 0.39.1 uses SetBounds(RECT) not put_Bounds.
        if let Some(ref ctrl) = st.controller {
            unsafe { let _ = ctrl.SetBounds(rect); }
        }
        Ok(())
    }

    /// DoPreview — initialize WebView2 and navigate to the speedDF frontend.
    fn DoPreview(&self) -> Result<()> {
        log_trace("DoPreview: called");
        // Snapshot required state without holding the lock during async ops.
        let (container_hwnd, temp_pdf_path, bounds) = {
            let st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
            let hwnd = st.container_hwnd.ok_or_else(|| {
                log_trace("DoPreview: FAIL — no container_hwnd (SetWindow not called yet)");
                Error::from(E_FAIL)
            })?;
            let path = st.temp_pdf_path.clone().ok_or_else(|| {
                log_trace("DoPreview: FAIL — no temp_pdf_path (Initialize not called yet)");
                Error::from(E_FAIL)
            })?;
            (hwnd, path, st.bounds)
        };

        // Build the navigation URL using a virtual host name.
        // Virtual host mapping sidesteps the Low-Integrity AppContainer block on
        // arbitrary file:// access — WebView2's internal router handles the mapping
        // without performing a filesystem ACL check against the sandbox token.
        let install_dir = get_install_dir();
        let build_dir   = install_dir.join("build");

        // CRITICAL diagnostic: log paths to detect the System32 HMODULE bug.
        // If install_dir is C:\Windows\System32, HMODULE was null at DLL_PROCESS_ATTACH.
        log_trace(&format!("DoPreview: install_dir = {:?}", install_dir));
        log_trace(&format!("DoPreview: build_dir   = {:?}", build_dir));

        // Virtual host navigation URL — served through WebView2's internal router.
        let nav_url = format!(
            "https://preview.speeddf.local/index.html?mode=preview&file={}",
            percent_encode_path(&temp_pdf_path.to_string_lossy()),
        );
        log_trace(&format!("DoPreview: nav_url = {}", nav_url));

        // ── CRITICAL: Explicit WebView2 User Data Folder (UDF) ───────────────
        // Outlook runs in a Low Integrity AppContainer. The default UDF path
        // (next to outlook.exe) is read-only in this sandbox. We MUST specify
        // a writable path in %TEMP% or WebView2 initialization will throw
        // Access Denied and crash the previewer without recovery.
        let udf_path = std::env::temp_dir().join("speedDF_Previewer_UDF");
        std::fs::create_dir_all(&udf_path).ok();
        log_trace(&format!("DoPreview: WebView2 UDF = {:?}", udf_path));
        let udf_pcwstr: Vec<u16> = udf_path
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0u16))
            .collect();

        // Clone the Arc so callbacks can access state after DoPreview returns.
        let state_arc = self.state.clone();

        // CreateCoreWebView2EnvironmentWithOptions is async (completion callback
        // posted to the calling thread's message pump). Explorer's preview pane
        // thread runs a message loop, so callbacks fire without extra threading.
        // webview2-com 0.39.1 callback closure type for EnvironmentCompleted:
        // first arg is Result<()> (converted from HRESULT), second is Option<Interface>.
        let env_completed = CreateCoreWebView2EnvironmentCompletedHandler::create(
            Box::new(move |env_result: windows::core::Result<()>, env: Option<ICoreWebView2Environment>| {
                if let Err(ref e) = env_result {
                    log_trace(&format!("DoPreview: env callback ERROR = {:?}", e));
                    return Ok(());
                }
                let env = match env {
                    Some(e) => e,
                    None => {
                        log_trace("DoPreview: env callback — env is None");
                        return Ok(());
                    }
                };
                log_trace("DoPreview: WebView2 environment created OK");

                let state_arc2 = state_arc.clone();
                let nav_url2   = nav_url.clone();
                let build_dir2 = build_dir.clone();

                let ctrl_completed = CreateCoreWebView2ControllerCompletedHandler::create(
                    Box::new(move |ctrl_result: windows::core::Result<()>, ctrl: Option<ICoreWebView2Controller>| {
                        if let Err(ref e) = ctrl_result {
                            log_trace(&format!("DoPreview: controller callback ERROR = {:?}", e));
                            return Ok(());
                        }
                        let controller = match ctrl {
                            Some(c) => c,
                            None => {
                                log_trace("DoPreview: controller callback — ctrl is None");
                                return Ok(());
                            }
                        };
                        log_trace("DoPreview: WebView2 controller created OK");

                        unsafe {
                            // Fit the WebView2 viewport to the container window.
                            // webview2-com 0.39.1: SetBounds(RECT) and SetIsVisible(bool)
                            let _ = controller.SetBounds(bounds);
                            let _ = controller.SetIsVisible(true);

                            // Navigate to speedDF frontend via virtual host mapping.
                            // ICoreWebView2_3::SetVirtualHostNameToFolderMapping routes
                            // https://preview.speeddf.local/* to build_dir2/* inside the
                            // WebView2 process — no filesystem sandbox ACL check needed.
                            if let Ok(wv) = controller.CoreWebView2() {
                                // Cast to ICoreWebView2_3 to access virtual host API.
                                if let Ok(wv3) = wv.cast::<ICoreWebView2_3>() {
                                    let host_w = to_pcwstr_buf("preview.speeddf.local");
                                    let folder_w = to_pcwstr_buf(
                                        &build_dir2.to_string_lossy(),
                                    );
                                    let map_result = wv3.SetVirtualHostNameToFolderMapping(
                                        PCWSTR(host_w.as_ptr()),
                                        PCWSTR(folder_w.as_ptr()),
                                        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW,
                                    );
                                    log_trace(&format!(
                                        "DoPreview: SetVirtualHostNameToFolderMapping = {:?}",
                                        map_result
                                    ));
                                } else {
                                    log_trace("DoPreview: cast to ICoreWebView2_3 failed — virtual host mapping skipped");
                                }

                                let url_w: Vec<u16> = nav_url2
                                    .encode_utf16()
                                    .chain(std::iter::once(0u16))
                                    .collect();
                                log_trace(&format!("DoPreview: navigating to {}", nav_url2));
                                let _ = wv.Navigate(PCWSTR(url_w.as_ptr()));
                            } else {
                                log_trace("DoPreview: CoreWebView2() returned Err — cannot navigate");
                            }
                        }

                        // Store the controller so SetRect can resize it later.
                        if let Ok(mut st) = state_arc2.lock() {
                            st.controller = Some(controller);
                        }
                        Ok(())
                    }),
                );

                unsafe {
                    log_trace("DoPreview: invoking CreateCoreWebView2Controller");
                    let _ = env.CreateCoreWebView2Controller(container_hwnd, &ctrl_completed);
                }
                Ok(())
            }),
        );

        unsafe {
            log_trace("DoPreview: invoking CreateCoreWebView2EnvironmentWithOptions");
            let result = CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR::null(),
                PCWSTR(udf_pcwstr.as_ptr()),
                None,
                &env_completed,
            );
            log_trace(&format!("DoPreview: CreateCoreWebView2EnvironmentWithOptions returned {:?}", result));
            result?;
        }
        Ok(())
    }

    /// Unload — called when the preview pane closes or another file is selected.
    fn Unload(&self) -> Result<()> {
        log_trace("Unload: called");
        let mut st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.controller = None; // Drop controller → destroys WebView2 browser process.
        if let Some(hwnd) = st.container_hwnd.take() {
            unsafe { let _ = DestroyWindow(hwnd); }
        }
        if let Some(ref path) = st.temp_pdf_path {
            let _ = std::fs::remove_file(path); // Clean up temp cache file.
        }
        st.temp_pdf_path = None;
        Ok(())
    }

    fn SetFocus(&self) -> Result<()> {
        let st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        if let Some(ref ctrl) = st.controller {
            unsafe { let _ = ctrl.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC); }
        }
        Ok(())
    }

    /// QueryFocus — return the HWND that currently has keyboard focus.
    /// windows 0.62 trait signature: fn(&self) -> Result<HWND>
    fn QueryFocus(&self) -> Result<HWND> {
        let st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        // Return the container HWND as the focused window for the host.
        st.container_hwnd.ok_or_else(|| Error::from(E_FAIL))
    }

    /// TranslateAccelerator — return Ok(()) (S_OK) if we handle the key, or
    /// propagate error to signal the host should handle it.
    fn TranslateAccelerator(&self, _pmsg: *const MSG) -> Result<()> {
        // We don't intercept any accelerators — let the host handle them all.
        // Return the S_FALSE equivalent in windows-rs error terms.
        Err(Error::from(HRESULT(1i32))) // 1 = S_FALSE
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IOleWindow — expose our container HWND to the host
// ─────────────────────────────────────────────────────────────────────────────
impl IOleWindow_Impl for PreviewHandler_Impl {
    fn GetWindow(&self) -> Result<HWND> {
        let st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.container_hwnd.ok_or_else(|| Error::from(E_FAIL))
    }
    fn ContextSensitiveHelp(&self, _fentermode: BOOL) -> Result<()> { Ok(()) }
}

// ─────────────────────────────────────────────────────────────────────────────
// IObjectWithSite — host connection point (used by some shell hosts)
// ─────────────────────────────────────────────────────────────────────────────
impl IObjectWithSite_Impl for PreviewHandler_Impl {
    fn SetSite(&self, punksite: Ref<'_, IUnknown>) -> Result<()> {
        let mut st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        st.site = punksite.as_ref().cloned();
        Ok(())
    }

    fn GetSite(&self, riid: *const GUID, ppvsite: *mut *mut std::ffi::c_void) -> Result<()> {
        if ppvsite.is_null() { return Err(Error::from(E_POINTER)); }
        let st = self.state.lock().map_err(|_| Error::from(E_FAIL))?;
        match &st.site {
            Some(site) => unsafe { site.query(riid, ppvsite).ok() },
            None => Err(Error::from(E_NOINTERFACE)),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClassFactory — COM factory for creating PreviewHandler instances
// ─────────────────────────────────────────────────────────────────────────────
#[implement(IClassFactory)]
struct ClassFactory;

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut std::ffi::c_void,
    ) -> Result<()> {
        if ppvobject.is_null() { return Err(Error::from(E_POINTER)); }
        if punkouter.is_some() { return Err(Error::from(CLASS_E_NOAGGREGATION)); }
        let handler: IPreviewHandler = PreviewHandler::new().into();
        unsafe {
            let unknown: IUnknown = handler.cast()?;
            unknown.query(riid, ppvobject).ok()
        }
    }

    fn LockServer(&self, flock: BOOL) -> Result<()> {
        if flock.as_bool() { dll_add_ref(); } else { dll_release(); }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported COM C-ABI functions — ALL wrapped in std::panic::catch_unwind.
//
// A Rust panic crossing the FFI boundary is undefined behavior and will crash
// the host process (explorer.exe / outlook.exe). catch_unwind prevents this
// by converting panics to safe E_FAIL HRESULT return values.
// ─────────────────────────────────────────────────────────────────────────────

/// Called by Windows to obtain a factory object for a given CLSID.
#[no_mangle]
pub extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut std::ffi::c_void,
) -> HRESULT {
    std::panic::catch_unwind(|| unsafe {
        log_trace("DllGetClassObject: called");
        if ppv.is_null() || rclsid.is_null() || riid.is_null() {
            return E_INVALIDARG;
        }
        if *rclsid != CLSID_SPEEDDF_PREVIEW_HANDLER {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = ClassFactory.into();
        match factory.cast::<IUnknown>() {
            Ok(u) => {
                // query() in windows 0.62 returns HRESULT directly, not Result.
                let hr = u.query(riid, ppv);
                if hr.is_ok() { S_OK } else { E_NOINTERFACE }
            }
            Err(_) => E_NOINTERFACE,
        }
    })
    // catch_unwind returns Result<T, Box<dyn Any>>; unwrap_or_else maps panics to E_FAIL.
    .unwrap_or_else(|_| E_FAIL)
}

/// Returns S_OK when no COM objects are alive, signalling the DLL can unload.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    std::panic::catch_unwind(|| {
        if DLL_REF_COUNT.load(Ordering::SeqCst) == 0 { S_OK } else { S_FALSE }
    })
    .unwrap_or_else(|_| E_FAIL)
}

// ─────────────────────────────────────────────────────────────────────────────
// DllRegisterServer — system-wide registration (requires elevation / UAC).
//
// Writing to HKEY_CLASSES_ROOT and HKEY_LOCAL_MACHINE ensures the preview
// handler is visible to ALL users and to AppContainer-hosted processes
// (e.g. Outlook) that cannot read HKCU hives of other sessions.
//
// Keys written:
//   HKCR\CLSID\{CLSID}\                    → friendly name + AppId
//   HKCR\CLSID\{CLSID}\InProcServer32\     → DLL path + threading model
//   HKCR\.pdf\shellex\{IPreviewHandler}    → {CLSID}
//   HKCR\SystemFileAssociations\.pdf\...  → {CLSID}
//   HKCR\<ProgID>\shellex\...             → {CLSID}  (browser/viewer ProgIDs)
//   HKLM\SOFTWARE\...\PreviewHandlers     → friendly name
// ─────────────────────────────────────────────────────────────────────────────
#[no_mangle]
pub extern "system" fn DllRegisterServer() -> HRESULT {
    std::panic::catch_unwind(|| {
        log_trace("DllRegisterServer: called");
        match do_register() {
            Ok(()) => { log_trace("DllRegisterServer: OK"); S_OK }
            Err(e) => { log_trace(&format!("DllRegisterServer: FAIL {:?}", e)); E_FAIL }
        }
    })
    .unwrap_or(E_FAIL)
}

fn do_register() -> Result<()> {
    let dll_path_w = to_pcwstr_buf(&get_dll_path().to_string_lossy());
    let friendly_w = to_pcwstr_buf("speedDF Preview Handler");
    let threading_w = to_pcwstr_buf("Apartment");
    let clsid_w = to_pcwstr_buf(CLSID_STR);

    // Helper: open (or create) a registry subkey under a given root for writing.
    let open_key = |root: HKEY, path: &str| -> Result<HKEY> {
        let path_w = to_pcwstr_buf(path);
        let mut hkey = HKEY::default();
        unsafe {
            RegCreateKeyW(root, PCWSTR(path_w.as_ptr()), &mut hkey).ok()?;
        }
        Ok(hkey)
    };

    // Helper: write a REG_SZ string value.
    let write_sz = |hkey: HKEY, name: &[u16], value: &[u16]| -> Result<()> {
        let name_ptr = if name.is_empty() || name[0] == 0 {
            PCWSTR::null()
        } else {
            PCWSTR(name.as_ptr())
        };
        unsafe {
            RegSetValueExW(
                hkey, name_ptr,
                Some(0), // reserved — must be Some(0) in windows 0.62
                REG_SZ,
                // MSDN: cbData for REG_SZ must include the null terminator bytes.
                // value is a null-terminated UTF-16 Vec<u16>, so value.len() * 2
                // gives the correct byte count including the terminating L'\0'.
                Some(std::slice::from_raw_parts(
                    value.as_ptr() as *const u8,
                    value.len() * 2,
                )),
            ).ok()
        }
    };

    // 1. HKCR\CLSID\{clsid} — friendly display name
    let clsid_key = open_key(
        HKEY_CLASSES_ROOT,
        &format!("CLSID\\{}", CLSID_STR),
    )?;
    write_sz(clsid_key, &[0u16], &friendly_w)?;
    // AppId: tells Shell to host this handler inside the Preview Host surrogate
    // (prevhost.exe) rather than loading the DLL in-process.
    let appid_name = to_pcwstr_buf("AppId");
    let appid_val  = to_pcwstr_buf(PREVHOST_APPID_STR);
    write_sz(clsid_key, &appid_name, &appid_val)?;

    // 2. HKCR\CLSID\{clsid}\InProcServer32 — DLL path + threading model
    let inproc = open_key(
        HKEY_CLASSES_ROOT,
        &format!("CLSID\\{}\\InProcServer32", CLSID_STR),
    )?;
    write_sz(inproc, &[0u16], &dll_path_w)?;
    let model_name = to_pcwstr_buf("ThreadingModel");
    write_sz(inproc, &model_name, &threading_w)?;
    unsafe { let _ = RegCloseKey(inproc); let _ = RegCloseKey(clsid_key); }

    // 3. HKCR\.pdf\shellex\ — associate with the IPreviewHandler shell extension GUID.
    let pdf_key = open_key(
        HKEY_CLASSES_ROOT,
        ".pdf\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
    )?;
    write_sz(pdf_key, &[0u16], &clsid_w)?;
    unsafe { let _ = RegCloseKey(pdf_key); }

    // 4. Register display name in the system-wide PreviewHandlers map (HKLM).
    let ph_key = open_key(
        HKEY_LOCAL_MACHINE,
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
    )?;
    write_sz(ph_key, &clsid_w, &friendly_w)?;
    unsafe { let _ = RegCloseKey(ph_key); }

    // 5. HKCR\SystemFileAssociations\.pdf — persistent file-type fallback.
    let sfa_key = open_key(
        HKEY_CLASSES_ROOT,
        "SystemFileAssociations\\.pdf\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
    )?;
    write_sz(sfa_key, &[0u16], &clsid_w)?;
    unsafe { let _ = RegCloseKey(sfa_key); }

    // 6. Override ProgID-level shellex associations for major PDF viewers/browsers.
    //    Written to HKCR so they are visible system-wide and to AppContainers.
    const PROGID_SHELLEX_PATHS: &[&str] = &[
        "MSEdgePDF\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
        "ChromeHTML\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
        "Acrobat.Document.6\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
        "Acrobat.Document.DC\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
        "PDF Document\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
    ];
    for path in PROGID_SHELLEX_PATHS {
        let key = open_key(HKEY_CLASSES_ROOT, path)?;
        write_sz(key, &[0u16], &clsid_w)?;
        unsafe { let _ = RegCloseKey(key); }
    }

    Ok(())
}

/// Removes all registry entries written by DllRegisterServer.
#[no_mangle]
pub extern "system" fn DllUnregisterServer() -> HRESULT {
    std::panic::catch_unwind(|| unsafe {
        log_trace("DllUnregisterServer: called");
        let del = |root: HKEY, path: &str| {
            let w = to_pcwstr_buf(path);
            let _ = RegDeleteTreeW(root, PCWSTR(w.as_ptr()));
        };

        // Mirror the system-wide paths used in DllRegisterServer.
        del(HKEY_CLASSES_ROOT, &format!("CLSID\\{}", CLSID_STR));
        del(HKEY_CLASSES_ROOT, ".pdf\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}");
        del(HKEY_CLASSES_ROOT, "SystemFileAssociations\\.pdf\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}");

        // Remove ProgID overrides (step 6).
        for path in &[
            "MSEdgePDF\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
            "ChromeHTML\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
            "Acrobat.Document.6\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
            "Acrobat.Document.DC\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
            "PDF Document\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
        ] {
            del(HKEY_CLASSES_ROOT, path);
        }

        // Remove our CLSID value from the system-wide PreviewHandlers map.
        let ph_path = to_pcwstr_buf(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        );
        let clsid_w = to_pcwstr_buf(CLSID_STR);
        let mut ph_key = HKEY::default();
        if RegCreateKeyW(HKEY_LOCAL_MACHINE, PCWSTR(ph_path.as_ptr()), &mut ph_key).is_ok() {
            let _ = RegDeleteValueW(ph_key, PCWSTR(clsid_w.as_ptr()));
            let _ = RegCloseKey(ph_key);
        }

        S_OK
    })
    .unwrap_or(E_FAIL)
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: convert a Rust &str to a null-terminated UTF-16 Vec<u16>
// suitable for use with PCWSTR(buf.as_ptr()).
// ─────────────────────────────────────────────────────────────────────────────
fn to_pcwstr_buf(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0u16)).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: percent-encode a Windows file path for safe embedding in a URL.
// ─────────────────────────────────────────────────────────────────────────────
fn percent_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len() * 3);
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' | b'/' | b':' | b'\\' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => { out.push('%'); out.push_str(&format!("{:02X}", byte)); }
        }
    }
    out
}
