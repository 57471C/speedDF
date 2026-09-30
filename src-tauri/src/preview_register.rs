//! Settings talks to speeddf-preview-register.exe.
//! Status is unelevated. Register and unregister let the helper show UAC.
//! A cancelled prompt comes back as exit 1223 and this command re-reads status.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Output;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize)]
pub struct PreviewRegistration {
    pub explorer: String,
    pub outlook_clicktorun: String,
    pub svg: String,
    pub dll_path: String,
    pub cancelled: bool,
    pub message: String,
}

#[tauri::command]
pub async fn preview_registration_status(
    app: AppHandle,
) -> Result<PreviewRegistration, String> {
    let helper = find_helper(&app)?;
    read_status(&helper).await
}

#[tauri::command]
pub async fn preview_registration_apply(
    app: AppHandle,
    action: String,
) -> Result<PreviewRegistration, String> {
    let (helper, dll) = find_pair(&app)?;
    let args = helper_args(&action, &dll)?;
    if needs_dll(&action) && !dll.is_file() {
        let label = if action == "register" {
            "Markdown preview DLL"
        } else {
            "Preview DLL"
        };
        return Err(format!(
            "{label} was not found next to the helper ({}).",
            dll.display()
        ));
    }
    let helper_for_status = helper.clone();
    let output = tauri::async_runtime::spawn_blocking(move || run_helper(&helper, args))
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    let code = output.status.code().unwrap_or(1);
    let mut status = read_status(&helper_for_status).await?;
    if code == 1223 {
        status.cancelled = true;
        status.message = "Administrator approval was cancelled.".to_string();
        return Ok(status);
    }
    if code != 0 {
        let detail = stderr_text(&output);
        status.message = if detail.is_empty() {
            format!("Preview helper exited {code}.")
        } else {
            detail
        };
        return Ok(status);
    }
    if let Ok(parsed) = parse_status(&stdout_text(&output)) {
        status.explorer = parsed.explorer;
        status.outlook_clicktorun = parsed.outlook_clicktorun;
        status.svg = parsed.svg;
        status.dll_path = parsed.dll_path;
    }
    Ok(status)
}

async fn read_status(helper: &Path) -> Result<PreviewRegistration, String> {
    let helper = helper.to_path_buf();
    let output = tauri::async_runtime::spawn_blocking(move || run_helper(&helper, vec!["status".to_string()]))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        let detail = stderr_text(&output);
        return Err(if detail.is_empty() {
            "Preview helper status failed.".to_string()
        } else {
            detail
        });
    }
    let mut status = parse_status(&stdout_text(&output))?;
    status.cancelled = false;
    status.message.clear();
    Ok(status)
}

fn parse_status(stdout: &str) -> Result<PreviewRegistration, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| "Preview helper returned no status.".to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|err| format!("Preview status was not JSON: {err}"))?;
    let explorer = value
        .get("explorer")
        .and_then(|v| v.as_str())
        .unwrap_or("no")
        .to_string();
    let outlook = value
        .get("outlook_clicktorun")
        .and_then(|v| v.as_str())
        .unwrap_or("no")
        .to_string();
    let dll_path = value
        .get("dll_path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let svg = value
        .get("svg")
        .and_then(|v| v.as_str())
        .filter(|v| *v == "yes" || *v == "no")
        .unwrap_or("no")
        .to_string();
    Ok(PreviewRegistration {
        explorer,
        outlook_clicktorun: outlook,
        svg,
        dll_path,
        cancelled: false,
        message: String::new(),
    })
}

/// Markdown actions never pass `--svg`. SVG actions never pass a markdown-only register.
fn helper_args(action: &str, dll: &Path) -> Result<Vec<String>, String> {
    let dll_arg = dll.to_string_lossy().to_string();
    match action {
        "register" => Ok(vec![
            "register".to_string(),
            "--dll".to_string(),
            dll_arg,
        ]),
        "unregister" => Ok(vec!["unregister".to_string()]),
        "register-svg" => Ok(vec![
            "register".to_string(),
            "--svg".to_string(),
            "--dll".to_string(),
            dll_arg,
        ]),
        "unregister-svg" => Ok(vec!["unregister".to_string(), "--svg".to_string()]),
        _ => Err(
            "Preview action must be register, unregister, register-svg, or unregister-svg."
                .to_string(),
        ),
    }
}

fn needs_dll(action: &str) -> bool {
    action == "register" || action == "register-svg"
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

fn run_helper(helper: &Path, args: Vec<String>) -> std::io::Result<Output> {
    let mut cmd = std::process::Command::new(helper);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
}

fn find_helper(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(find_pair(app)?.0)
}

/// Cargo cdylib name. The Windows bundle copies this file beside speeddf.exe.
const DLL_FILE: &str = "speeddf_preview.dll";
const HELPER_FILE: &str = "speeddf-preview-register.exe";

fn find_pair(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let mut helper_without_dll: Option<(PathBuf, PathBuf)> = None;
    for dir in candidate_dirs(app) {
        let helper = dir.join(HELPER_FILE);
        if !helper.is_file() {
            continue;
        }
        if let Some(dll) = dll_beside(&dir) {
            return Ok((helper, dll));
        }
        if helper_without_dll.is_none() {
            helper_without_dll = Some((helper, dir.join(DLL_FILE)));
        }
    }
    helper_without_dll.ok_or_else(|| {
        "speeddf-preview-register.exe was not found beside speeddf.exe. Build speeddf-preview before enabling Markdown preview."
            .to_string()
    })
}

/// Install directory first (beside speeddf.exe). Dev builds then check
/// speeddf-preview/target/release and debug.
fn candidate_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        push_dir(&mut dirs, resource);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push_dir(&mut dirs, dir.to_path_buf());
            let mut up = dir.to_path_buf();
            for _ in 0..6 {
                push_dir(
                    &mut dirs,
                    up.join("speeddf-preview").join("target").join("release"),
                );
                push_dir(
                    &mut dirs,
                    up.join("speeddf-preview").join("target").join("debug"),
                );
                if !up.pop() {
                    break;
                }
            }
        }
    }
    dirs
}

fn push_dir(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

/// Same lookup the helper uses when `--dll` is omitted: beside the helper, then cargo `deps/`.
fn dll_beside(dir: &Path) -> Option<PathBuf> {
    let sibling = dir.join(DLL_FILE);
    if sibling.is_file() {
        return Some(sibling);
    }
    let deps = dir.join("deps").join(DLL_FILE);
    if deps.is_file() {
        return Some(deps);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{dll_beside, helper_args, needs_dll, parse_status, push_dir, DLL_FILE, HELPER_FILE};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("speeddf-preview-path-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn dll_beside_prefers_the_install_directory_name() {
        let dir = scratch();
        let sibling = dir.join(DLL_FILE);
        fs::write(&sibling, b"mz").unwrap();
        fs::create_dir_all(dir.join("deps")).unwrap();
        fs::write(dir.join("deps").join(DLL_FILE), b"deps").unwrap();
        assert_eq!(dll_beside(&dir).as_deref(), Some(sibling.as_path()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dll_beside_uses_cargo_deps_when_the_sibling_is_absent() {
        let dir = scratch();
        fs::create_dir_all(dir.join("deps")).unwrap();
        let deps = dir.join("deps").join(DLL_FILE);
        fs::write(&deps, b"mz").unwrap();
        assert_eq!(dll_beside(&dir).as_deref(), Some(deps.as_path()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_dir_is_listed_once_before_the_dev_tree() {
        let mut dirs = Vec::new();
        let app = PathBuf::from(r"C:\Program Files\speeddf");
        push_dir(&mut dirs, app.clone());
        push_dir(&mut dirs, app.clone());
        push_dir(
            &mut dirs,
            app.join("speeddf-preview").join("target").join("release"),
        );
        assert_eq!(dirs.len(), 2);
        assert_eq!(dirs[0], app);
        assert!(dirs[0].join(HELPER_FILE).ends_with(HELPER_FILE));
    }

    #[test]
    fn markdown_actions_do_not_pass_svg() {
        let dll = PathBuf::from(r"C:\speeddf_preview.dll");
        let register = helper_args("register", &dll).unwrap();
        assert_eq!(
            register,
            vec![
                "register".to_string(),
                "--dll".to_string(),
                r"C:\speeddf_preview.dll".to_string()
            ]
        );
        assert!(!register.iter().any(|arg| arg == "--svg"));
        assert_eq!(
            helper_args("unregister", &dll).unwrap(),
            vec!["unregister".to_string()]
        );
        let svg = helper_args("register-svg", &dll).unwrap();
        assert_eq!(
            svg,
            vec![
                "register".to_string(),
                "--svg".to_string(),
                "--dll".to_string(),
                r"C:\speeddf_preview.dll".to_string()
            ]
        );
        assert_eq!(
            helper_args("unregister-svg", &dll).unwrap(),
            vec!["unregister".to_string(), "--svg".to_string()]
        );
        assert!(helper_args("register-pdf", &dll).is_err());
        assert!(needs_dll("register") && needs_dll("register-svg"));
        assert!(!needs_dll("unregister") && !needs_dll("unregister-svg"));
    }

    #[test]
    fn missing_svg_field_is_off() {
        let parsed = parse_status(
            r#"{"explorer":"yes","outlook_clicktorun":"no","dll_path":"C:\\speeddf_preview.dll"}"#,
        )
        .unwrap();
        assert_eq!(parsed.svg, "no");
        assert_eq!(parsed.explorer, "yes");
        let svg = parse_status(
            r#"{"explorer":"no","outlook_clicktorun":"yes","svg":"yes","dll_path":""}"#,
        )
        .unwrap();
        assert_eq!(svg.svg, "yes");
        assert_eq!(svg.outlook_clicktorun, "yes");
    }
}
