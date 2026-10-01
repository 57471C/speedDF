//! Write a flattened document under %TEMP%\\speeddf-mail and open an Outlook draft.
//! Display only — this never calls Send, and it never deletes the temp attachment.

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::{secure_file_name, secure_verify_path};

/// Single path segment, with Windows-illegal characters replaced.
pub(crate) fn sanitize_mail_file_name(input: &str) -> Result<OsString, String> {
    let extracted = secure_file_name(input)?;
    let raw = extracted.to_string_lossy();
    let mut cleaned = String::new();
    for c in raw.chars() {
        if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/') {
            cleaned.push('_');
        } else {
            cleaned.push(c);
        }
    }
    let cleaned = cleaned.trim_end_matches([' ', '.']).to_string();
    if cleaned.is_empty() {
        return Err("Security Violation: Invalid file name provided.".to_string());
    }
    let cleaned = prefix_reserved_device_name(&cleaned);
    secure_file_name(&cleaned)
}

fn prefix_reserved_device_name(name: &str) -> String {
    let stem = match name.rfind('.') {
        Some(idx) if idx > 0 => &name[..idx],
        _ => name,
    };
    let device = stem.split('.').next().unwrap_or(stem);
    let reserved = matches!(
        device.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        format!("_{name}")
    } else {
        name.to_string()
    }
}

/// Writes `file_bytes` to `%TEMP%/speeddf-mail/<sanitized name>` and returns that absolute path.
#[tauri::command]
pub async fn write_mail_attachment(
    file_name: String,
    file_bytes: Vec<u8>,
) -> Result<String, String> {
    let safe_name = sanitize_mail_file_name(&file_name)?;
    let mut path = std::env::temp_dir();
    path.push("speeddf-mail");
    path.push(safe_name);
    let path_string = path.to_string_lossy().into_owned();
    let safe_path = secure_verify_path(&path_string)?;
    if let Some(parent) = safe_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the mail temp folder: {e}"))?;
    }
    let mut file = std::fs::File::create(&safe_path)
        .map_err(|e| format!("Could not write the mail attachment: {e}"))?;
    file.write_all(&file_bytes)
        .map_err(|e| format!("Could not write the mail attachment: {e}"))?;
    file.flush()
        .map_err(|e| format!("Could not write the mail attachment: {e}"))?;
    Ok(safe_path.to_string_lossy().into_owned())
}

/// Opens an Outlook draft with `path` attached. Does not send, and does not delete `path`.
#[tauri::command]
pub async fn compose_email_with_attachment(path: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = path;
        return Err("Email attach is Windows-only for now.".to_string());
    }
    #[cfg(windows)]
    {
        let safe = secure_verify_path(&path)?;
        if !safe.is_file() {
            return Err(format!("Attachment file is missing: {}", safe.display()));
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        let for_thread = safe.clone();
        let spawned = std::thread::Builder::new()
            .name("speeddf-outlook".into())
            .spawn(move || {
                let _ = tx.send(compose_on_windows(&for_thread));
            });
        if let Err(err) = spawned {
            return match spawn_outlook_exe(&safe) {
                Ok(()) => Ok(()),
                Err(exe_err) => Err(format!(
                    "Could not start Outlook. Thread: {err}. outlook.exe /a: {exe_err}. The attachment file was left in place."
                )),
            };
        }
        rx.await.map_err(|_| {
            "Email thread ended before Outlook responded. The attachment file was left in place."
                .to_string()
        })?
    }
}

#[cfg(windows)]
fn compose_on_windows(path: &Path) -> Result<(), String> {
    let subject = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "attachment".to_string());
    let com_err = match outlook_com_display(path, &subject) {
        Ok(()) => return Ok(()),
        Err(err) => err,
    };
    match spawn_outlook_exe(path) {
        Ok(()) => Ok(()),
        Err(exe_err) => Err(format!(
            "Could not open an Outlook draft for \"{subject}\". Outlook COM: {com_err}. outlook.exe /a: {exe_err}. The attachment file was left in place."
        )),
    }
}

#[cfg(windows)]
fn spawn_outlook_exe(path: &Path) -> Result<(), String> {
    let mut tried = Vec::new();
    match std::process::Command::new("outlook.exe")
        .arg("/a")
        .arg(path)
        .spawn()
    {
        Ok(_) => return Ok(()),
        Err(err) => tried.push(format!("outlook.exe ({err})")),
    }
    for exe in office_outlook_candidates() {
        if !exe.is_file() {
            continue;
        }
        match std::process::Command::new(&exe).arg("/a").arg(path).spawn() {
            Ok(_) => return Ok(()),
            Err(err) => tried.push(format!("{} ({err})", exe.display())),
        }
    }
    Err(tried.join("; "))
}

#[cfg(windows)]
fn office_outlook_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Some(root) = std::env::var_os(var) else {
            continue;
        };
        let root = PathBuf::from(root);
        out.push(root.join(r"Microsoft Office\root\Office16\OUTLOOK.EXE"));
        out.push(root.join(r"Microsoft Office\Office16\OUTLOOK.EXE"));
    }
    out
}

/// Outlook.Application on a dedicated STA thread. Display() shows the draft; Send is never called.
#[cfg(windows)]
fn outlook_com_display(path: &Path, subject: &str) -> Result<(), String> {
    use windows::core::GUID;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch, CLSCTX_INPROC_SERVER,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;

    struct StaGuard;
    impl Drop for StaGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    // RPC_E_CHANGED_MODE: this thread is already in another apartment. Do not uninitialize it.
    const RPC_E_CHANGED_MODE: i32 = 0x8001_0106u32 as i32;
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if hr.0 == RPC_E_CHANGED_MODE {
        return Err("COM apartment was already set on the Outlook thread (0x80010106)".to_string());
    }
    if hr.is_err() {
        let message = hr.message();
        let message = message.trim();
        return Err(if message.is_empty() {
            format!("COM init failed (0x{:08X})", hr.0 as u32)
        } else {
            format!("COM init failed: {message} (0x{:08X})", hr.0 as u32)
        });
    }
    let _sta = StaGuard;

    let clsid = GUID::from_u128(0x0006_F03A_0000_0000_C000_0000_0000_0046);
    let app: IDispatch =
        unsafe { CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER) }
            .map_err(|err| {
                format!(
                    "Could not create Outlook.Application ({})",
                    com_message(&err)
                )
            })?;

    let path_str = path.to_string_lossy();
    let item_var = invoke_method(&app, "CreateItem", Some(VARIANT::from(0i32)))?;
    let item = as_dispatch(&item_var, "CreateItem")?;
    put_string(&item, "Subject", subject)?;
    let attachments = get_property(&item, "Attachments")?;
    let _added = invoke_method(&attachments, "Add", Some(VARIANT::from(path_str.as_ref())))?;
    let _shown = invoke_method(&item, "Display", None)?;
    Ok(())
}

#[cfg(windows)]
fn com_message(err: &windows::core::Error) -> String {
    let text = err.message();
    let text = text.trim();
    if text.is_empty() {
        format!("0x{:08X}", err.code().0 as u32)
    } else {
        format!("{text} (0x{:08X})", err.code().0 as u32)
    }
}

#[cfg(windows)]
fn member_id(disp: &windows::Win32::System::Com::IDispatch, name: &str) -> Result<i32, String> {
    use windows::core::{GUID, PCWSTR};
    let mut wide: Vec<u16> = name.encode_utf16().collect();
    wide.push(0);
    let name_ptr = PCWSTR(wide.as_ptr());
    let mut id = 0i32;
    let iid = GUID::zeroed();
    unsafe {
        disp.GetIDsOfNames(&iid, &name_ptr, 1, 0, &mut id)
            .map_err(|err| format!("Outlook has no '{name}' ({})", com_message(&err)))?;
    }
    Ok(id)
}

#[cfg(windows)]
fn empty_params() -> windows::Win32::System::Com::DISPPARAMS {
    windows::Win32::System::Com::DISPPARAMS {
        rgvarg: std::ptr::null_mut(),
        rgdispidNamedArgs: std::ptr::null_mut(),
        cArgs: 0,
        cNamedArgs: 0,
    }
}

#[cfg(windows)]
fn invoke_method(
    disp: &windows::Win32::System::Com::IDispatch,
    name: &str,
    mut arg: Option<windows::Win32::System::Variant::VARIANT>,
) -> Result<windows::Win32::System::Variant::VARIANT, String> {
    use windows::core::GUID;
    use windows::Win32::System::Com::DISPATCH_METHOD;
    use windows::Win32::System::Variant::VARIANT;

    let id = member_id(disp, name)?;
    let mut params = empty_params();
    if let Some(value) = arg.as_mut() {
        params.rgvarg = value as *mut VARIANT;
        params.cArgs = 1;
    }
    let iid = GUID::zeroed();
    let mut result = VARIANT::default();
    unsafe {
        disp.Invoke(
            id,
            &iid,
            0,
            DISPATCH_METHOD,
            &params,
            Some(&mut result),
            None,
            None,
        )
        .map_err(|err| format!("Outlook '{name}' failed ({})", com_message(&err)))?;
    }
    Ok(result)
}

#[cfg(windows)]
fn get_property(
    disp: &windows::Win32::System::Com::IDispatch,
    name: &str,
) -> Result<windows::Win32::System::Com::IDispatch, String> {
    use windows::core::GUID;
    use windows::Win32::System::Com::DISPATCH_PROPERTYGET;
    use windows::Win32::System::Variant::VARIANT;

    let id = member_id(disp, name)?;
    let params = empty_params();
    let iid = GUID::zeroed();
    let mut result = VARIANT::default();
    unsafe {
        disp.Invoke(
            id,
            &iid,
            0,
            DISPATCH_PROPERTYGET,
            &params,
            Some(&mut result),
            None,
            None,
        )
        .map_err(|err| format!("Outlook '{name}' failed ({})", com_message(&err)))?;
    }
    as_dispatch(&result, name)
}

#[cfg(windows)]
fn put_string(
    disp: &windows::Win32::System::Com::IDispatch,
    name: &str,
    value: &str,
) -> Result<(), String> {
    use windows::core::GUID;
    use windows::Win32::System::Com::{DISPATCH_PROPERTYPUT, DISPPARAMS};
    use windows::Win32::System::Ole::DISPID_PROPERTYPUT;
    use windows::Win32::System::Variant::VARIANT;

    let id = member_id(disp, name)?;
    let mut arg = VARIANT::from(value);
    let mut named = DISPID_PROPERTYPUT;
    let params = DISPPARAMS {
        rgvarg: &mut arg,
        rgdispidNamedArgs: &mut named,
        cArgs: 1,
        cNamedArgs: 1,
    };
    let iid = GUID::zeroed();
    unsafe {
        disp.Invoke(id, &iid, 0, DISPATCH_PROPERTYPUT, &params, None, None, None)
            .map_err(|err| format!("Could not set Outlook '{name}' ({})", com_message(&err)))?;
    }
    Ok(())
}

#[cfg(windows)]
fn as_dispatch(
    value: &windows::Win32::System::Variant::VARIANT,
    what: &str,
) -> Result<windows::Win32::System::Com::IDispatch, String> {
    use windows::Win32::System::Com::IDispatch;
    IDispatch::try_from(value).map_err(|err| {
        format!(
            "Outlook {what} did not return an object ({})",
            com_message(&err)
        )
    })
}

#[cfg(test)]
mod tests {
    use super::sanitize_mail_file_name;

    fn name(input: &str) -> String {
        sanitize_mail_file_name(input)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn keeps_a_plain_file_name() {
        assert_eq!(name("report.pdf"), "report.pdf");
    }

    #[test]
    fn drops_directories_and_illegal_characters() {
        let cleaned = name(r"..\..\evil:name?.pdf");
        assert_eq!(cleaned, "evil_name_.pdf");
        assert!(!cleaned.contains(".."));
    }

    #[test]
    fn rejects_empty_and_dot_dot() {
        assert!(sanitize_mail_file_name("").is_err());
        assert!(sanitize_mail_file_name("..").is_err());
        assert!(sanitize_mail_file_name("   ").is_err());
    }

    #[test]
    fn prefixes_reserved_device_names() {
        assert_eq!(name("CON.pdf"), "_CON.pdf");
    }
}
