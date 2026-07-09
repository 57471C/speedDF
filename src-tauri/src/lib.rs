use std::fs::File;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::Manager;
use tiff::decoder::{Decoder, DecodingResult};
mod commands;
use commands::run_local_ocr;

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
                    let path_str = path.to_string_lossy().into_owned().replace("\\", "/");
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

// ⚡ Win32 Helper to retrieve the class name of a window handle
unsafe fn get_window_class_name(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut class_buffer = [0u16; 256];
    let len = GetClassNameW(hwnd, class_buffer.as_mut_ptr(), class_buffer.len() as i32);
    if len == 0 {
        return String::new();
    }
    String::from_utf16_lossy(&class_buffer[..len as usize])
}

// ⚡ Win32 Helper to recursively locate a child window by a matching condition
#[allow(dead_code)]
unsafe fn find_child_by_condition<F>(
    parent: windows_sys::Win32::Foundation::HWND,
    pred: &F,
) -> windows_sys::Win32::Foundation::HWND
where
    F: Fn(&str) -> bool,
{
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowExW;

    // Debug output: print the class name of every handle scanned to audit the layout tree
    let current_class = get_window_class_name(parent);
    println!(
        "[speedDF Core Debug] Scanning window handle {:?} of class '{}'",
        parent, current_class
    );

    if pred(&current_class) {
        println!("[speedDF Core Debug] Golden target handle found: {:?}", parent);
        return parent;
    }

    let mut current_child = FindWindowExW(parent, 0, std::ptr::null(), std::ptr::null());
    while current_child != 0 {
        let found = find_child_by_condition(current_child, pred);
        if found != 0 {
            return found;
        }
        current_child = FindWindowExW(parent, current_child, std::ptr::null(), std::ptr::null());
    }
    0
}

// ⚡ Win32 Helper to locate the preview pane for File Explorer or Outlook
#[allow(dead_code)]
unsafe fn find_preview_pane(
    parent: windows_sys::Win32::Foundation::HWND,
    parent_class: &str,
) -> windows_sys::Win32::Foundation::HWND {
    if parent_class.contains("CabinetWClass") {
        // Flexible containment lookup: matches "Shell Preview Extension Host" or similar
        let shell_host = find_child_by_condition(parent, &|class| {
            let class_lower = class.to_lowercase();
            class_lower.contains("shell preview") && class_lower.contains("host")
        });
        if shell_host != 0 {
            return shell_host;
        }
    } else if parent_class.contains("rctrl_renwnd32") {
        let olk_reader = find_child_by_condition(parent, &|class| {
            let class_lower = class.to_lowercase();
            class_lower.contains("olkreader") || class_lower.contains("afxwndw")
        });
        if olk_reader != 0 {
            return olk_reader;
        }
    }
    parent
}

// ⚡ NEW: Managed state struct to hold target file path for preview mode
pub struct PreviewFilePath(pub Mutex<Option<String>>);

#[tauri::command]
fn get_startup_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|x| x == "--preview") {
        if pos + 1 < args.len() {
            return Some(args[pos + 1].clone());
        }
    }
    None
}

#[tauri::command]
fn get_preview_file_path(state: tauri::State<'_, PreviewFilePath>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn get_preview_file_payload(
    state: tauri::State<'_, PreviewFilePath>,
) -> Result<FilePayload, String> {
    let path_opt = state.0.lock().unwrap().clone();
    if let Some(path) = path_opt {
        read_file_bytes(path).await
    } else {
        Err("No preview file path bound".to_string())
    }
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
            let path_str = path.to_string_lossy().into_owned().replace("\\", "/");
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
    let file_name = default_path.unwrap_or_else(|| "edited_document.pdf".to_string());
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("PDF Document", &["pdf"])
        .set_file_name(&file_name)
        .save_file()
        .await;

    match file_path {
        Some(handle) => {
            let path = handle.path();
            let path_str = path.to_string_lossy().into_owned().replace("\\", "/");
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
    let safe_file_name = std::path::Path::new(&file_name)
        .file_name()
        .ok_or_else(|| "Invalid file name provided".to_string())?;

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
    let file_name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document.pdf".to_string());

    let mut file = File::open(path_buf).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

    Ok(FilePayload {
        bytes: buffer,
        name: file_name,
        path: path.replace("\\", "/"),
    })
}

#[tauri::command]
async fn parse_tiff_document(path: String) -> Result<Vec<Vec<u8>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Read the file natively straight from disk to avoid frontend JSON serialization overhead
        let file = std::fs::File::open(&path)
            .map_err(|e| format!("Failed to read file from disk: {}", e))?;
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
                                for gray in data {
                                    rgba_buffer.extend_from_slice(&[gray, gray, gray, 255]);
                                }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let args = std::env::args().collect::<Vec<String>>();
            println!("[speedDF Core Debug] Received raw CLI args: {:?}", args);

            // Enumerate every window registered in the tauri.conf.json schema
            for (label, window) in app.webview_windows() {
                match window.url() {
                    Ok(url) => println!("[speedDF Core Debug] Found Window '{}' mapped to URL: {}", label, url),
                    Err(e) => println!("[speedDF Core Debug] Found Window '{}' but failed to read URL: {:?}", label, e),
                }
            }

            let mut preview_file_path: Option<String> = None;

            let is_preview = args.contains(&"--preview".to_string());

            // Handle Main Window
            if let Some(main_window) = app.get_webview_window("main") {
                if !is_preview {
                    // ONLY show the main window if it is a normal launch
                    let _ = main_window.show(); 
                }
            }

            // Handle Preview Window
            if let Some(preview_window) = app.get_webview_window("preview-window") {
                if !is_preview {
                    // Kill the preview window entirely for normal launches
                    let _ = preview_window.close(); 
                }
                // If is_preview IS true, we do nothing here. It stays hidden (visible: false) 
                // until the background layout thread calculates coordinates and calls preview_window.show()
            }

            if is_preview {
                if let Some(preview_window) = app.get_webview_window("preview-window") {
                    // 1. PATH NORMALIZATION: Strip backslashes to avoid '\t' (Tab) character escape string corruption
                    let raw_path = args.iter().position(|r| r == "--preview")
                        .and_then(|pos| args.get(pos + 1))
                        .cloned()
                        .unwrap_or_else(|| args.get(2).cloned().unwrap_or_default());
                    let safe_path = raw_path.replace("\\", "/");
                    preview_file_path = Some(safe_path.clone());

                    let preview_win_clone = preview_window.clone();
                    let tauri_preview_hwnd = preview_win_clone.hwnd().unwrap().0 as windows_sys::Win32::Foundation::HWND;

                    std::thread::spawn(move || unsafe {
                        use windows_sys::Win32::UI::WindowsAndMessaging::{
                            EnumWindows, GetClassNameW, GetWindowRect, 
                            SetWindowLongPtrW, // <--- 64-bit safe owner link
                            IsWindow, IsIconic, IsWindowVisible, GWL_HWNDPARENT
                        };
                        use windows_sys::Win32::Foundation::{HWND, RECT, LPARAM, BOOL};

                        // Callback to lock onto the top-level File Explorer frame ONLY
                        unsafe extern "system" fn find_explorer_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
                            let mut class_name = [0u16; 256];
                            let len = GetClassNameW(hwnd, class_name.as_mut_ptr(), class_name.len() as i32);
                            if len > 0 && IsWindowVisible(hwnd) != 0 {
                                let name_str = String::from_utf16_lossy(&class_name[..len as usize]);
                                if name_str.contains("CabinetWClass") {
                                    *(lparam as *mut HWND) = hwnd;
                                    return 0; // Master frame captured
                                }
                            }
                            1
                        }

                        let mut target_explorer_hwnd: HWND = 0;
                        let mut owner_linked = false;

                        // SAFE A4 RATIO WIDTH (1080p compatible)
                        let fixed_width: u32 = 600; 

                        // CHANGES-ONLY SEALS to prevent canvas race conditions
                        let mut last_x = 0;
                        let mut last_y = 0;
                        let mut last_w = 0;
                        let mut last_h = 0;

                        loop {
                            if target_explorer_hwnd == 0 || IsWindow(target_explorer_hwnd) == 0 {
                                target_explorer_hwnd = 0;
                                owner_linked = false;
                                EnumWindows(Some(find_explorer_callback), &mut target_explorer_hwnd as *mut HWND as LPARAM);
                            }

                            if target_explorer_hwnd != 0 && IsWindow(target_explorer_hwnd) != 0 {
                                if IsIconic(target_explorer_hwnd) != 0 {
                                    let _ = preview_win_clone.hide();
                                } else {
                                    // NATIVE Z-ORDER BINDING: 64-bit safe linkage!
                                    // This guarantees the window stays firmly anchored ON TOP of File Explorer.
                                    if !owner_linked {
                                        SetWindowLongPtrW(tauri_preview_hwnd, GWL_HWNDPARENT, target_explorer_hwnd as isize);
                                        owner_linked = true;
                                    }

                                    let mut explorer_rect: RECT = std::mem::zeroed();
                                    if GetWindowRect(target_explorer_hwnd, &mut explorer_rect) != 0 {
                                        let explorer_width = explorer_rect.right - explorer_rect.left;
                                        let explorer_height = explorer_rect.bottom - explorer_rect.top;

                                        if explorer_width > 100 && explorer_height > 100 {
                                            // THE PERFECTED 1080p A4 ALIGNMENT
                                            let target_width = fixed_width;
                                            let target_height = 848; // Maintains 1:1.414 A4 aspect ratio safely on 1080p
                                            
                                            // Shift left by 50px total to comfortably clear Windows scrollbars and border shadows
                                            let target_x = explorer_rect.right - (target_width as i32) - 50; 
                                            let target_y = explorer_rect.top + 148; // Sit flush below the top toolbars

                                            // CHANGES-ONLY GATEWAY
                                            if target_x != last_x || target_y != last_y || target_width != last_w || target_height != last_h {
                                                let _ = preview_win_clone.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(target_width, target_height)));
                                                let _ = preview_win_clone.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(target_x, target_y)));
                                                let _ = preview_win_clone.show();

                                                last_x = target_x;
                                                last_y = target_y;
                                                last_w = target_width;
                                                last_h = target_height;
                                            }
                                        }
                                    }
                                }
                            } else {
                                let _ = preview_win_clone.hide();
                            }

                            std::thread::sleep(std::time::Duration::from_millis(16));
                        }
                    });
                }
            }

            app.manage(PreviewFilePath(Mutex::new(preview_file_path)));

            // Spawn a separate thread immediately to keep the UI initialization instantaneous
            std::thread::spawn(|| {
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
            get_preview_file_path,
            get_preview_file_payload,
            get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
