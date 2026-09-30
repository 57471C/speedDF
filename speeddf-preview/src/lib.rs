//! 64-bit in-process preview handler for `.md` files.
//! The host passes a stream and a parent HWND. This DLL creates a child window
//! and paints sanitized Markdown in a WebView2 child, or the source text if
//! WebView2 is missing.

#![cfg_attr(not(all(windows, target_arch = "x86_64")), allow(dead_code))]

#[cfg(not(all(windows, target_arch = "x86_64")))]
compile_error!("speeddf-preview is a Windows x64 preview handler");

mod handler;
mod logutil;
mod markdown;
mod paint;
mod webview;

use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};

use windows::core::{BOOL, HRESULT, IUnknown, Interface, Ref, GUID};
use windows_core::implement;
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, HINSTANCE, S_FALSE,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::DisableThreadLibraryCalls;

use handler::{PreviewHandler, MODULE};
pub use logutil::log_path;
pub use paint::PREVIEW_BG;

/// `{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}` — keep in sync with register.ps1.
pub const CLSID_SPEEDDF_PREVIEW: GUID = GUID::from_u128(0xE7A4C2B1_9D58_4F63_A1E0_6C8B3D5F27A4);

static LOCK_COUNT: AtomicI32 = AtomicI32::new(0);

pub(crate) fn lock_inc() {
    LOCK_COUNT.fetch_add(1, Ordering::SeqCst);
}

pub(crate) fn lock_dec() {
    LOCK_COUNT.fetch_sub(1, Ordering::SeqCst);
}

#[implement(Agile = false, IClassFactory)]
struct ClassFactory;

impl ClassFactory {
    fn new() -> Self {
        lock_inc();
        Self
    }
}

impl Drop for ClassFactory {
    fn drop(&mut self) {
        lock_dec();
    }
}

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            create_instance(punkouter, riid, ppvobject)
        }));
        logutil::finish("CoCreate", "CreateInstance", result)
    }

    fn LockServer(&self, flock: BOOL) -> windows::core::Result<()> {
        if flock.as_bool() {
            lock_inc();
        } else {
            lock_dec();
        }
        Ok(())
    }
}

fn create_instance(
    punkouter: Ref<'_, IUnknown>,
    riid: *const GUID,
    ppvobject: *mut *mut c_void,
) -> windows::core::Result<()> {
    if ppvobject.is_null() || riid.is_null() {
        return Err(E_POINTER.into());
    }
    unsafe { *ppvobject = std::ptr::null_mut() };
    if !punkouter.is_null() {
        return Err(CLASS_E_NOAGGREGATION.into());
    }
    let object: IUnknown = PreviewHandler::new().into();
    unsafe { object.query(riid, ppvobject).ok() }
}

#[no_mangle]
pub unsafe extern "system" fn DllMain(hinst: HINSTANCE, reason: u32, _reserved: *mut c_void) -> BOOL {
    // 1 = DLL_PROCESS_ATTACH. Stay off the loader lock: no file I/O here.
    if reason == 1 {
        MODULE.store(hinst.0 as isize, Ordering::Relaxed);
        let _ = DisableThreadLibraryCalls(windows::Win32::Foundation::HMODULE(hinst.0));
    }
    BOOL(1)
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        dll_get_class_object(rclsid, riid, ppv)
    }));
    match result {
        Ok(hr) => hr,
        Err(_) => {
            logutil::log_event("CoCreate", "DllGetClassObject panic", E_FAIL.0);
            E_FAIL
        }
    }
}

fn dll_get_class_object(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        logutil::log_event("CoCreate", "DllGetClassObject", E_POINTER.0);
        return E_POINTER;
    }
    unsafe { *ppv = std::ptr::null_mut() };
    if unsafe { *rclsid } != CLSID_SPEEDDF_PREVIEW {
        logutil::log_event("CoCreate", "DllGetClassObject class", CLASS_E_CLASSNOTAVAILABLE.0);
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = ClassFactory::new().into();
    let hr = unsafe { factory.query(riid, ppv) };
    logutil::log_event("CoCreate", "DllGetClassObject", hr.0);
    hr
}

#[no_mangle]
pub unsafe extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LOCK_COUNT.load(Ordering::SeqCst) == 0 {
        windows::Win32::Foundation::S_OK
    } else {
        S_FALSE
    }
}


