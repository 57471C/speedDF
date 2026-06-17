use std::fs::File;
use std::io::{Read, Write};

// 1. NATIVE WINDOWS FILE OPEN DIALOG
#[tauri::command]
async fn native_open_file() -> Result<Vec<u8>, String> {
    // Native Windows system dialog abstraction via rfd (Tauri default engine)
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .pick_file()
        .await;

    match file_path {
        Some(handle) => {
            let path = handle.path();
            let mut file = File::open(path).map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            Ok(buffer) // Send the clean, raw binary byte stream to Svelte!
        }
        None => Err("User cancelled file selection".to_string()),
    }
}

// 2. NATIVE WINDOWS FILE SAVE AS DIALOG
#[tauri::command]
async fn native_save_as_file(file_bytes: Vec<u8>) -> Result<String, String> {
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .set_file_name("edited_document.pdf")
        .save_file()
        .await;

    match file_path {
        Some(handle) => {
            let path = handle.path();
            let mut file = File::create(path).map_err(|e| e.to_string())?;
            file.write_all(&file_bytes).map_err(|e| e.to_string())?;
            Ok("File saved successfully".to_string())
        }
        None => Err("User cancelled save layout".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Swapped out the old shell reference to use your modern default template plugin!
        .plugin(tauri_plugin_opener::init())
        // Register our file utilities so the frontend can invoke them!
        .invoke_handler(tauri::generate_handler![native_open_file, native_save_as_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}