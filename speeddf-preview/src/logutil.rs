use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use windows::core::Result;
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};

static LOG: Mutex<()> = Mutex::new(());

pub fn log_path() -> PathBuf {
    // prevhost is low integrity and cannot create a file in the medium-integrity
    // Temp directory. Point at the user Temp path anyway. register.ps1 lowers the
    // log file's integrity label so that process can append.
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        let dir = PathBuf::from(profile)
            .join("AppData")
            .join("Local")
            .join("Temp");
        if dir.is_dir() {
            return dir.join("speeddf-preview.log");
        }
    }
    std::env::temp_dir().join("speeddf-preview.log")
}

fn candidate_paths() -> Vec<PathBuf> {
    let preferred = log_path();
    let mut paths = vec![preferred.clone()];
    let fallback = std::env::temp_dir().join("speeddf-preview.log");
    if fallback != preferred {
        paths.push(fallback);
    }
    paths
}

pub(crate) fn log_event(op: &str, detail: &str, hr: i32) {
    let detail = detail.trim();
    let line = if detail.is_empty() {
        format!("{op} hr=0x{hr:08X}", hr = hr as u32)
    } else {
        format!("{op} {detail} hr=0x{hr:08X}", hr = hr as u32)
    };
    log_raw(&line);
}

pub(crate) fn log_raw(message: &str) {
    let _guard = LOG.lock().unwrap_or_else(|poison| poison.into_inner());
    let mut file = None;
    for path in candidate_paths() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(opened) = OpenOptions::new().create(true).append(true).open(&path) {
            file = Some(opened);
            break;
        }
    }
    let mut file = match file {
        Some(file) => file,
        None => return,
    };
    let stamp = timestamp();
    let pid = unsafe { GetCurrentProcessId() };
    let tid = unsafe { GetCurrentThreadId() };
    let _ = writeln!(file, "{stamp} pid={pid} tid={tid} {message}");
    let _ = file.flush();
}

pub(crate) fn finish(
    op: &str,
    detail: &str,
    result: std::thread::Result<Result<()>>,
) -> Result<()> {
    match result {
        Ok(value) => {
            let hr = match &value {
                Ok(()) => 0,
                Err(err) => err.code().0,
            };
            log_event(op, detail, hr);
            value
        }
        Err(_) => {
            log_event(op, &format!("{detail} panic"), E_FAIL.0);
            Err(E_FAIL.into())
        }
    }
}

fn timestamp() -> String {
    let now = unsafe { GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, now.wMilliseconds
    )
}
