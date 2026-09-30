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
    if action != "register" && action != "unregister" {
        return Err("Preview action must be register or unregister.".to_string());
    }
    let (helper, dll) = find_pair(&app)?;
    if action == "register" && !dll.is_file() {
        return Err(format!(
            "Markdown preview DLL was not found next to the helper ({}).",
            dll.display()
        ));
    }
    let helper_for_status = helper.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_helper(
            &helper,
            if action == "register" {
                vec![
                    "register".to_string(),
                    "--dll".to_string(),
                    dll.to_string_lossy().to_string(),
                ]
            } else {
                vec!["unregister".to_string()]
            },
        )
    })
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
    Ok(PreviewRegistration {
        explorer,
        outlook_clicktorun: outlook,
        dll_path,
        cancelled: false,
        message: String::new(),
    })
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

fn find_pair(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    for dir in candidate_dirs(app) {
        let helper = dir.join("speeddf-preview-register.exe");
        if !helper.is_file() {
            continue;
        }
        let sibling = dir.join("speeddf_preview.dll");
        if sibling.is_file() {
            return Ok((helper, sibling));
        }
        let deps = dir.join("deps").join("speeddf_preview.dll");
        if deps.is_file() {
            return Ok((helper, deps));
        }
        return Ok((helper, sibling));
    }
    Err(
        "speeddf-preview-register.exe was not found. Build it from speeddf-preview before enabling Markdown preview."
            .to_string(),
    )
}

fn candidate_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        dirs.push(resource.join("preview"));
        dirs.push(resource);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("preview"));
            dirs.push(dir.to_path_buf());
            let mut up = dir.to_path_buf();
            for _ in 0..6 {
                dirs.push(up.join("speeddf-preview").join("target").join("release"));
                dirs.push(up.join("speeddf-preview").join("target").join("debug"));
                if !up.pop() {
                    break;
                }
            }
        }
    }
    dirs
}
