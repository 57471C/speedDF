//! Opt-in preview registration helper.
//!
//! `status` stays unelevated. `register` and `unregister` ShellExecute `runas`
//! when this process is not elevated, and write nothing until that succeeds.
//! Settings starts this exe as the current user. A cancelled UAC prompt exits
//! 1223 and leaves the registry unchanged.

#![cfg_attr(not(windows), allow(dead_code))]

use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use windows::core::{PCWSTR, PWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE};
#[cfg(windows)]
use windows::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY};
#[cfg(windows)]
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW,
    RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
    KEY_WOW64_64KEY, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, REG_VALUE_TYPE,
};
#[cfg(windows)]
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, GetExitCodeProcess,
    OpenProcessToken, WaitForSingleObject, INFINITE,
};
#[cfg(windows)]
use windows::Win32::UI::Shell::{
    SHChangeNotify, ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
    SHCNE_ASSOCCHANGED, SHCNF_IDLIST, SHELLEXECUTEINFOW,
};

const CLSID: &str = "{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}";
/// Explorer and Outlook `.svg`. Same DLL, separate from the markdown CLSID.
const SVG_CLSID: &str = "{C3B7A91E-5D24-4E68-8F10-6A2D9C4B7E15}";
const SHELLEX: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";
const APP_ID: &str = "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}";
const DISPLAY: &str = "speedDF Markdown Preview";
const SVG_DISPLAY: &str = "speedDF SVG Preview";
const CLICKTORUN_PREVIEW_HANDLERS: &str =
    "SOFTWARE\\Microsoft\\Office\\ClickToRun\\REGISTRY\\MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers";
const EXIT_CANCELLED: i32 = 1223;

/// Value name and data for the Click-to-Run PreviewHandlers key.
/// `svg` selects the SVG CLSID. Markdown registration never passes true.
fn clicktorun_entry(svg: bool) -> (&'static str, &'static str) {
    if svg {
        (SVG_CLSID, SVG_DISPLAY)
    } else {
        (CLSID, DISPLAY)
    }
}

#[cfg(windows)]
fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(err) => {
            log_line("error", &err.message, err.code);
            eprintln!("{}", err.message);
            1
        }
    };
    std::process::exit(code);
}

#[cfg(not(windows))]
fn main() {
    eprintln!("speeddf-preview-register is Windows-only");
    std::process::exit(1);
}

#[derive(Debug)]
struct ToolError {
    message: String,
    code: u32,
}

impl ToolError {
    fn new(message: impl Into<String>, code: u32) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}

#[derive(Clone, Debug)]
struct Args {
    command: CommandKind,
    dll: Option<PathBuf>,
    svg: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RegPlan {
    markdown: bool,
    svg: bool,
    /// Markdown CLSID on the Click-to-Run key.
    clicktorun: bool,
    /// SVG CLSID on that same key. Does not replace the markdown value.
    svg_clicktorun: bool,
    pdf: bool,
}

fn plan_for(command: CommandKind, svg: bool) -> RegPlan {
    match (command, svg) {
        (CommandKind::Register, false) | (CommandKind::Unregister, false) => RegPlan {
            markdown: true,
            svg: false,
            clicktorun: true,
            svg_clicktorun: false,
            pdf: false,
        },
        (CommandKind::Register, true) | (CommandKind::Unregister, true) => RegPlan {
            markdown: false,
            svg: true,
            clicktorun: false,
            svg_clicktorun: true,
            pdf: false,
        },
        (CommandKind::Status, _) => RegPlan {
            markdown: false,
            svg: false,
            clicktorun: false,
            svg_clicktorun: false,
            pdf: false,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommandKind {
    Register,
    Unregister,
    Status,
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Args, ToolError> {
    let mut command = None;
    let mut dll = None;
    let mut svg = false;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "register" if command.is_none() => command = Some(CommandKind::Register),
            "unregister" if command.is_none() => command = Some(CommandKind::Unregister),
            "status" if command.is_none() => command = Some(CommandKind::Status),
            "--svg" => svg = true,
            "--dll" => {
                let path = iter.next().ok_or_else(|| {
                    ToolError::new("register needs --dll <absolute path>", 2)
                })?;
                dll = Some(PathBuf::from(path));
            }
            "-h" | "--help" => {
                return Err(ToolError::new(
                    "usage: speeddf-preview-register register|unregister|status [--svg] [--dll <absolute dll>]",
                    2,
                ));
            }
            other => {
                return Err(ToolError::new(
                    format!("unknown argument: {other}"),
                    2,
                ));
            }
        }
    }
    let command = command.ok_or_else(|| {
        ToolError::new(
            "usage: speeddf-preview-register register|unregister|status [--svg] [--dll <absolute dll>]",
            2,
        )
    })?;
    Ok(Args { command, dll, svg })
}

#[cfg(windows)]
fn run() -> Result<i32, ToolError> {
    let args = parse_args(env::args().skip(1))?;
    match args.command {
        CommandKind::Status => {
            println!("{}", status_json()?);
            Ok(0)
        }
        CommandKind::Register | CommandKind::Unregister => {
            if !is_elevated() {
                let code = elevate_self()?;
                if code != 0 {
                    return Ok(code);
                }
                println!("{}", status_json()?);
                return Ok(0);
            }
            let plan = plan_for(args.command, args.svg);
            match args.command {
                CommandKind::Register if plan.svg => register_svg(args.dll)?,
                CommandKind::Unregister if plan.svg => unregister_svg()?,
                CommandKind::Register => register(args.dll)?,
                CommandKind::Unregister => unregister()?,
                CommandKind::Status => {}
            }
            println!("{}", status_json()?);
            Ok(0)
        }
    }
}

#[cfg(windows)]
fn register(dll: Option<PathBuf>) -> Result<(), ToolError> {
    let dll = resolve_dll(dll)?;
    validate_dll(&dll)?;
    let dll_text = dll.to_string_lossy().to_string();
    write_clicktorun()?;
    if let Err(err) = write_hkcu(&dll_text) {
        let _ = delete_clicktorun_value();
        return Err(err);
    }
    prepare_runtime_dirs();
    let _ = unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    log_line("register", &format!("dll={dll_text}"), 0);
    Ok(())
}

#[cfg(windows)]
fn unregister() -> Result<(), ToolError> {
    delete_clicktorun_value()?;
    remove_hkcu()?;
    let _ = unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    log_line("unregister", "removed our preview values", 0);
    Ok(())
}

#[cfg(windows)]
fn register_svg(dll: Option<PathBuf>) -> Result<(), ToolError> {
    let dll = resolve_dll(dll)?;
    validate_dll(&dll)?;
    let dll_text = dll.to_string_lossy().to_string();
    write_svg_clicktorun()?;
    if let Err(err) = write_svg_hkcu(&dll_text) {
        let _ = delete_svg_clicktorun_value();
        return Err(err);
    }
    prepare_runtime_dirs();
    let _ = unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    log_line("register-svg", &format!("dll={dll_text}"), 0);
    Ok(())
}

#[cfg(windows)]
fn write_svg_hkcu(dll_text: &str) -> Result<(), ToolError> {
    let path = svg_shellex_path();
    remember_kind("svg", SVG_CLSID, &[path.clone()])?;
    set_sz(HKEY_CURRENT_USER, &path, "", SVG_CLSID)?;
    let clsid_key = format!("Software\\Classes\\CLSID\\{SVG_CLSID}");
    set_sz(HKEY_CURRENT_USER, &clsid_key, "", SVG_DISPLAY)?;
    set_sz(HKEY_CURRENT_USER, &clsid_key, "DisplayName", SVG_DISPLAY)?;
    set_sz(HKEY_CURRENT_USER, &clsid_key, "AppID", APP_ID)?;
    set_dword(
        HKEY_CURRENT_USER,
        &clsid_key,
        "DisableLowILProcessIsolation",
        1,
    )?;
    let inproc = format!("{clsid_key}\\InprocServer32");
    set_sz(HKEY_CURRENT_USER, &inproc, "", dll_text)?;
    set_sz(HKEY_CURRENT_USER, &inproc, "ThreadingModel", "Apartment")?;
    set_sz(
        HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        SVG_CLSID,
        SVG_DISPLAY,
    )?;
    ensure_surrogate()?;
    Ok(())
}

#[cfg(windows)]
fn unregister_svg() -> Result<(), ToolError> {
    delete_svg_clicktorun_value()?;
    let path = svg_shellex_path();
    restore_shellex(&path, "svg", SVG_CLSID)?;
    delete_value(
        HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        SVG_CLSID,
    )?;
    delete_tree(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\CLSID\\{SVG_CLSID}"),
    )?;
    let mut backup = load_backup();
    backup.retain(|entry| entry.kind != "svg");
    if !markdown_shellex_is_ours() && backup.iter().any(|entry| entry.kind == "surrogate") {
        delete_tree(
            HKEY_CURRENT_USER,
            &format!("Software\\Classes\\AppID\\{APP_ID}"),
        )?;
        backup.retain(|entry| entry.kind != "surrogate");
    }
    if backup.is_empty() {
        let _ = fs::remove_file(backup_path());
    } else {
        save_backup(&backup)?;
    }
    let _ = unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    log_line("unregister-svg", "removed .svg shellex and clicktorun", 0);
    Ok(())
}

#[cfg(windows)]
fn svg_shellex_path() -> String {
    format!("Software\\Classes\\.svg\\shellex\\{SHELLEX}")
}

#[cfg(windows)]
fn markdown_shellex_is_ours() -> bool {
    shellex_is(r"Software\Classes\.md\shellex", CLSID)
}

#[cfg(windows)]
fn svg_shellex_is_ours() -> bool {
    shellex_is(r"Software\Classes\.svg\shellex", SVG_CLSID)
}

#[cfg(windows)]
fn svg_clicktorun_is_ours() -> bool {
    let (name, data) = clicktorun_entry(true);
    query_sz(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, name)
        .ok()
        .flatten()
        .as_deref()
        == Some(data)
}

#[cfg(windows)]
fn svg_is_on() -> bool {
    svg_shellex_is_ours() && svg_clicktorun_is_ours()
}

#[cfg(windows)]
fn shellex_is(parent: &str, clsid: &str) -> bool {
    query_sz(HKEY_CURRENT_USER, &format!("{parent}\\{SHELLEX}"), "")
        .ok()
        .flatten()
        .is_some_and(|value| same_guid(&value, clsid))
}

#[cfg(windows)]
fn restore_shellex(path: &str, kind: &str, clsid: &str) -> Result<(), ToolError> {
    let backup = load_backup();
    let saved = backup
        .iter()
        .find(|entry| entry.kind == kind && entry.path.eq_ignore_ascii_case(path));
    if let Some(entry) = saved {
        if entry.existed {
            if let Some(previous) = &entry.previous {
                set_sz(HKEY_CURRENT_USER, path, "", previous)?;
                return Ok(());
            }
        }
    }
    let current = query_sz(HKEY_CURRENT_USER, path, "").unwrap_or(None);
    if current.as_deref().is_some_and(|value| same_guid(value, clsid)) || current.is_none() {
        delete_tree(HKEY_CURRENT_USER, path)?;
        let parent = path.rsplit_once('\\').map(|(parent, _)| parent).unwrap_or(path);
        delete_tree_if_empty(HKEY_CURRENT_USER, parent)?;
    }
    Ok(())
}

#[cfg(windows)]
fn resolve_dll(explicit: Option<PathBuf>) -> Result<PathBuf, ToolError> {
    if let Some(path) = explicit {
        return Ok(path);
    }
    let exe = env::current_exe().map_err(|err| ToolError::new(err.to_string(), 1))?;
    // Packaged install: this exe and speeddf_preview.dll both sit beside speeddf.exe.
    // Dev: cargo writes the cdylib next to this exe or under deps/.
    let dir = exe.parent().unwrap_or(Path::new("."));
    let sibling = dir.join("speeddf_preview.dll");
    if sibling.is_file() {
        return Ok(sibling);
    }
    let deps = dir.join("deps").join("speeddf_preview.dll");
    if deps.is_file() {
        return Ok(deps);
    }
    Err(ToolError::new(
        "speeddf_preview.dll was not found beside speeddf-preview-register.exe",
        2,
    ))
}

#[cfg(windows)]
fn validate_dll(path: &Path) -> Result<(), ToolError> {
    if !path.is_absolute() {
        return Err(ToolError::new(
            "dll path must be absolute",
            2,
        ));
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.ends_with(".pdf") || name.ends_with(".svg") || !name.ends_with(".dll") {
        return Err(ToolError::new(
            "preview registration only accepts speeddf_preview.dll",
            2,
        ));
    }
    if !path.is_file() {
        return Err(ToolError::new(
            format!("dll not found: {}", path.display()),
            2,
        ));
    }
    let bytes = fs::read(path).map_err(|err| ToolError::new(err.to_string(), 1))?;
    if bytes.len() < 64 || bytes[0] != b'M' || bytes[1] != b'Z' {
        return Err(ToolError::new("dll is not a PE file", 2));
    }
    let lfanew = u32::from_le_bytes(bytes[0x3C..0x40].try_into().unwrap_or([0; 4])) as usize;
    if lfanew + 6 > bytes.len() {
        return Err(ToolError::new("dll PE header is truncated", 2));
    }
    let machine = u16::from_le_bytes(bytes[lfanew + 4..lfanew + 6].try_into().unwrap_or([0; 2]));
    if machine != 0x8664 {
        return Err(ToolError::new(
            format!("dll is not x64 (machine 0x{machine:04X})"),
            2,
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn write_clicktorun() -> Result<(), ToolError> {
    let (name, data) = clicktorun_entry(false);
    set_sz(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, name, data)
}

#[cfg(windows)]
fn delete_clicktorun_value() -> Result<(), ToolError> {
    let (name, _) = clicktorun_entry(false);
    delete_value(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, name)
}

#[cfg(windows)]
fn write_svg_clicktorun() -> Result<(), ToolError> {
    let (name, data) = clicktorun_entry(true);
    set_sz(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, name, data)
}

#[cfg(windows)]
fn delete_svg_clicktorun_value() -> Result<(), ToolError> {
    let (name, _) = clicktorun_entry(true);
    delete_value(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, name)
}

#[cfg(windows)]
fn write_hkcu(dll: &str) -> Result<(), ToolError> {
    let shellex_paths = shellex_paths();
    remember_shellex(&shellex_paths)?;
    for path in &shellex_paths {
        set_sz(HKEY_CURRENT_USER, path, "", CLSID)?;
    }
    let clsid_key = format!("Software\\Classes\\CLSID\\{CLSID}");
    set_sz(HKEY_CURRENT_USER, &clsid_key, "", DISPLAY)?;
    set_sz(HKEY_CURRENT_USER, &clsid_key, "DisplayName", DISPLAY)?;
    set_sz(HKEY_CURRENT_USER, &clsid_key, "AppID", APP_ID)?;
    set_dword(HKEY_CURRENT_USER, &clsid_key, "DisableLowILProcessIsolation", 1)?;
    let inproc = format!("{clsid_key}\\InprocServer32");
    set_sz(HKEY_CURRENT_USER, &inproc, "", dll)?;
    set_sz(HKEY_CURRENT_USER, &inproc, "ThreadingModel", "Apartment")?;
    set_sz(
        HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        CLSID,
        DISPLAY,
    )?;
    ensure_surrogate()?;
    Ok(())
}

#[cfg(windows)]
fn remove_hkcu() -> Result<(), ToolError> {
    let backup = load_backup();
    let mut paths = shellex_paths();
    for entry in &backup {
        if entry.kind == "shellex" && !paths.iter().any(|p| p.eq_ignore_ascii_case(&entry.path)) {
            paths.push(entry.path.clone());
        }
    }
    for path in &paths {
        let saved = backup.iter().find(|e| e.kind == "shellex" && e.path.eq_ignore_ascii_case(path));
        if let Some(entry) = saved {
            if entry.existed {
                if let Some(previous) = &entry.previous {
                    set_sz(HKEY_CURRENT_USER, path, "", previous)?;
                    continue;
                }
            }
        }
        let current = query_sz(HKEY_CURRENT_USER, path, "").unwrap_or(None);
        if current.as_deref().is_some_and(|v| same_guid(v, CLSID)) || current.is_none() {
            delete_tree(HKEY_CURRENT_USER, path)?;
            let parent = path.rsplit_once('\\').map(|(p, _)| p).unwrap_or(path);
            delete_tree_if_empty(HKEY_CURRENT_USER, parent)?;
        }
    }
    delete_value(
        HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        CLSID,
    )?;
    delete_tree(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\CLSID\\{CLSID}"),
    )?;
    let keep_shared = svg_shellex_is_ours();
    if backup.iter().any(|e| e.kind == "surrogate") && !keep_shared {
        delete_tree(
            HKEY_CURRENT_USER,
            &format!("Software\\Classes\\AppID\\{APP_ID}"),
        )?;
    }
    if keep_shared {
        let kept: Vec<BackupEntry> = backup
            .into_iter()
            .filter(|entry| entry.kind == "svg" || entry.kind == "surrogate")
            .collect();
        save_backup(&kept)?;
    } else {
        let _ = fs::remove_file(backup_path());
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_surrogate() -> Result<(), ToolError> {
    let existing = query_sz(
        HKEY_LOCAL_MACHINE,
        &format!("SOFTWARE\\Classes\\AppID\\{APP_ID}"),
        "DllSurrogate",
    )?;
    if existing
        .as_deref()
        .is_some_and(|v| v.to_ascii_lowercase().contains("prevhost.exe"))
    {
        log_line("register", "appid surrogate=system", 0);
        return Ok(());
    }
    let system = env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let surrogate = format!("{system}\\System32\\prevhost.exe");
    set_sz(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\AppID\\{APP_ID}"),
        "DllSurrogate",
        &surrogate,
    )?;
    let mut entries = load_backup();
    if !entries.iter().any(|e| e.kind == "surrogate") {
        entries.push(BackupEntry {
            kind: "surrogate".to_string(),
            path: format!("Software\\Classes\\AppID\\{APP_ID}"),
            existed: false,
            previous: None,
        });
        save_backup(&entries)?;
    }
    log_line("register", "appid surrogate=hkcu", 0);
    Ok(())
}

#[cfg(windows)]
fn shellex_paths() -> Vec<String> {
    let mut paths = vec![format!(
        "Software\\Classes\\.md\\shellex\\{SHELLEX}"
    )];
    for prog in prog_ids() {
        paths.push(format!("Software\\Classes\\{prog}\\shellex\\{SHELLEX}"));
    }
    paths
}

#[cfg(windows)]
fn prog_ids() -> Vec<String> {
    let mut ids = Vec::new();
    let candidates = [
        query_sz(
            HKEY_CURRENT_USER,
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice",
            "ProgId",
        ),
        query_sz(HKEY_CURRENT_USER, "Software\\Classes\\.md", ""),
        query_sz(HKEY_LOCAL_MACHINE, "SOFTWARE\\Classes\\.md", ""),
    ];
    for candidate in candidates {
        if let Ok(Some(id)) = candidate {
            push_progid(&mut ids, &id);
        }
    }
    ids
}

fn push_progid(ids: &mut Vec<String>, id: &str) {
    if !allow_progid(id) {
        return;
    }
    if ids.iter().any(|have| have.eq_ignore_ascii_case(id)) {
        return;
    }
    ids.push(id.to_string());
}

fn allow_progid(id: &str) -> bool {
    let text = id.trim();
    if text.is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    if lower.contains("pdf") || lower.contains("adobe") || lower.contains("acroexch") {
        return false;
    }
    if lower.ends_with(".svg") || lower == "svg" {
        return false;
    }
    true
}

fn same_guid(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

#[derive(Clone, Debug)]
struct BackupEntry {
    kind: String,
    path: String,
    existed: bool,
    previous: Option<String>,
}

#[cfg(windows)]
fn remember_shellex(paths: &[String]) -> Result<(), ToolError> {
    remember_kind("shellex", CLSID, paths)
}

#[cfg(windows)]
fn remember_kind(kind: &str, clsid: &str, paths: &[String]) -> Result<(), ToolError> {
    let mut entries = load_backup();
    for path in paths {
        if entries
            .iter()
            .any(|e| e.kind == kind && e.path.eq_ignore_ascii_case(path))
        {
            continue;
        }
        let current = query_sz(HKEY_CURRENT_USER, path, "").unwrap_or(None);
        let (existed, previous) = match current {
            Some(value) if !same_guid(&value, clsid) => (true, Some(value)),
            Some(_) => (false, None),
            None => (false, None),
        };
        entries.push(BackupEntry {
            kind: kind.to_string(),
            path: path.clone(),
            existed,
            previous,
        });
    }
    save_backup(&entries)
}

#[cfg(windows)]
fn backup_path() -> PathBuf {
    let mut path = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("speedDF");
    path.push("preview-registration.txt");
    path
}

#[cfg(windows)]
fn load_backup() -> Vec<BackupEntry> {
    let text = fs::read_to_string(backup_path()).unwrap_or_default();
    parse_backup(&text)
}

fn parse_backup(text: &str) -> Vec<BackupEntry> {
    let mut entries = Vec::new();
    for line in text.lines() {
        if line.is_empty() || line.starts_with('v') && !line.contains('\t') {
            continue;
        }
        let mut parts = line.splitn(4, '\t');
        let kind = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        let existed = parts.next().unwrap_or("0") == "1";
        let previous = parts.next().filter(|v| !v.is_empty()).map(|v| v.to_string());
        if kind.is_empty() || path.is_empty() {
            continue;
        }
        entries.push(BackupEntry {
            kind,
            path,
            existed,
            previous,
        });
    }
    entries
}

#[cfg(windows)]
fn save_backup(entries: &[BackupEntry]) -> Result<(), ToolError> {
    let path = backup_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| ToolError::new(err.to_string(), 1))?;
    }
    let mut body = String::from("v1\n");
    for entry in entries {
        let previous = entry.previous.as_deref().unwrap_or("");
        if previous.contains('\t') || entry.path.contains('\t') {
            continue;
        }
        body.push_str(&entry.kind);
        body.push('\t');
        body.push_str(&entry.path);
        body.push('\t');
        body.push(if entry.existed { '1' } else { '0' });
        body.push('\t');
        body.push_str(previous);
        body.push('\n');
    }
    fs::write(&path, body).map_err(|err| ToolError::new(err.to_string(), 1))
}

#[cfg(windows)]
struct Status {
    explorer: bool,
    outlook: bool,
    svg: bool,
    dll_path: String,
}

#[cfg(windows)]
fn read_status() -> Status {
    let shellex = query_sz(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\.md\\shellex\\{SHELLEX}"),
        "",
    )
    .ok()
    .flatten();
    let listed = query_sz(
        HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
        CLSID,
    )
    .ok()
    .flatten();
    let dll = query_sz(
        HKEY_CURRENT_USER,
        &format!("Software\\Classes\\CLSID\\{CLSID}\\InprocServer32"),
        "",
    )
    .ok()
    .flatten()
    .unwrap_or_default();
    let (markdown_name, markdown_data) = clicktorun_entry(false);
    let outlook = query_sz(HKEY_LOCAL_MACHINE, CLICKTORUN_PREVIEW_HANDLERS, markdown_name)
        .ok()
        .flatten();
    let explorer = shellex.as_deref().is_some_and(|v| same_guid(v, CLSID))
        && listed.as_deref() == Some(DISPLAY);
    let outlook_ok = outlook.as_deref() == Some(markdown_data);
    Status {
        explorer,
        outlook: outlook_ok,
        svg: svg_is_on(),
        dll_path: dll,
    }
}

#[cfg(windows)]
fn status_json() -> Result<String, ToolError> {
    let status = read_status();
    Ok(format_status(
        status.explorer,
        status.outlook,
        status.svg,
        &status.dll_path,
    ))
}

fn format_status(explorer: bool, outlook: bool, svg: bool, dll_path: &str) -> String {
    format!(
        "{{\"explorer\":{},\"outlook_clicktorun\":{},\"svg\":{},\"dll_path\":{}}}",
        yes_no(explorer),
        yes_no(outlook),
        yes_no(svg),
        json_string(dll_path)
    )
}

fn yes_no(on: bool) -> &'static str {
    if on {
        "\"yes\""
    } else {
        "\"no\""
    }
}

fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(windows)]
fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret = 0u32;
        let ok = GetTokenInformation(
            token,
            windows::Win32::Security::TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret,
        );
        let _ = CloseHandle(token);
        ok.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[cfg(windows)]
fn elevate_self() -> Result<i32, ToolError> {
    let exe = env::current_exe().map_err(|err| ToolError::new(err.to_string(), 1))?;
    let mut params = String::new();
    for arg in env::args().skip(1) {
        if !params.is_empty() {
            params.push(' ');
        }
        params.push_str(&quote_arg(&arg));
    }
    let file = wide_null(exe.as_os_str());
    let parameters = wide_null(std::ffi::OsStr::new(&params));
    let verb = wide_null(std::ffi::OsStr::new("runas"));
    let directory = exe
        .parent()
        .map(|p| wide_null(p.as_os_str()))
        .unwrap_or_else(|| wide_null(std::ffi::OsStr::new("")));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        lpDirectory: PCWSTR(directory.as_ptr()),
        nShow: 0,
        ..Default::default()
    };
    if let Err(err) = unsafe { ShellExecuteExW(&mut info) } {
        let raw = err.code().0 as u32;
        let win = raw & 0xFFFF;
        if win == 1223 || raw == 1223 {
            log_line("elevate", "cancelled", raw);
            return Ok(EXIT_CANCELLED);
        }
        log_line("elevate", "failed", raw);
        return Err(ToolError::new(
            format!("elevation failed hr=0x{raw:08X}"),
            raw,
        ));
    }
    if info.hProcess.is_invalid() {
        return Err(ToolError::new("elevation did not return a process", 1));
    }
    unsafe {
        let _ = WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        log_line("elevate", &format!("child={code}"), 0);
        Ok(code as i32)
    }
}

fn quote_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".to_string();
    }
    if !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    for ch in arg.chars() {
        if ch == '"' {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('"');
    out
}

#[cfg(windows)]
fn wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn wide_str(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn utf16_bytes(value: &str) -> Vec<u8> {
    value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(|unit| unit.to_le_bytes())
        .collect()
}

#[cfg(windows)]
fn sam_read() -> windows::Win32::System::Registry::REG_SAM_FLAGS {
    KEY_READ | KEY_WOW64_64KEY
}

#[cfg(windows)]
fn sam_write() -> windows::Win32::System::Registry::REG_SAM_FLAGS {
    KEY_READ | KEY_WRITE | KEY_WOW64_64KEY
}

#[cfg(windows)]
fn create_key(root: HKEY, subkey: &str) -> Result<HKEY, ToolError> {
    let name = wide_str(subkey);
    let mut key = HKEY::default();
    let err = unsafe {
        RegCreateKeyExW(
            root,
            PCWSTR(name.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            sam_write(),
            None,
            &mut key,
            None,
        )
    };
    if err != ERROR_SUCCESS {
        return Err(ToolError::new(
            format!("create key failed {subkey} code={}", err.0),
            err.0,
        ));
    }
    Ok(key)
}

#[cfg(windows)]
fn open_key(root: HKEY, subkey: &str, write: bool) -> Result<Option<HKEY>, ToolError> {
    let name = wide_str(subkey);
    let mut key = HKEY::default();
    let access = if write { sam_write() } else { sam_read() };
    let err = unsafe { RegOpenKeyExW(root, PCWSTR(name.as_ptr()), Some(0), access, &mut key) };
    if err.0 == 2 {
        return Ok(None);
    }
    if err != ERROR_SUCCESS {
        return Err(ToolError::new(
            format!("open key failed {subkey} code={}", err.0),
            err.0,
        ));
    }
    Ok(Some(key))
}

#[cfg(windows)]
fn set_sz(root: HKEY, subkey: &str, name: &str, value: &str) -> Result<(), ToolError> {
    let key = create_key(root, subkey)?;
    let name_w = wide_str(name);
    let data = utf16_bytes(value);
    let err = unsafe {
        RegSetValueExW(
            key,
            PCWSTR(name_w.as_ptr()),
            None,
            REG_SZ,
            Some(data.as_slice()),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if err != ERROR_SUCCESS {
        return Err(ToolError::new(
            format!("set value failed {subkey} code={}", err.0),
            err.0,
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn set_dword(root: HKEY, subkey: &str, name: &str, value: u32) -> Result<(), ToolError> {
    let key = create_key(root, subkey)?;
    let name_w = wide_str(name);
    let data = value.to_le_bytes();
    let err = unsafe {
        RegSetValueExW(key, PCWSTR(name_w.as_ptr()), None, REG_DWORD, Some(&data))
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if err != ERROR_SUCCESS {
        return Err(ToolError::new(
            format!("set dword failed {subkey} code={}", err.0),
            err.0,
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn query_sz(root: HKEY, subkey: &str, name: &str) -> Result<Option<String>, ToolError> {
    let Some(key) = open_key(root, subkey, false)? else {
        return Ok(None);
    };
    let name_w = wide_str(name);
    let mut buf = vec![0u8; 2048];
    let mut ty = REG_VALUE_TYPE(0);
    let mut len = buf.len() as u32;
    let err = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name_w.as_ptr()),
            None,
            Some(&mut ty),
            Some(buf.as_mut_ptr()),
            Some(&mut len),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if err.0 == 2 {
        return Ok(None);
    }
    if err != ERROR_SUCCESS {
        return Err(ToolError::new(
            format!("query value failed {subkey} code={}", err.0),
            err.0,
        ));
    }
    if ty != REG_SZ {
        return Ok(None);
    }
    let n = (len as usize).min(buf.len()) / 2;
    let mut units = Vec::with_capacity(n);
    for chunk in buf[..n * 2].chunks_exact(2) {
        units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    if units.last() == Some(&0) {
        units.pop();
    }
    Ok(Some(String::from_utf16_lossy(&units)))
}

#[cfg(windows)]
fn delete_value(root: HKEY, subkey: &str, name: &str) -> Result<(), ToolError> {
    let Some(key) = open_key(root, subkey, true)? else {
        return Ok(());
    };
    let name_w = wide_str(name);
    let err = unsafe { RegDeleteValueW(key, PCWSTR(name_w.as_ptr())) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if err.0 == 2 || err == ERROR_SUCCESS {
        return Ok(());
    }
    Err(ToolError::new(
        format!("delete value failed {subkey}\\{name} code={}", err.0),
        err.0,
    ))
}

#[cfg(windows)]
fn delete_tree(root: HKEY, subkey: &str) -> Result<(), ToolError> {
    let name = wide_str(subkey);
    let err = unsafe { RegDeleteTreeW(root, PCWSTR(name.as_ptr())) };
    if err.0 == 2 || err == ERROR_SUCCESS {
        return Ok(());
    }
    Err(ToolError::new(
        format!("delete key failed {subkey} code={}", err.0),
        err.0,
    ))
}

#[cfg(windows)]
fn delete_tree_if_empty(root: HKEY, subkey: &str) -> Result<(), ToolError> {
    let Some(key) = open_key(root, subkey, false)? else {
        return Ok(());
    };
    let mut name_buf = [0u16; 8];
    let mut name_len = 1u32;
    let err = unsafe {
        windows::Win32::System::Registry::RegEnumKeyExW(
            key,
            0,
            Some(PWSTR(name_buf.as_mut_ptr())),
            &mut name_len,
            None,
            None,
            None,
            None,
        )
    };
    let mut val_len = 0u32;
    let val_err = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR::null(),
            None,
            None,
            None,
            Some(&mut val_len),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    let no_subkey = err.0 == 259;
    let no_default = val_err.0 == 2;
    if no_subkey && no_default {
        delete_tree(root, subkey)?;
    }
    Ok(())
}

#[cfg(windows)]
fn prepare_runtime_dirs() {
    label_log_low();
    let Some(local) = env::var_os("LOCALAPPDATA") else {
        return;
    };
    let root = PathBuf::from(local).join("speedDF").join("preview-wv2");
    if fs::create_dir_all(&root).is_err() {
        log_line("register", "user-data create failed", 5);
        return;
    }
    let sid = current_user_sid();
    let Some(sid) = sid else {
        log_line("register", "user-data sid unavailable", 0);
        return;
    };
    let path = root.to_string_lossy().to_string();
    let user_ace = format!("*{sid}:(OI)(CI)F");
    let _ = hidden_command("icacls")
        .arg(&path)
        .args(["/inheritance:r"])
        .status();
    let _ = hidden_command("icacls").arg(&path).args([
        "/grant:r",
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
        &user_ace,
    ]).status();
    let _ = hidden_command("icacls")
        .arg(&path)
        .args(["/setintegritylevel", "(OI)(CI)L"])
        .status();
    log_line("register", "user-data labeled", 0);
}

#[cfg(windows)]
fn label_log_low() {
    let path = log_file();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if !path.exists() {
        let _ = OpenOptions::new().create(true).append(true).open(&path);
    }
    let _ = hidden_command("icacls")
        .arg(&path)
        .args(["/setintegritylevel", "L"])
        .status();
}

#[cfg(windows)]
fn current_user_sid() -> Option<String> {
    let output = hidden_command("whoami").args(["/user", "/fo", "csv", "/nh"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    sid_from_whoami_csv(&text)
}

fn sid_from_whoami_csv(text: &str) -> Option<String> {
    for line in text.lines() {
        let Some(start) = line.find("S-1-") else {
            continue;
        };
        let rest = &line[start..];
        let end = rest
            .find(|c: char| c == '"' || c == ',' || c.is_whitespace())
            .unwrap_or(rest.len());
        let sid = &rest[..end];
        if sid.starts_with("S-1-") && sid.len() > 4 {
            return Some(sid.to_string());
        }
    }
    None
}

#[cfg(windows)]
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(windows)]
fn log_file() -> PathBuf {
    if let Some(profile) = env::var_os("USERPROFILE") {
        let dir = PathBuf::from(profile)
            .join("AppData")
            .join("Local")
            .join("Temp");
        if dir.is_dir() {
            return dir.join("speeddf-preview.log");
        }
    }
    env::temp_dir().join("speeddf-preview.log")
}

#[cfg(windows)]
fn log_line(op: &str, detail: &str, code: u32) {
    let path = log_file();
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let hr = if code == 0 {
        0u32
    } else if code > 0xFFFF {
        code
    } else {
        0x8007_0000 | (code & 0xFFFF)
    };
    let stamp = log_stamp();
    let pid = unsafe { GetCurrentProcessId() };
    let tid = unsafe { GetCurrentThreadId() };
    let _ = writeln!(
        file,
        "{stamp} pid={pid} tid={tid} host=speeddf-preview-register.exe {op} {detail} hr=0x{hr:08X}"
    );
}

#[cfg(windows)]
fn log_stamp() -> String {
    let now = unsafe { GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, now.wMilliseconds
    )
}

#[cfg(test)]
mod tests {
    use super::{
        allow_progid, clicktorun_entry, format_status, parse_args, parse_backup, plan_for,
        push_progid, quote_arg, sid_from_whoami_csv, CommandKind,
    };

    #[test]
    fn parses_commands_and_rejects_other_extensions() {
        let args = parse_args(["status".to_string()]).unwrap();
        assert_eq!(args.command, CommandKind::Status);
        let args = parse_args([
            "register".to_string(),
            "--dll".to_string(),
            r"C:\abs\speeddf_preview.dll".to_string(),
        ])
        .unwrap();
        assert_eq!(args.command, CommandKind::Register);
        assert!(args.dll.unwrap().ends_with("speeddf_preview.dll"));
        assert!(!args.svg);
        assert!(parse_args(["--preview".to_string()]).is_err());
        assert!(parse_args(["register".to_string(), "--pdf".to_string()]).is_err());
        let svg = parse_args([
            "register".to_string(),
            "--svg".to_string(),
            "--dll".to_string(),
            r"C:\abs\speeddf_preview.dll".to_string(),
        ])
        .unwrap();
        assert!(svg.svg);
        assert_eq!(svg.command, CommandKind::Register);
    }

    #[test]
    fn svg_registration_does_not_touch_markdown_or_pdf() {
        let markdown = plan_for(CommandKind::Register, false);
        assert!(markdown.markdown && markdown.clicktorun);
        assert!(!markdown.svg && !markdown.svg_clicktorun && !markdown.pdf);
        let svg = plan_for(CommandKind::Register, true);
        assert!(svg.svg && svg.svg_clicktorun);
        assert!(!svg.markdown && !svg.clicktorun && !svg.pdf);
        let (svg_name, svg_data) = clicktorun_entry(true);
        let (md_name, md_data) = clicktorun_entry(false);
        assert_eq!(svg_name, "{C3B7A91E-5D24-4E68-8F10-6A2D9C4B7E15}");
        assert_eq!(svg_data, "speedDF SVG Preview");
        assert_eq!(md_name, "{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}");
        assert_eq!(md_data, "speedDF Markdown Preview");
        assert_ne!(svg_name, md_name);
        let off = plan_for(CommandKind::Unregister, true);
        assert!(off.svg && off.svg_clicktorun);
        assert!(!off.markdown && !off.clicktorun && !off.pdf);
        let markdown_off = plan_for(CommandKind::Unregister, false);
        assert!(markdown_off.markdown && markdown_off.clicktorun);
        assert!(!markdown_off.svg && !markdown_off.svg_clicktorun);
        let status = plan_for(CommandKind::Status, true);
        assert!(!status.clicktorun && !status.svg_clicktorun && !status.pdf);
    }

    #[test]
    fn progid_skips_pdf_and_svg() {
        assert!(allow_progid("Markdown"));
        assert!(!allow_progid("Adobe.PDF"));
        assert!(!allow_progid("Foo.acroexch"));
        assert!(!allow_progid("pdf"));
        assert!(!allow_progid("image.svg"));
        let mut ids = Vec::new();
        push_progid(&mut ids, "Markdown");
        push_progid(&mut ids, "markdown");
        push_progid(&mut ids, "Adobe.PDF");
        assert_eq!(ids, vec!["Markdown".to_string()]);
    }

    #[test]
    fn status_json_escapes_the_dll_path() {
        let line = format_status(true, false, true, r"C:\a\speeddf_preview.dll");
        assert!(line.contains("\"explorer\":\"yes\""));
        assert!(line.contains("\"outlook_clicktorun\":\"no\""));
        assert!(line.contains("\"svg\":\"yes\""));
        assert!(line.contains(r#""dll_path":"C:\\a\\speeddf_preview.dll""#));
    }

    #[test]
    fn backup_round_trip_and_sid_parse() {
        let text = "v1\nshellex\tSoftware\\Classes\\.md\\shellex\\{8895b1c6-b41f-4c1c-a562-0d564250836f}\t1\t{OLD}\n";
        let entries = parse_backup(text);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].existed);
        assert_eq!(entries[0].previous.as_deref(), Some("{OLD}"));
        let csv = "\"TRIPLEM\\user\",\"S-1-5-21-1-2-3-4\"\r\n";
        assert_eq!(sid_from_whoami_csv(csv).as_deref(), Some("S-1-5-21-1-2-3-4"));
    }

    #[test]
    fn quotes_paths_with_spaces() {
        assert_eq!(quote_arg(r"C:\Program Files\speeddf_preview.dll"), "\"C:\\Program Files\\speeddf_preview.dll\"");
        assert_eq!(quote_arg("register"), "register");
    }
}
