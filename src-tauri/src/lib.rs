use std::fs::File;
use std::io::{Read, Write};
use std::io::Cursor;
use tiff::decoder::{Decoder, DecodingResult};

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
fn unprotect_pdf(bytes: Vec<u8>) -> Result<tauri::ipc::Response, String> {
    // ⚡ Upgraded lopdf automatically detects empty-password protection
    // and decrypts all object streams safely into memory during load_mem.
    let mut doc = lopdf::Document::load_mem(&bytes).map_err(|e| e.to_string())?;

    // Simply strip the global encryption dictionary entry so it saves as a standard open PDF
    doc.trailer.remove(b"Encrypt");

    let mut out_bytes = Vec::new();
    doc.save_to(&mut out_bytes).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(out_bytes))
}

#[tauri::command]
async fn write_temp_file(bytes: Vec<u8>, file_name: String) -> Result<String, String> {
    let mut temp_path = std::env::temp_dir();
    temp_path.push(file_name);
    std::fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;
    Ok(temp_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn print_via_edge(file_path: String) {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("msedge")
            .args(["--start-fullscreen", &file_path])
            .spawn()
            .ok();
    }
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> std::collections::HashMap<String, bool> {
    paths.into_iter()
        .map(|path| {
            let exists = std::path::Path::new(&path).exists();
            (path, exists)
        })
        .collect()
}

#[tauri::command]
async fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    Ok(buffer)
}

#[tauri::command]
async fn read_file_bytes(path: String) -> Result<FilePayload, String> {
    let path_buf = std::path::Path::new(&path);
    if !path_buf.exists() || !path_buf.is_file() {
        return Err("File does not exist or is not a file".to_string());
    }
    let file_name = path_buf.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document.pdf".to_string());
    
    let mut file = File::open(path_buf).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    
    Ok(FilePayload {
        bytes: buffer,
        name: file_name,
        path: path.clone(),
    })
}

#[tauri::command]
async fn parse_tiff_document(path: String) -> Result<Vec<Vec<u8>>, String> {
    // Read the file natively straight from disk to avoid frontend JSON serialization overhead
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file from disk: {}", e))?;
    let cursor = Cursor::new(bytes);
    let mut decoder = Decoder::new(cursor).map_err(|e| format!("TIFF Decoder initialization error: {}", e))?;
    let mut pages = Vec::new();

    loop {
        let (width, height) = decoder.dimensions().map_err(|e| e.to_string())?;
        let colortype = decoder.colortype().map_err(|e| format!("Failed to read color type: {}", e))?;
        let img_data = decoder.read_image().map_err(|e| e.to_string())?;
        
        let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);

        match img_data {
            DecodingResult::U8(data) => {
                match colortype {
                    tiff::ColorType::RGB(_) => {
                        for chunk in data.chunks_exact(3) {
                            rgba_buffer.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]);
                        }
                    }
                    tiff::ColorType::RGBA(_) => {
                        rgba_buffer.extend(data);
                    }
                    tiff::ColorType::Gray(bits) => {
                        if bits == 1 {
                            if data.len() == (width * height) as usize {
                                // If it's already unpacked/expanded to 1 byte per pixel by the decoder layer
                                for gray in data {
                                    rgba_buffer.extend_from_slice(&[gray, gray, gray, 255]);
                                }
                            } else {
                                // Unpack packed bits (1 bit per pixel, with each row padded to a byte boundary per TIFF spec)
                                let bytes_per_row = ((width + 7) / 8) as usize;
                                for r in 0..height as usize {
                                    let row_offset = r * bytes_per_row;
                                    for c in 0..width as usize {
                                        let byte_idx = row_offset + (c / 8);
                                        let bit_idx = 7 - (c % 8); // Standard MSB-to-LSB bit arrangement
                                        if byte_idx < data.len() {
                                            let bit = (data[byte_idx] >> bit_idx) & 1;
                                            // Map 1-bit binary values to standard technical blueprint layouts
                                            // 1 = White Paper Background (255), 0 = Black Ink Line (0)
                                            let gray = if bit == 1 { 255 } else { 0 };
                                            rgba_buffer.extend_from_slice(&[gray, gray, gray, 255]);
                                        }
                                    }
                                }
                            }
                        } else {
                            // Standard 8-bit grayscale channels (1 byte per pixel)
                            for gray in data {
                                rgba_buffer.extend_from_slice(&[gray, gray, gray, 255]);
                            }
                        }
                    }
                    _ => return Err(format!("Unsupported TIFF color profile depth: {:?}", colortype)),
                }
            }
            DecodingResult::U16(data) => {
                match colortype {
                    tiff::ColorType::RGB(_) => {
                        for chunk in data.chunks_exact(3) {
                            rgba_buffer.extend_from_slice(&[
                                (chunk[0] >> 8) as u8,
                                (chunk[1] >> 8) as u8,
                                (chunk[2] >> 8) as u8,
                                255,
                            ]);
                        }
                    }
                    tiff::ColorType::RGBA(_) => {
                        for chunk in data.chunks_exact(4) {
                            rgba_buffer.extend_from_slice(&[
                                (chunk[0] >> 8) as u8,
                                (chunk[1] >> 8) as u8,
                                (chunk[2] >> 8) as u8,
                                (chunk[3] >> 8) as u8,
                            ]);
                        }
                    }
                    tiff::ColorType::Gray(_) => {
                        for gray in data {
                            let val = (gray >> 8) as u8;
                            rgba_buffer.extend_from_slice(&[val, val, val, 255]);
                        }
                    }
                    _ => return Err(format!("Unsupported 16-bit TIFF color layout: {:?}", colortype)),
                }
            }
            _ => return Err("Unsupported binary block bitstream format layout encountered".to_string()),
        }

        // Safety verification: Ensure the byte buffer length perfectly matches the expected canvas dimensions
        if rgba_buffer.len() != (width * height * 4) as usize {
            return Err(format!(
                "Extracted pixel buffer dimension constraint violation: expected {}, got {}", 
                width * height * 4, rgba_buffer.len()
            ));
        }

        // Compress the normalized pixel array into a web-safe PNG byte vector wrapper
        let mut png_bytes = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
        image::ImageEncoder::write_image(
            encoder,
            &rgba_buffer,
            width,
            height,
            image::ExtendedColorType::Rgba8,
        ).map_err(|e| format!("PNG generation fallback encoder error: {}", e))?;

        pages.push(png_bytes);

        if !decoder.more_images() {
            break;
        }
        decoder.next_image().map_err(|e| e.to_string())?;
    }

    Ok(pages)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|_app| {
            // Spawn a separate thread immediately to keep the UI initialization instantaneous
            std::thread::spawn(|| {
                let temp_dir = std::env::temp_dir();
                println!("Background Sweep: Scanning temp directory: {:?}", temp_dir);
                
                if let Ok(entries) = std::fs::read_dir(temp_dir) {
                    for entry in entries.flatten() {
                        if let Ok(file_name) = entry.file_name().into_string() {
                            // Match our specific print signature files
                            if file_name.starts_with("speedDF_print_") && file_name.ends_with(".pdf") {
                                let path = entry.path();
                                if let Err(e) = std::fs::remove_file(&path) {
                                    eprintln!("Background Sweep Error: Failed to purge {:?}: {}", path, e);
                                } else {
                                    println!("Background Sweep: Cleaned up cached print file: {:?}", path);
                                }
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_open_file,
            native_save_as_file,
            native_overwrite_file,
            check_startup_file,
            unprotect_pdf,
            write_temp_file,
            print_via_edge,
            check_files_exist,
            read_file_bytes,
            read_file_binary,
            parse_tiff_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
