use std::fs::File;

use std::io::{Read, Write};
use std::path::{Component, Path};
use tiff::decoder::{Decoder, DecodingResult};
mod commands;
use commands::run_local_ocr;

/// Validates that an incoming frontend path string does not contain parent directory
/// traversal sequences (`..`) and resolves to a legitimate absolute location.
///
/// Desktop document apps intentionally allow any *absolute* user file path (dialogs,
/// recents, open-with). Protection targets relative paths, `..` components, and
/// null-byte injection — not a directory sandbox.
///
/// Returns a sanitized PathBuf on success, or a security error string on violation.
fn secure_verify_path(input_path: &str) -> Result<std::path::PathBuf, String> {
    if input_path.is_empty() {
        return Err("Security Violation: Empty path is not permitted.".to_string());
    }

    // Null bytes can truncate C-style path handling on some platforms / FFI boundaries.
    if input_path.contains('\0') {
        return Err("Security Violation: Null byte in path is not permitted.".to_string());
    }

    let path = Path::new(input_path);

    // Catch explicit directory traversal attacks targeting systemic directory boundaries
    for component in path.components() {
        if component == Component::ParentDir {
            return Err("Security Violation: Directory traversal sequence detected.".to_string());
        }
    }

    if !path.is_absolute() {
        return Err("Security Violation: Only absolute paths are permitted.".to_string());
    }

    Ok(path.to_path_buf())
}

/// Extract a single path segment suitable for use as a file name (no directories).
/// Rejects empty names, `.`, and `..`.
fn secure_file_name(input: &str) -> Result<std::ffi::OsString, String> {
    if input.is_empty() || input.contains('\0') {
        return Err("Security Violation: Invalid file name provided.".to_string());
    }
    let name = Path::new(input)
        .file_name()
        .ok_or_else(|| "Security Violation: Invalid file name provided.".to_string())?;
    if name.is_empty() || name == "." || name == ".." {
        return Err("Security Violation: Invalid file name provided.".to_string());
    }
    Ok(name.to_os_string())
}

// ⚡ NEW: Shared payload structure to wrap both the byte array and filename together
#[derive(serde::Serialize)]
pub struct FilePayload {
    bytes: Vec<u8>,
    name: String,
    path: String,
}

/// Extensions accepted for file-association / CLI startup launches.
fn is_supported_startup_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".pdf")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".tiff")
        || lower.ends_with(".tif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
}

/// Scan process arguments for a supported document and load it into a FilePayload.
/// Used for double-click / "Open with" launches and CLI path arguments.
fn load_startup_file_from_args() -> Option<FilePayload> {
    for arg in std::env::args().skip(1) {
        if !is_supported_startup_extension(&arg) {
            continue;
        }
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
    None
}

#[tauri::command]
async fn check_startup_file() -> Option<FilePayload> {
    // Kept for compatibility; primary launch path is setup + `startup-file-loaded` event.
    // Args come from the OS (file association / CLI), not the untrusted frontend.
    load_startup_file_from_args()
}

// 1. NATIVE WINDOWS FILE OPEN DIALOG
const fn generate_lut() -> [[u8; 32]; 256] {
    let mut lut = [[0u8; 32]; 256];
    let mut byte = 0;
    while byte < 256 {
        let mut i = 0;
        while i < 8 {
            let bit = (byte >> (7 - i)) & 1;
            let gray = if bit == 1 { 255 } else { 0 };
            lut[byte as usize][i * 4] = gray;
            lut[byte as usize][i * 4 + 1] = gray;
            lut[byte as usize][i * 4 + 2] = gray;
            lut[byte as usize][i * 4 + 3] = 255;
            i += 1;
        }
        byte += 1;
    }
    lut
}
const TIFF_1BIT_LUT: [[u8; 32]; 256] = generate_lut();

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
async fn native_save_as_file(
    file_bytes: Vec<u8>,
    default_path: Option<String>,
) -> Result<String, String> {
    // `default_path` is only a suggested dialog file name — never open/write it directly.
    // Strip any directory components so a hostile string cannot influence the dialog seed.
    let file_name = match default_path {
        Some(raw) => secure_file_name(&raw)
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "edited_document.pdf".to_string()),
        None => "edited_document.pdf".to_string(),
    };
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .set_file_name(&file_name)
        .save_file()
        .await;

    match file_path {
        Some(handle) => {
            // Path comes from the native save dialog (user-confirmed), not raw frontend input.
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
    let safe_path = secure_verify_path(&path)?;
    let mut file = File::create(&safe_path).map_err(|e| e.to_string())?;
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
    let safe_file_name = secure_file_name(&file_name)?;

    let mut temp_path = std::env::temp_dir();
    temp_path.push(safe_file_name);
    std::fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;
    Ok(temp_path.to_string_lossy().into_owned())
}

// 🛑 CRITICAL ARCHITECTURAL WARNING TO DEVELOPERS AND AGENTS:
// DO NOT re-implement native Win32/msedge process spooling inside this block.
// Spawning external Chromium processes alongside an active WebView2 instance triggers
// deep profile lock contentions (Exit Code 21), resulting in un-killable black GPU boxes.
// Printing must be routed via the frontend isolated iframe blob channel.
#[tauri::command]
async fn native_spool_pdf_bytes(bytes: Vec<u8>) -> Result<String, String> {
    let _ = bytes;
    Ok("Backend hook cleared. Handled via isolated frontend channel safely.".into())
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> std::collections::HashMap<String, bool> {
    paths
        .into_iter()
        .map(|path| {
            // Reject traversal / relative probes; treat invalid paths as non-existent.
            let exists = match secure_verify_path(&path) {
                Ok(safe) => safe.exists(),
                Err(_) => false,
            };
            (path, exists)
        })
        .collect()
}

#[tauri::command]
async fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    let safe_path = secure_verify_path(&path)?;
    let mut file =
        File::open(&safe_path).map_err(|_| "Unable to read file from disk.".to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|_| "Unable to read file from disk.".to_string())?;
    Ok(buffer)
}

#[tauri::command]
async fn read_file_bytes(path: String) -> Result<FilePayload, String> {
    let safe_path = secure_verify_path(&path)?;
    if !safe_path.exists() || !safe_path.is_file() {
        return Err("File does not exist or is not a file.".to_string());
    }
    let file_name = safe_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document.pdf".to_string());

    let mut file =
        File::open(&safe_path).map_err(|_| "Unable to read file from disk.".to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|_| "Unable to read file from disk.".to_string())?;

    Ok(FilePayload {
        bytes: buffer,
        name: file_name,
        path: safe_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn parse_tiff_document(path: String) -> Result<Vec<Vec<u8>>, String> {
    // Must use the verified PathBuf — previously validated then opened the raw string.
    let safe_path = secure_verify_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Read the file natively straight from disk to avoid frontend JSON serialization overhead
        let file = std::fs::File::open(&safe_path)
            .map_err(|_| "Unable to read file from disk.".to_string())?;
        let reader = std::io::BufReader::new(file);
        let mut decoder = Decoder::new(reader)
            .map_err(|e| format!("TIFF Decoder initialization error: {}", e))?;
        let mut pages = Vec::new();

        loop {
            let (width, height) = decoder.dimensions().map_err(|e| e.to_string())?;
            let colortype = decoder
                .colortype()
                .map_err(|e| format!("Failed to read color type: {}", e))?;
            let img_data = decoder.read_image().map_err(|e| e.to_string())?;

            let mut rgba_buffer = Vec::with_capacity((width * height * 4) as usize);

            match img_data {
                DecodingResult::U8(data) => {
                    match colortype {
                        tiff::ColorType::RGB(_) => {
                            rgba_buffer.extend(
                                data.chunks_exact(3)
                                    .flat_map(|chunk| [chunk[0], chunk[1], chunk[2], 255]),
                            );
                        }
                        tiff::ColorType::RGBA(_) => {
                            rgba_buffer.extend(data);
                        }
                        tiff::ColorType::Gray(bits) => {
                            if bits == 1 {
                                if data.len() == (width * height) as usize {
                                    // If it's already unpacked/expanded to 1 byte per pixel by the decoder layer
                                    rgba_buffer.extend(
                                        data.into_iter().flat_map(|gray| [gray, gray, gray, 255]),
                                    );
                                } else {
                                    // Unpack packed bits (1 bit per pixel, with each row padded to a byte boundary per TIFF spec)
                                    let bytes_per_row = width.div_ceil(8) as usize;
                                    for r in 0..height as usize {
                                        let row_offset = r * bytes_per_row;
                                        let mut cols_remaining = width as usize;

                                        if row_offset >= data.len() {
                                            break;
                                        }

                                        let row_end =
                                            std::cmp::min(row_offset + bytes_per_row, data.len());
                                        let row_data = &data[row_offset..row_end];

                                        for &byte in row_data {
                                            let pixels_to_process =
                                                std::cmp::min(8, cols_remaining);

                                            if pixels_to_process == 8 {
                                                rgba_buffer.extend_from_slice(
                                                    &TIFF_1BIT_LUT[byte as usize],
                                                );
                                            } else {
                                                rgba_buffer.extend_from_slice(
                                                    &TIFF_1BIT_LUT[byte as usize]
                                                        [..pixels_to_process * 4],
                                                );
                                            }

                                            cols_remaining -= pixels_to_process;
                                            if cols_remaining == 0 {
                                                break;
                                            }
                                        }
                                    }
                                }
                            } else {
                                // Standard 8-bit grayscale channels (1 byte per pixel)
                                rgba_buffer.extend(
                                    data.into_iter().flat_map(|gray| [gray, gray, gray, 255]),
                                );
                            }
                        }
                        _ => {
                            return Err(format!(
                                "Unsupported TIFF color profile depth: {:?}",
                                colortype
                            ))
                        }
                    }
                }
                DecodingResult::U16(data) => match colortype {
                    tiff::ColorType::RGB(_) => {
                        rgba_buffer.extend(data.chunks_exact(3).flat_map(|chunk| {
                            [
                                (chunk[0] >> 8) as u8,
                                (chunk[1] >> 8) as u8,
                                (chunk[2] >> 8) as u8,
                                255,
                            ]
                        }));
                    }
                    tiff::ColorType::RGBA(_) => {
                        rgba_buffer.extend(data.chunks_exact(4).flat_map(|chunk| {
                            [
                                (chunk[0] >> 8) as u8,
                                (chunk[1] >> 8) as u8,
                                (chunk[2] >> 8) as u8,
                                (chunk[3] >> 8) as u8,
                            ]
                        }));
                    }
                    tiff::ColorType::Gray(_) => {
                        rgba_buffer.extend(data.into_iter().flat_map(|gray| {
                            let val = (gray >> 8) as u8;
                            [val, val, val, 255]
                        }));
                    }
                    _ => {
                        return Err(format!(
                            "Unsupported 16-bit TIFF color layout: {:?}",
                            colortype
                        ))
                    }
                },
                _ => {
                    return Err(
                        "Unsupported binary block bitstream format layout encountered".to_string(),
                    )
                }
            }

            // Safety verification: Ensure the byte buffer length perfectly matches the expected canvas dimensions
            if rgba_buffer.len() != (width * height * 4) as usize {
                return Err(format!(
                    "Extracted pixel buffer dimension constraint violation: expected {}, got {}",
                    width * height * 4,
                    rgba_buffer.len()
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
            )
            .map_err(|e| format!("PNG generation fallback encoder error: {}", e))?;

            pages.push(png_bytes);

            if !decoder.more_images() {
                break;
            }
            decoder.next_image().map_err(|e| e.to_string())?;
        }

        Ok(pages)
    })
    .await
    .map_err(|e| format!("Failed to execute blocking task: {}", e))?
}

#[tauri::command]
fn compress_pdf_pipeline(file_path: String) -> Result<String, String> {
    let safe_path = secure_verify_path(&file_path)?;

    // 1. Ingest the raw file binary object tree from local storage disk
    let mut doc = lopdf::Document::load(&safe_path)
        .map_err(|e| format!("Failed to read target PDF structure: {}", e))?;

    // 2. Structural Clean: Strip unreferenced nodes and clear dead cross-reference arrays
    doc.prune_objects();

    // Re-encode object data streams into minimized binary payloads
    doc.compress();

    // 3. Derive a clean optimized naming file output profile next to the source
    let export_path = {
        let stem = safe_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "document".to_string());
        let parent = safe_path.parent().unwrap_or_else(|| Path::new("."));
        parent.join(format!("{stem}_compressed.pdf"))
    };

    // Export path is derived from a verified absolute path (no new user-controlled segments).
    // 4. Commit the condensed file byte map payload directly back to system disk space
    doc.save(&export_path)
        .map_err(|e| format!("Failed to write optimized system file: {}", e))?;

    Ok(format!(
        "File compressed cleanly! Generated target clone asset at: {}",
        export_path.to_string_lossy()
    ))
}

#[tauri::command]
fn delete_file_from_disk(file_path: String) -> Result<String, String> {
    let safe_path = secure_verify_path(&file_path)?;
    if !safe_path.is_file() {
        return Err("Security Violation: Delete target must be an existing file.".to_string());
    }
    std::fs::remove_file(&safe_path)
        .map_err(|e| format!("Operating system failed to erase local target asset: {}", e))?;

    Ok("Asset successfully scrubbed off local drive bounds.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(512)
        .build()
        .unwrap();
    let _guard = runtime.enter();

    // Single-instance MUST be the first plugin so a second process hands off
    // argv (file associations / email "Open with") instead of spawning another UI.
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};

            // Focus the already-running window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Open any document path from the second-instance argv as a new tab
            for arg in argv.iter().skip(1) {
                if !is_supported_startup_extension(arg) {
                    continue;
                }
                let path = Path::new(arg);
                if !(path.exists() && path.is_file()) {
                    continue;
                }
                let Some(file_name) = path.file_name() else {
                    continue;
                };
                let name = file_name.to_string_lossy().into_owned();
                let path_str = path.to_string_lossy().into_owned();
                if let Ok(mut file) = File::open(path) {
                    let mut buffer = Vec::new();
                    if file.read_to_end(&mut buffer).is_ok() {
                        let payload = FilePayload {
                            bytes: buffer,
                            name,
                            path: path_str,
                        };
                        if let Err(e) = app.emit("open-file-request", &payload) {
                            eprintln!("Failed to emit open-file-request: {e}");
                        }
                        break;
                    }
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(commands::OcrModelState {
            det_model_bytes: tokio::sync::OnceCell::new(),
            rec_model_bytes: tokio::sync::OnceCell::new(),
        })
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // File-association / "Open with" / CLI path: load in Rust and push to the
            // frontend via an event. Avoids depending on frontend invoke() which can be
            // blocked by CSP on cold start (connect-src / ipc.localhost).
            if let Some(payload) = load_startup_file_from_args() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri::Emitter;
                    // Events emitted before the webview registers a listener are dropped.
                    // Retry a few times so onMount has time to attach `startup-file-loaded`.
                    // Frontend dedupes so multiple deliveries only load once.
                    for delay_ms in [200u64, 600, 1200] {
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        if let Err(e) = handle.emit("startup-file-loaded", &payload) {
                            eprintln!("Failed to emit startup-file-loaded: {e}");
                        }
                    }
                });
            }

            // Spawn a separate thread immediately to keep the UI initialization instantaneous
            tokio::task::spawn_blocking(move || {
                let temp_dir = std::env::temp_dir();
                println!("Background Sweep: Scanning temp directory: {:?}", temp_dir);

                if let Ok(entries) = std::fs::read_dir(temp_dir) {
                    for entry in entries.flatten() {
                        if let Ok(file_name) = entry.file_name().into_string() {
                            // Match our specific print signature files
                            if file_name.starts_with("speedDF_print_")
                                && file_name.ends_with(".pdf")
                            {
                                let path = entry.path();
                                if let Err(e) = std::fs::remove_file(&path) {
                                    eprintln!(
                                        "Background Sweep Error: Failed to purge {:?}: {}",
                                        path, e
                                    );
                                } else {
                                    println!(
                                        "Background Sweep: Cleaned up cached print file: {:?}",
                                        path
                                    );
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
            native_spool_pdf_bytes,
            check_files_exist,
            read_file_bytes,
            read_file_binary,
            parse_tiff_document,
            run_local_ocr,
            compress_pdf_pipeline,
            delete_file_from_disk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_lut() {
        let lut = generate_lut();

        // Test byte 0: all bits are 0, so all pixels should be black (0, 0, 0, 255)
        let byte0 = lut[0];
        for i in 0..8 {
            assert_eq!(&byte0[i * 4..i * 4 + 4], &[0, 0, 0, 255]);
        }

        // Test byte 255: all bits are 1, so all pixels should be white (255, 255, 255, 255)
        let byte255 = lut[255];
        for i in 0..8 {
            assert_eq!(&byte255[i * 4..i * 4 + 4], &[255, 255, 255, 255]);
        }

        // Test byte 128 (10000000 in binary): first pixel white, rest black
        let byte128 = lut[128];
        assert_eq!(&byte128[0..4], &[255, 255, 255, 255]);
        for i in 1..8 {
            assert_eq!(&byte128[i * 4..i * 4 + 4], &[0, 0, 0, 255]);
        }

        // Test byte 1 (00000001 in binary): last pixel white, rest black
        let byte1 = lut[1];
        for i in 0..7 {
            assert_eq!(&byte1[i * 4..i * 4 + 4], &[0, 0, 0, 255]);
        }
        assert_eq!(&byte1[28..32], &[255, 255, 255, 255]);
    }

    #[test]
    fn test_check_files_exist() {
        use std::fs::File;
        let mut temp_dir = std::env::temp_dir();
        temp_dir.push("test_check_files_exist_dir");
        let _ = std::fs::create_dir_all(&temp_dir);

        let mut temp_file = temp_dir.clone();
        temp_file.push("test_file.txt");
        File::create(&temp_file).expect("Failed to create temp file");

        let mut non_existent_file = temp_dir.clone();
        non_existent_file.push("does_not_exist.txt");

        let paths = vec![
            temp_file.to_string_lossy().into_owned(),
            non_existent_file.to_string_lossy().into_owned(),
            "../../Windows/System32/drivers/etc/hosts".to_string(),
            "relative/file.pdf".to_string(),
        ];

        let result = check_files_exist(paths);

        assert_eq!(result.len(), 4);
        assert_eq!(
            result.get(&temp_file.to_string_lossy().into_owned()),
            Some(&true)
        );
        assert_eq!(
            result.get(&non_existent_file.to_string_lossy().into_owned()),
            Some(&false)
        );
        // Traversal / relative probes must not report existence
        assert_eq!(
            result.get("../../Windows/System32/drivers/etc/hosts"),
            Some(&false)
        );
        assert_eq!(result.get("relative/file.pdf"), Some(&false));

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_secure_verify_path_rejects_traversal() {
        assert!(secure_verify_path("../../Windows/System32/config").is_err());
        assert!(secure_verify_path(r"C:\Users\..\..\Windows\System32").is_err());
        assert!(secure_verify_path(r"C:\Users\foo\..\bar\file.pdf").is_err());
        assert!(secure_verify_path("relative/path/file.pdf").is_err());
        assert!(secure_verify_path("").is_err());
        assert!(secure_verify_path("C:\\ok\0evil.pdf").is_err());
    }

    #[test]
    fn test_secure_verify_path_accepts_absolute_files() {
        let abs = std::env::temp_dir().join("speeddf_secure_path_ok.pdf");
        let abs_str = abs.to_string_lossy().into_owned();
        let verified = secure_verify_path(&abs_str).expect("absolute path without .. should pass");
        assert_eq!(verified, abs);
    }

    #[test]
    fn test_secure_file_name_strips_directories() {
        let name = secure_file_name(r"C:\Users\foo\..\evil\document.pdf").unwrap();
        assert_eq!(name.to_string_lossy(), "document.pdf");

        let name2 = secure_file_name("../../etc/passwd").unwrap();
        assert_eq!(name2.to_string_lossy(), "passwd");

        assert!(secure_file_name("").is_err());
        assert!(secure_file_name("..").is_err());
        assert!(secure_file_name(".").is_err());
    }
}
