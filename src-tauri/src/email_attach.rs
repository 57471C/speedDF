//! Write a flattened document under %TEMP%\\speeddf-mail and open an Outlook draft.
//! Display only — this never calls Send, and it never deletes the temp attachment.
//! Once the draft exists, its inspector is brought in front of speedDF.

use std::ffi::OsString;
use std::io::Write;
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use windows::Win32::Foundation::HWND;

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
    // Snapshot first so a window that was already open is not treated as this draft.
    let before = outlook_top_level_keys();
    let mut tried = Vec::new();
    match std::process::Command::new("outlook.exe")
        .arg("/a")
        .arg(path)
        .spawn()
    {
        Ok(_) => {
            foreground_spawned_draft(path, &before);
            return Ok(());
        }
        Err(err) => tried.push(format!("outlook.exe ({err})")),
    }
    for exe in office_outlook_candidates() {
        if !exe.is_file() {
            continue;
        }
        match std::process::Command::new(&exe).arg("/a").arg(path).spawn() {
            Ok(_) => {
                foreground_spawned_draft(path, &before);
                return Ok(());
            }
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
    // The draft exists. A foreground failure must not fall through to outlook.exe /a,
    // which would open a second draft.
    bring_displayed_inspector_forward(&item);
    Ok(())
}

/// Display() has returned. GetInspector, Activate, then raise that window.
#[cfg(windows)]
fn bring_displayed_inspector_forward(item: &windows::Win32::System::Com::IDispatch) {
    let Ok(inspector) = mail_item_inspector(item) else {
        return;
    };
    let _ = invoke_method(&inspector, "Activate", None);
    for attempt in 0..20 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if let Some(hwnd) = inspector_hwnd(&inspector) {
            raise_inspector_window(hwnd);
            return;
        }
    }
}

#[cfg(windows)]
fn mail_item_inspector(
    item: &windows::Win32::System::Com::IDispatch,
) -> Result<windows::Win32::System::Com::IDispatch, String> {
    if let Ok(value) = invoke_method(item, "GetInspector", None) {
        if let Ok(inspector) = as_dispatch(&value, "GetInspector") {
            return Ok(inspector);
        }
    }
    let value = get_variant(item, "GetInspector")?;
    as_dispatch(&value, "GetInspector")
}

/// Inspector.HWND is a 32-bit Long. If that value is not a live window, ask IOleWindow.
#[cfg(windows)]
fn inspector_hwnd(inspector: &windows::Win32::System::Com::IDispatch) -> Option<HWND> {
    if let Ok(value) = get_variant(inspector, "HWND") {
        if let Some(hwnd) = hwnd_from_variant(&value) {
            if hwnd_is_live(hwnd) {
                return Some(hwnd);
            }
        }
    }
    use windows::core::Interface;
    use windows::Win32::System::Ole::IOleWindow;
    let ole: IOleWindow = inspector.cast().ok()?;
    let hwnd = unsafe { ole.GetWindow() }.ok()?;
    if hwnd_is_live(hwnd) {
        Some(hwnd)
    } else {
        None
    }
}

#[cfg(windows)]
fn hwnd_from_variant(value: &windows::Win32::System::Variant::VARIANT) -> Option<HWND> {
    use windows::Win32::System::Variant::{
        VT_I2, VT_I4, VT_I8, VT_INT, VT_TYPEMASK, VT_UI4, VT_UI8, VT_UINT,
    };
    let raw_vt = value.vt().0 & VT_TYPEMASK.0;
    let bits = unsafe {
        let data = &value.Anonymous.Anonymous.Anonymous;
        match raw_vt {
            vt if vt == VT_I4.0 || vt == VT_INT.0 => data.lVal as u32 as usize,
            vt if vt == VT_UI4.0 || vt == VT_UINT.0 => data.ulVal as usize,
            vt if vt == VT_I8.0 => data.llVal as u64 as usize,
            vt if vt == VT_UI8.0 => data.ullVal as usize,
            vt if vt == VT_I2.0 => data.iVal as u16 as usize,
            _ => return None,
        }
    };
    if bits == 0 {
        None
    } else {
        Some(HWND(bits as *mut core::ffi::c_void))
    }
}

#[cfg(windows)]
fn hwnd_is_live(hwnd: HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    !hwnd.is_invalid() && unsafe { IsWindow(Some(hwnd)).as_bool() }
}

/// ShowWindow SW_RESTORE when iconic, then attach this thread to the foreground
/// thread, SetForegroundWindow, and detach. Does not touch the speedDF window.
#[cfg(windows)]
fn raise_inspector_window(hwnd: HWND) {
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    if !hwnd_is_live(hwnd) {
        return;
    }
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let foreground = GetForegroundWindow();
        let foreground_thread = if foreground.is_invalid() {
            0
        } else {
            GetWindowThreadProcessId(foreground, None)
        };
        let current = GetCurrentThreadId();
        let attached = foreground_thread != 0
            && foreground_thread != current
            && AttachThreadInput(current, foreground_thread, true).as_bool();
        let _ = SetForegroundWindow(hwnd);
        if attached {
            let _ = AttachThreadInput(current, foreground_thread, false);
        }
    }
}

#[cfg(windows)]
fn foreground_spawned_draft(path: &Path, before: &[isize]) {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut outlook_pids = std::collections::HashMap::<u32, bool>::new();
    while std::time::Instant::now() < deadline {
        if let Some(hwnd) = find_new_draft(before, &file_name, &mut outlook_pids) {
            raise_inspector_window(hwnd);
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[cfg(windows)]
fn outlook_top_level_keys() -> Vec<isize> {
    let mut outlook_pids = std::collections::HashMap::<u32, bool>::new();
    top_level_windows()
        .into_iter()
        .filter(|hwnd| is_outlook_window(*hwnd, &mut outlook_pids))
        .map(|hwnd| hwnd.0 as isize)
        .collect()
}

#[cfg(windows)]
fn find_new_draft(
    before: &[isize],
    file_name: &str,
    outlook_pids: &mut std::collections::HashMap<u32, bool>,
) -> Option<HWND> {
    for hwnd in top_level_windows() {
        let key = hwnd.0 as isize;
        if before.contains(&key) || !is_outlook_window(hwnd, outlook_pids) {
            continue;
        }
        let title = window_text(hwnd);
        if is_compose_title(&title) {
            return Some(hwnd);
        }
        if is_main_outlook_title(&title) {
            continue;
        }
        if title_has_attachment(&title, file_name) {
            return Some(hwnd);
        }
    }
    None
}

#[cfg(windows)]
fn is_compose_title(title: &str) -> bool {
    title.to_ascii_lowercase().contains(" - message")
}

#[cfg(windows)]
fn is_main_outlook_title(title: &str) -> bool {
    let title = title.trim().to_ascii_lowercase();
    title == "outlook" || title.ends_with(" - outlook")
}

#[cfg(windows)]
fn title_has_attachment(title: &str, file_name: &str) -> bool {
    if file_name.is_empty() {
        return false;
    }
    title.to_lowercase().contains(&file_name.to_lowercase())
}

#[cfg(windows)]
fn is_outlook_window(hwnd: HWND, outlook_pids: &mut std::collections::HashMap<u32, bool>) -> bool {
    if !is_visible(hwnd) {
        return false;
    }
    if is_outlook_process(hwnd, outlook_pids) {
        return true;
    }
    window_class(hwnd).eq_ignore_ascii_case("rctrl_renwnd32")
}

#[cfg(windows)]
fn is_visible(hwnd: HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    unsafe { IsWindowVisible(hwnd).as_bool() }
}

#[cfg(windows)]
fn is_outlook_process(hwnd: HWND, cache: &mut std::collections::HashMap<u32, bool>) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut pid = 0u32;
    let thread = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32)) };
    if thread == 0 || pid == 0 {
        return false;
    }
    if let Some(known) = cache.get(&pid) {
        return *known;
    }
    let outlook = process_image_is_outlook(pid);
    cache.insert(pid, outlook);
    outlook
}

#[cfg(windows)]
fn process_image_is_outlook(pid: u32) -> bool {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return false;
    };
    let mut buf = [0u16; 520];
    let mut len = buf.len() as u32;
    let queried = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    if queried.is_err() {
        return false;
    }
    let n = (len as usize).min(buf.len());
    let full = String::from_utf16_lossy(&buf[..n]);
    let name = full.rsplit(['\\', '/']).next().unwrap_or(&full);
    let name = name.to_ascii_lowercase();
    name == "outlook.exe" || name == "olk.exe"
}

#[cfg(windows)]
fn top_level_windows() -> Vec<HWND> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let slots = &mut *(lparam.0 as *mut Vec<HWND>);
        slots.push(hwnd);
        BOOL(1)
    }

    let mut slots = Vec::new();
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut slots as *mut Vec<HWND> as isize)) };
    slots
}

#[cfg(windows)]
fn window_text(hwnd: HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if n <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

#[cfg(windows)]
fn window_class(hwnd: HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    if n <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buf[..n as usize])
    }
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
fn get_variant(
    disp: &windows::Win32::System::Com::IDispatch,
    name: &str,
) -> Result<windows::Win32::System::Variant::VARIANT, String> {
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
    Ok(result)
}

#[cfg(windows)]
fn get_property(
    disp: &windows::Win32::System::Com::IDispatch,
    name: &str,
) -> Result<windows::Win32::System::Com::IDispatch, String> {
    let result = get_variant(disp, name)?;
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

    #[cfg(windows)]
    #[test]
    fn i4_hwnd_zero_extends_into_the_low_32_bits() {
        use windows::Win32::System::Variant::VARIANT;

        let negative = VARIANT::from(-16i32);
        let hwnd = super::hwnd_from_variant(&negative).unwrap();
        assert_eq!(hwnd.0 as usize, 0xFFFF_FFF0);

        let positive = VARIANT::from(0x12_AB34i32);
        let hwnd = super::hwnd_from_variant(&positive).unwrap();
        assert_eq!(hwnd.0 as usize, 0x12_AB34);

        assert!(super::hwnd_from_variant(&VARIANT::from(0i32)).is_none());
        assert!(super::hwnd_from_variant(&VARIANT::default()).is_none());
        assert!(super::hwnd_from_variant(&VARIANT::from("nope")).is_none());
    }

    #[cfg(all(windows, target_pointer_width = "64"))]
    #[test]
    fn i8_hwnd_keeps_bits_above_32() {
        use windows::Win32::System::Variant::VARIANT;

        let value = VARIANT::from(0x1_8000_0000i64);
        let hwnd = super::hwnd_from_variant(&value).unwrap();
        assert_eq!(hwnd.0 as usize, 0x1_8000_0000);
    }

    #[cfg(windows)]
    #[test]
    fn compose_title_is_the_inspector_not_the_main_window() {
        assert!(super::is_compose_title("Untitled - Message (HTML)"));
        assert!(super::is_compose_title("report.pdf - Message (Plain Text)"));
        assert!(!super::is_compose_title("Inbox - Terry - Outlook"));
        assert!(super::is_main_outlook_title("Inbox - Terry - Outlook"));
        assert!(super::is_main_outlook_title("  Outlook  "));
        assert!(!super::is_main_outlook_title("Untitled - Message (HTML)"));
        assert!(super::title_has_attachment(
            "notes.pdf - Message (HTML)",
            "notes.pdf"
        ));
        assert!(!super::title_has_attachment(
            "Untitled - Message (HTML)",
            "notes.pdf"
        ));
        assert!(!super::title_has_attachment("notes.pdf", ""));
    }
}
