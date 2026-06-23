use std::fs::File;
use std::io::{Read, Write};

// ⚡ NEW: Shared payload structure to wrap both the byte array and filename together
#[derive(serde::Serialize)]
pub struct FilePayload {
    bytes: Vec<u8>,
    name: String,
    path: String,
}

#[tauri::command]
async fn check_startup_file() -> Option<FilePayload> {
    // Loop through command line parameters skipping index 0 (the executable location itself)
    for arg in std::env::args().skip(1) {
        if arg.to_lowercase().ends_with(".pdf") {
            let path = std::path::Path::new(&arg);
            if path.exists() && path.is_file() {
                if let Some(file_name) = path.file_name() {
                    let name = file_name.to_string_lossy().into_owned();
                    let path_str = path.to_string_lossy().into_owned();
                    if let Ok(mut file) = File::open(path) {
                        let mut buffer = Vec::new();
                        if file.read_to_end(&mut buffer).is_ok() {
                            return Some(FilePayload {
                                bytes: buffer,
                                name,
                                path: path_str,
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

// 1. NATIVE WINDOWS FILE OPEN DIALOG
#[tauri::command]
async fn native_open_file() -> Result<FilePayload, String> {
    // Native Windows system dialog abstraction via rfd (Tauri default engine)
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .pick_file()
        .await;

    match file_path {
        Some(handle) => {
            let path = handle.path();
            let path_str = path.to_string_lossy().into_owned();
            // ⚡ EXTRACT THE TRUE FILENAME directly from the async dialog handle
            let file_name = handle.file_name();

            let mut file = File::open(path).map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

            // Return the unified payload object back across the Tauri bridge
            Ok(FilePayload {
                bytes: buffer,
                name: file_name,
                path: path_str,
            })
        }
        None => Err("User cancelled file selection".to_string()),
    }
}

// 2. NATIVE WINDOWS FILE SAVE AS DIALOG
#[tauri::command]
async fn native_save_as_file(file_bytes: Vec<u8>, default_path: Option<String>) -> Result<String, String> {
    let file_name = default_path.unwrap_or_else(|| "edited_document.pdf".to_string());
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .set_file_name(&file_name)
        .save_file()
        .await;

    match file_path {
        Some(handle) => {
            let path = handle.path();
            let path_str = path.to_string_lossy().into_owned();
            let mut file = File::create(path).map_err(|e| e.to_string())?;
            file.write_all(&file_bytes).map_err(|e| e.to_string())?;
            Ok(path_str)
        }
        None => Err("User cancelled save layout".to_string()),
    }
}

#[tauri::command]
async fn native_overwrite_file(path: String, file_bytes: Vec<u8>) -> Result<String, String> {
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(&file_bytes).map_err(|e| e.to_string())?;
    Ok("File saved successfully".to_string())
}

#[tauri::command]
fn unprotect_pdf(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    // ⚡ Upgraded lopdf automatically detects empty-password protection
    // and decrypts all object streams safely into memory during load_mem.
    let mut doc = lopdf::Document::load_mem(&bytes).map_err(|e| e.to_string())?;

    // Simply strip the global encryption dictionary entry so it saves as a standard open PDF
    doc.trailer.remove(b"Encrypt");

    let mut out_bytes = Vec::new();
    doc.save_to(&mut out_bytes).map_err(|e| e.to_string())?;
    Ok(out_bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            native_open_file,
            native_save_as_file,
            native_overwrite_file,
            check_startup_file,
            unprotect_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
