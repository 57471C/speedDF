#![allow(non_snake_case)]

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;
use windows::{
    core::*, Win32::Foundation::*, Win32::System::Com::*,
    Win32::System::LibraryLoader::GetModuleFileNameW, Win32::UI::Shell::PropertiesSystem::*,
    Win32::UI::Shell::*, Win32::UI::WindowsAndMessaging::MSG,
};

// The unique ID Windows will use to find our doorbell
const CLSID_PROXY: GUID = GUID::from_u128(0xA3C1D4F2_7B3E_4F9A_B2D7_8E1A6C9F0B4D);

static DLL_MODULE: AtomicUsize = AtomicUsize::new(0);

#[unsafe(no_mangle)]
pub extern "system" fn DllMain(hinst: HINSTANCE, reason: u32, _: *mut std::ffi::c_void) -> BOOL {
    if reason == 1
    /* DLL_PROCESS_ATTACH */
    {
        DLL_MODULE.store(hinst.0 as usize, Ordering::SeqCst);
    }
    TRUE
}

#[implement(IPreviewHandler, IInitializeWithStream)]
struct SpeedDfProxy;

// 1. CATCH THE FILE FROM WINDOWS
impl IInitializeWithStream_Impl for SpeedDfProxy_Impl {
    fn Initialize(&self, pstream: Option<&IStream>, _grfmode: u32) -> Result<()> {
        let stream = pstream.ok_or(E_INVALIDARG)?;

        // Read file bytes
        let mut size = 0u64;
        unsafe { stream.Seek(0, STREAM_SEEK_END, Some(&mut size))? };
        unsafe { stream.Seek(0, STREAM_SEEK_SET, None)? };

        let mut buf = vec![0u8; size as usize];
        let mut bytes_read = 0u32;
        unsafe { stream.Read(buf.as_mut_ptr() as _, size as u32, Some(&mut bytes_read)).ok()? };

        // Save to temp file so we drop the OS lock on the original
        let temp_path = std::env::temp_dir().join(format!("speedDF_{}.pdf", Uuid::new_v4()));
        std::fs::write(&temp_path, &buf).map_err(|_| Error::from(E_FAIL))?;

        // Find where our speeddf.exe lives (assumes it's in the same folder as this DLL)
        let mut path_buf = [0u16; 1024];
        let len = unsafe {
            GetModuleFileNameW(
                HMODULE(DLL_MODULE.load(Ordering::SeqCst) as _),
                &mut path_buf,
            )
        } as usize;
        let dll_path = String::from_utf16_lossy(&path_buf[..len]);
        let exe_path = std::path::PathBuf::from(dll_path).with_file_name("speeddf.exe");

        // Convert Windows backslashes to forward slashes to prevent SvelteKit 500 URL routing errors
        let safe_path = temp_path.to_string_lossy().replace("\\", "/");

        // RING THE DOORBELL: Spawn Tauri silently!
        let _ = Command::new(exe_path)
            .arg("--preview")
            .arg(safe_path)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

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

// 3. COM BOILERPLATE (Standard requirement for Windows DLLs)
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
    unsafe {
        if *rclsid != CLSID_PROXY {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = ProxyFactory.into();
        factory.cast::<IUnknown>().unwrap().query(riid, ppv)
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_OK
}
