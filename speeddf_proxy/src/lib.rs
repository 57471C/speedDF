#![allow(non_snake_case)]

use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;
use windows::{
    Win32::Foundation::*, Win32::System::Com::*, Win32::System::LibraryLoader::GetModuleFileNameW,
    Win32::UI::Shell::PropertiesSystem::*, Win32::UI::Shell::*,
    Win32::UI::WindowsAndMessaging::MSG, core::*,
};

// The unique ID Windows will use to find our doorbell
const CLSID_PROXY: GUID = GUID::from_values(
    0xA3C1D4F2,
    0x7B3E,
    0x4F9A,
    [0xB2, 0xD7, 0x8E, 0x1A, 0x6C, 0x9F, 0x0B, 0x4D],
);

static DLL_MODULE: AtomicUsize = AtomicUsize::new(0);

#[unsafe(no_mangle)]
pub extern "system" fn DllMain(hinst: HINSTANCE, reason: u32, _: *mut std::ffi::c_void) -> BOOL {
    if reason == 1
    /* DLL_PROCESS_ATTACH */
    {
        DLL_MODULE.store(hinst.0 as usize, Ordering::SeqCst);
        write_log("DllMain Attached");
    }
    TRUE
}

#[implement(IPreviewHandler, IInitializeWithStream)]
struct SpeedDfProxy;

// 1. CATCH THE FILE FROM WINDOWS
impl IInitializeWithStream_Impl for SpeedDfProxy_Impl {
    fn Initialize(&self, pstream: Option<&IStream>, _grfmode: u32) -> Result<()> {
        write_log("Initialize called!");
        let stream = pstream.ok_or(E_INVALIDARG)?;

        // Read file bytes
        let mut size = 0u64;
        unsafe { stream.Seek(0, STREAM_SEEK_END, Some(&mut size))? };
        unsafe { stream.Seek(0, STREAM_SEEK_SET, None)? };

        let mut buf = vec![0u8; size as usize];
        let mut bytes_read = 0u32;
        unsafe {
            stream
                .Read(buf.as_mut_ptr() as _, size as u32, Some(&mut bytes_read))
                .ok()?
        };

        // Save to temp file so we drop the OS lock on the original
        let temp_path = std::env::temp_dir().join(format!("speedDF_{}.pdf", Uuid::new_v4()));
        std::fs::write(&temp_path, &buf).map_err(|_| Error::from(E_FAIL))?;
        write_log(&format!("PDF copied to temp: {:?}", temp_path));

        // Find where our speeddf.exe lives
        let mut path_buf = [0u16; 1024];
        let len = unsafe {
            GetModuleFileNameW(
                HMODULE(DLL_MODULE.load(Ordering::SeqCst) as _),
                &mut path_buf,
            )
        } as usize;

        let dll_path = String::from_utf16_lossy(&path_buf[..len]);
        let exe_path = std::path::PathBuf::from(dll_path).with_file_name("speeddf.exe");

        let safe_path = temp_path.to_string_lossy().replace("\\", "/");
        let exe_str = exe_path.to_str().unwrap_or_default();
        let args_str = format!("--preview \"{}\"", safe_path);

        write_log(&format!("Target EXE: {}", exe_str));
        write_log(&format!("Arguments: {}", args_str));

        let exe_h = windows::core::HSTRING::from(exe_str);
        let args_h = windows::core::HSTRING::from(args_str);

        // NATIVE WIN32 SANDBOX ESCAPE
        unsafe {
            ShellExecuteW(
                HWND::default(),
                w!("open"),
                &exe_h,
                &args_h,
                w!(""),
                windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(5), // SW_SHOW
            );
        }
        write_log("SUCCESS: ShellExecuteW fired to launch Tauri!");

        Ok(())
    }
}

// 2. LIE TO WINDOWS (Tauri handles the actual UI!)
impl IPreviewHandler_Impl for SpeedDfProxy_Impl {
    fn SetWindow(&self, _hwnd: HWND, _prc: *const RECT) -> Result<()> {
        Ok(())
    }
    fn SetRect(&self, _prc: *const RECT) -> Result<()> {
        Ok(())
    }
    fn DoPreview(&self) -> Result<()> {
        Ok(())
    }
    fn Unload(&self) -> Result<()> {
        Ok(())
    }
    fn SetFocus(&self) -> Result<()> {
        Ok(())
    }
    fn QueryFocus(&self) -> Result<HWND> {
        Err(Error::from(E_NOTIMPL))
    }
    fn TranslateAccelerator(&self, _pmsg: *const MSG) -> Result<()> {
        Err(Error::from(S_FALSE))
    }
}

// 3. COM BOILERPLATE
#[implement(IClassFactory)]
struct ProxyFactory;

impl IClassFactory_Impl for ProxyFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&IUnknown>,
        riid: *const GUID,
        ppv: *mut *mut std::ffi::c_void,
    ) -> Result<()> {
        if outer.is_some() {
            return Err(Error::from(CLASS_E_NOAGGREGATION));
        }
        let handler: IPreviewHandler = SpeedDfProxy.into();
        unsafe { handler.cast::<IUnknown>()?.query(riid, ppv).ok() }
    }
    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut std::ffi::c_void,
) -> HRESULT {
    write_log("DllGetClassObject requested");
    unsafe {
        if rclsid.is_null() || riid.is_null() || ppv.is_null() {
            return E_POINTER;
        }
        if *rclsid != CLSID_PROXY {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = ProxyFactory.into();
        match factory.cast::<IUnknown>() {
            Ok(unknown) => {
                if unknown.query(riid, ppv).is_ok() {
                    S_OK
                } else {
                    E_NOINTERFACE
                }
            }
            Err(_) => E_NOINTERFACE,
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_OK
}
#[unsafe(no_mangle)]
pub extern "system" fn DllRegisterServer() -> HRESULT {
    S_OK
}
#[unsafe(no_mangle)]
pub extern "system" fn DllUnregisterServer() -> HRESULT {
    S_OK
}

fn write_log(msg: &str) {
    // Write directly to the LocalLow folder (The only folder the Sandbox is guaranteed to allow)
    if let Ok(local_low) = std::env::var("USERPROFILE") {
        let log_path = format!("{}\\AppData\\LocalLow\\speeddf_proxy.log", local_low);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            use std::io::Write;
            let _ = writeln!(f, "SPEEDDF_PROXY: {}", msg);
        }
    }
}
