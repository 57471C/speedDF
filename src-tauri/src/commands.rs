use futures_util::StreamExt;
use std::fs::File;
use std::io::Write;
use tauri::ipc::Channel;
use tauri::{command, AppHandle, Manager};
use tract_onnx::prelude::*;
use rayon::prelude::*;

static ENGLISH_CHAR_DICT: &[&str] = &[
    "blank", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G",
    "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s",
    "t", "u", "v", "w", "x", "y", "z", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",",
    "-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}",
    "~",
];

/// Scans raw binary ONNX model streams to catch invalid dot tokens ('.')
/// introduced by both general ONNX exporters and the Paddle-to-ONNX (p2o) toolchain.
fn sanitize_onnx_parameter_tokens(bytes: &mut [u8]) {
    // Target 1: Catch all names starting with "p2o." and replace all dots inside them with underscores
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if &bytes[i..i + 4] == b"p2o." {
            bytes[i + 3] = b'_';
            let mut j = i + 4;
            while j < bytes.len() {
                let c = bytes[j];
                if c == b'.' {
                    bytes[j] = b'_';
                } else if c.is_ascii_alphanumeric() || c == b'_' || c == b'/' || c == b'-' {
                    // Valid character, continue scanning
                } else {
                    break;
                }
                j += 1;
            }
            i = j;
        } else {
            i += 1;
        }
    }

    // Target 2: Catch trailing sequential indicators ("DynamicDimension." -> "DynamicDimension_")
    let target_standard = b"DynamicDimension.";
    if bytes.len() >= target_standard.len() {
        for i in 0..=bytes.len() - target_standard.len() {
            if &bytes[i..i + target_standard.len()] == target_standard {
                bytes[i + 16] = b'_'; // Swaps '.' with '_' at index 16 safely
            }
        }
    }
}

async fn download_model_if_missing(
    file_path: &std::path::Path,
    url: &str,
    on_progress: &Channel<u32>,
    progress_offset: u32,
    progress_weight: f32,
) -> Result<(), String> {
    if file_path.exists() {
        return Ok(());
    }

    // Ensure the parent directory structure exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to connect to CDN: {}", e))?;

    let total_size = response
        .content_length()
        .ok_or_else(|| "Failed to read file size header from CDN response".to_string())?;

    let mut file = File::create(file_path)
        .map_err(|e| format!("Failed to create local model cache file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error during chunk download: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk to disk: {}", e))?;

        downloaded += chunk.len() as u64;

        // Calculate progress percentage relative to this download's share
        let download_percent = (downloaded as f32 / total_size as f32) * 100.0;
        let total_percent = progress_offset + (download_percent * progress_weight) as u32;

        let _ = on_progress.send(total_percent.min(100));
    }

    Ok(())
}

#[command]
pub async fn run_local_ocr(
    app_handle: AppHandle,
    image_bytes: Vec<u8>,
    on_progress: Channel<u32>,
) -> Result<String, String> {
    // 1. Resolve App Cache boundary targets and check for quantized models
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("FileSystem Failure: {}", e))?;

    // NOTE: Quantized models are not supported by tract-onnx (ConvHir type analysis fails).
    // Always use standard models for now.
    let det_model_path = {
        let path = cache_dir.join("ch_PP-OCRv4_det_infer.onnx");
        download_model_if_missing(
            &path,
            "https://speeddf.com/models/ch_PP-OCRv4_det_infer.onnx",
            &on_progress,
            0,
            0.5,
        )
        .await?;
        path
    };

    let rec_model_path = {
        let path = cache_dir.join("ppocr_v4_rec.onnx");
        download_model_if_missing(
            &path,
            "https://speeddf.com/models/ppocr_v4_rec.onnx",
            &on_progress,
            50,
            0.5,
        )
        .await?;
        path
    };

    // 3. Notify processing start
    let _ = on_progress.send(0);

    // 4. Thread Pool Offload for inference
    tokio::task::spawn_blocking(move || {
        // ========== BENCHMARK TIMING ==========
        let overall_start = std::time::Instant::now();
        let detection_start;
        let detection_time;
        let recognition_time;
        // =====================================
        // Load original raw image
        let original_img = image::load_from_memory(&image_bytes)
            .map_err(|e| format!("Buffer processing aborted. Image invalid: {}", e))?
            .to_rgb8();

        let (orig_w, orig_h) = original_img.dimensions();
        println!("[BENCH] Original image size: {}x{}", orig_w, orig_h);

        // ========== START DETECTION TIMING ==========
        detection_start = std::time::Instant::now();

        // 1. Calculate detector shape (nearest multiple of 32, max side 960)
        let max_side = 960.0;
        let scale = if orig_w.max(orig_h) as f32 > max_side {
            max_side / orig_w.max(orig_h) as f32
        } else {
            1.0
        };
        let det_h = ((((orig_h as f32 * scale) / 32.0).round() as u32) * 32).max(32);
        let det_w = ((((orig_w as f32 * scale) / 32.0).round() as u32) * 32).max(32);

        println!(
            "[BENCH] Detection input size: {}x{} (scaled from {}x{})",
            det_w, det_h, orig_w, orig_h
        );

        if cfg!(debug_assertions) {
            println!(
                "DEBUG INFO: Original dimensions: {}x{}, Detector dimensions: {}x{}",
                orig_w, orig_h, det_w, det_h
            );
        }

        // 2. High-performance downscale pass for detection
        let det_resized = image::imageops::resize(
            &original_img,
            det_w,
            det_h,
            image::imageops::FilterType::Triangle,
        );

        // 3. Normalize channels via standard ImageNet coefficients (parallelized with Rayon)
        let mut det_data = vec![0.0f32; 3 * det_h as usize * det_w as usize];
        det_data.par_chunks_mut(det_h as usize * det_w as usize)
            .enumerate()
            .for_each(|(c, channel_slice)| {
                let (mean, std) = match c {
                    0 => (0.485, 0.229),
                    1 => (0.456, 0.224),
                    2 => (0.406, 0.225),
                    _ => unreachable!(),
                };
                for y in 0..det_h {
                    for x in 0..det_w {
                        let pixel = det_resized.get_pixel(x, y);
                        let val = pixel[c] as f32 / 255.0;
                        channel_slice[(y * det_w + x) as usize] = (val - mean) / std;
                    }
                }
            });

        // Ingest the detection weights file into memory
        let mut det_model_bytes = std::fs::read(&det_model_path)
            .map_err(|e| format!("Failed to read detection model from disk cache: {}", e))?;

        // Clean all dynamic parameter notations (.0, .1, .2, .3) inside the buffer
        sanitize_onnx_parameter_tokens(&mut det_model_bytes);

        let mut det_neural_model = tract_onnx::onnx()
            .model_for_read(&mut &det_model_bytes[..])
            .map_err(|e| {
                format!(
                    "Failed to parse OCR detector model structure (Technical log: {:?})",
                    e
                )
            })?;

        det_neural_model
            .set_input_fact(
                0,
                tract_onnx::prelude::InferenceFact::dt_shape(
                    f32::datum_type(),
                    vec![1, 3, det_h as usize, det_w as usize],
                ),
            )
            .map_err(|e| format!("Failed to inject runtime shape facts for detector: {}", e))?;

        let det_runnable = det_neural_model
            .into_optimized()
            .map_err(|e| format!("Detection optimizer failed: {}", e))?
            .into_runnable()
            .map_err(|e| format!("Detection runnable configuration failed: {}", e))?;

        let det_tensor_input = tract_onnx::prelude::Tensor::from_shape(
            &[1, 3, det_h as usize, det_w as usize],
            &det_data,
        )
        .map_err(|e| format!("Detection tensor creation failed: {}", e))?;

        let det_outputs = det_runnable
            .run(tvec!(det_tensor_input.into()))
            .map_err(|e| format!("Detection execution failed: {}", e))?;

        let det_output_tensor = &det_outputs[0];
        let det_matrix_logits = det_output_tensor
            .as_slice::<f32>()
            .map_err(|e| format!("Detection tensor conversion failed: {}", e))?;

        // 5. Diagnostics: telemetry min/max values
        let mut min_val = f32::MAX;
        let mut max_val = f32::MIN;
        for &val in det_matrix_logits.iter() {
            if val < min_val {
                min_val = val;
            }
            if val > max_val {
                max_val = val;
            }
        }
        if cfg!(debug_assertions) {
            println!(
                "DEBUG INFO: Detection heatmap range -> Min: {}, Max: {}",
                min_val, max_val
            );
        }

        // 6. Binarization & BFS Connected Components Labeling
        let mut mask = vec![false; (det_h * det_w) as usize];
        for (i, &val) in det_matrix_logits.iter().enumerate() {
            if i < mask.len() {
                mask[i] = val >= 0.3;
            }
        }

        let mut visited = vec![false; (det_h * det_w) as usize];
        let mut detected_boxes = Vec::new();

        for y in 0..det_h {
            for x in 0..det_w {
                let idx = (y * det_w + x) as usize;
                if mask[idx] && !visited[idx] {
                    let mut min_cx = x;
                    let mut max_cx = x;
                    let mut min_cy = y;
                    let mut max_cy = y;

                    let mut queue = std::collections::VecDeque::new();
                    queue.push_back((y, x));
                    visited[idx] = true;

                    while let Some((cy, cx)) = queue.pop_front() {
                        min_cx = min_cx.min(cx);
                        max_cx = max_cx.max(cx);
                        min_cy = min_cy.min(cy);
                        max_cy = max_cy.max(cy);

                        for dy in -1..=1 {
                            for dx in -1..=1 {
                                if dy == 0 && dx == 0 {
                                    continue;
                                }
                                let ny = cy as i32 + dy;
                                let nx = cx as i32 + dx;
                                if ny >= 0 && ny < det_h as i32 && nx >= 0 && nx < det_w as i32 {
                                    let n_idx = (ny as u32 * det_w + nx as u32) as usize;
                                    if mask[n_idx] && !visited[n_idx] {
                                        visited[n_idx] = true;
                                        queue.push_back((ny as u32, nx as u32));
                                    }
                                }
                            }
                        }
                    }

                    let w_box = max_cx - min_cx + 1;
                    let h_box = max_cy - min_cy + 1;
                    let area = w_box * h_box;
                    let aspect_ratio = w_box as f32 / h_box as f32;

                    // Balanced noise filtering based on detector scale coordinates (672x960)
                    let is_too_small = w_box < 8 || h_box < 6 || area < 60;

                    // Filter out extremely large background components (e.g., page frames or large empty blocks)
                    let is_too_large = w_box > (det_w * 95 / 100) && h_box > (det_h * 40 / 100);

                    // Remove thin line segments (table borders and delimiters)
                    let is_thin_vertical_line = w_box <= 4 && h_box > 20;
                    let is_thin_horizontal_line = h_box <= 4 && w_box > 50;

                    // Filter out extreme aspect ratio skew
                    let is_skewed = aspect_ratio < 0.12 || (aspect_ratio > 25.0 && h_box < 7);

                    if !is_too_small && !is_too_large && !is_thin_vertical_line && !is_thin_horizontal_line && !is_skewed {
                        detected_boxes.push((min_cx, min_cy, w_box, h_box));
                    }
                }
            }
        }

        if cfg!(debug_assertions) {
            println!(
                "DEBUG INFO: Total text bounding boxes isolated: {}",
                detected_boxes.len()
            );
        }

        // 7. Bounding Box Scaling & Inflation (Un-clip)
        let scale_x = orig_w as f32 / det_w as f32;
        let scale_y = orig_h as f32 / det_h as f32;

        let mut scaled_boxes = Vec::new();
        for &(bx, by, bw, bh) in &detected_boxes {
            let rx = bx as f32 * scale_x;
            let ry = by as f32 * scale_y;
            let rw = bw as f32 * scale_x;
            let rh = bh as f32 * scale_y;

            let pad_x = (rw * 0.15).max(4.0);
            let pad_y = (rh * 0.15).max(4.0);

            let x_start = (rx - pad_x).max(0.0) as u32;
            let y_start = (ry - pad_y).max(0.0) as u32;
            let x_end = ((rx + rw + pad_x).min(orig_w as f32)) as u32;
            let y_end = ((ry + rh + pad_y).min(orig_h as f32)) as u32;

            let final_w = x_end.saturating_sub(x_start);
            let final_h = y_end.saturating_sub(y_start);

            if final_w > 0 && final_h > 0 {
                scaled_boxes.push((x_start, y_start, final_w, final_h));
            }
        }

        // 8. Row-Baseline Tolerance Sorting (Delta = 12 pixels)
        scaled_boxes.sort_by_key(|&(_, y, _, _)| y);
        let mut rows: Vec<Vec<(u32, u32, u32, u32)>> = Vec::new();
        for box_item in scaled_boxes {
            let (_, y, _, _) = box_item;
            let mut added = false;
            for row in &mut rows {
                if let Some(&(_, first_y, _, _)) = row.first() {
                    if (y as i32 - first_y as i32).abs() <= 12 {
                        row.push(box_item);
                        added = true;
                        break;
                    }
                }
            }
            if !added {
                rows.push(vec![box_item]);
            }
        }
        rows.sort_by_key(|row| row.first().map(|&(_, y, _, _)| y).unwrap_or(0));
        for row in &mut rows {
            row.sort_by_key(|&(x, _, _, _)| x);
        }

        let sorted_boxes: Vec<(u32, u32, u32, u32)> = rows.into_iter().flatten().collect();
        detection_time = detection_start.elapsed();

        println!("[BENCH] Detection time: {:.2?}", detection_time);
        println!("[BENCH] Detected text boxes: {}", sorted_boxes.len());

        let recognition_start = std::time::Instant::now();

        if cfg!(debug_assertions) {
            for (i, &(x, y, w, h)) in sorted_boxes.iter().enumerate().take(3) {
                println!(
                    "DEBUG CROP: Box target [{}] -> x: {}, y: {}, w: {}, h: {}",
                    i, x, y, w, h
                );
            }
        }

        // 9. Prepare and compile the dynamic recognition model once
        let mut rec_model_bytes = std::fs::read(&rec_model_path).map_err(|e| {
            format!(
                "Failed to read recognition ONNX model from disk cache: {}",
                e
            )
        })?;
        sanitize_onnx_parameter_tokens(&mut rec_model_bytes);

        let mut neural_model = tract_onnx::onnx()
            .model_for_read(&mut &rec_model_bytes[..])
            .map_err(|e| format!("ONNX model streaming initialization failed: {}", e))?;

        let w_symbol = neural_model.symbols.sym("W");
        neural_model
            .set_input_fact(
                0,
                tract_onnx::prelude::InferenceFact::dt_shape(
                    f32::datum_type(),
                    vec![
                        TDim::from(1),
                        TDim::from(3),
                        TDim::from(48),
                        TDim::from(w_symbol),
                    ],
                ),
            )
            .map_err(|e| format!("Failed to inject runtime shape facts: {}", e))?;

        let rec_runnable = neural_model
            .into_optimized()
            .map_err(|e| format!("Graph compilation optimizer failed: {}", e))?
            .into_runnable()
            .map_err(|e| format!("Runnable configuration failed: {}", e))?;

        let total_boxes = sorted_boxes.len();
        let completed_count = std::sync::atomic::AtomicUsize::new(0);
        let last_sent_percentage = std::sync::atomic::AtomicUsize::new(0);
        
        let recognized_results: Result<Vec<String>, String> = sorted_boxes
            .par_iter()
            .map(|&(x, y, w, h)| {
                let text_strip = image::imageops::crop_imm(&original_img, x, y, w, h).to_image();
                let target_h = 48u32;
                let target_w = (((w as f32) * (target_h as f32 / h as f32)).round() as u32).max(1);

                let standardized_img = image::imageops::resize(
                    &text_strip,
                    target_w,
                    target_h,
                    image::imageops::FilterType::Triangle,
                );

                let mut data = Vec::with_capacity(3 * target_h as usize * target_w as usize);
                for c in 0..3 {
                    for y_img in 0..target_h {
                        for x_img in 0..target_w {
                            let pixel = standardized_img.get_pixel(x_img, y_img);
                            let raw_value = pixel[c] as f32 / 255.0;
                            data.push((raw_value - 0.5) / 0.5);
                        }
                    }
                }
                let tensor_input = tract_onnx::prelude::Tensor::from_shape(
                    &[1, 3, target_h as usize, target_w as usize],
                    &data,
                )
                .map_err(|e| format!("Tensor creation failed: {}", e))?;

                let inference_outputs = rec_runnable
                    .run(tvec!(tensor_input.into()))
                    .map_err(|e| format!("Model execution failed: {}", e))?;

                let output_tensor = &inference_outputs[0];
                let dimensions = output_tensor.shape();
                let mut recognized_string = String::new();

                if dimensions.len() >= 3 {
                    let sequence_len = dimensions[1];
                    let num_classes = dimensions[2];
                    if let Ok(matrix_logits) = output_tensor.as_slice::<f32>() {
                        let mut last_character_index = 0;

                        for t in 0..sequence_len {
                            let frame_offset = t * num_classes;
                            let class_probabilities_slice =
                                &matrix_logits[frame_offset..frame_offset + num_classes];

                            let mut highest_score = f32::MIN;
                            let mut argmax_index = 0;

                            for (class_idx, &score) in class_probabilities_slice.iter().enumerate() {
                                if score > highest_score {
                                    highest_score = score;
                                    argmax_index = class_idx;
                                }
                            }

                            if argmax_index != 0 {
                                if argmax_index != last_character_index {
                                    if argmax_index < ENGLISH_CHAR_DICT.len() {
                                        recognized_string.push_str(ENGLISH_CHAR_DICT[argmax_index]);
                                    } else {
                                        recognized_string.push_str(" ");
                                    }
                                }
                            }
                            last_character_index = argmax_index;
                        }
                    }
                }

                let current_completed = completed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let percentage = if total_boxes > 0 {
                    ((current_completed as f32 / total_boxes as f32) * 100.0) as usize
                } else {
                    100
                };

                let last_sent = last_sent_percentage.load(std::sync::atomic::Ordering::Relaxed);
                if current_completed % 10 == 0 || percentage >= last_sent + 5 || percentage == 100 {
                    last_sent_percentage.store(percentage, std::sync::atomic::Ordering::Relaxed);
                    let _ = on_progress.send(percentage as u32);
                }

                Ok(recognized_string.trim().to_string())
            })
            .collect();

        let mut recognized_lines = Vec::new();
        for line in recognized_results? {
            if !line.is_empty() {
                recognized_lines.push(line);
            }
        }

        recognition_time = recognition_start.elapsed();

        let total_time = overall_start.elapsed();

        println!("\n========== OCR BENCHMARK ==========");
        println!("[BENCH] Total OCR time:       {:.2?}", total_time);
        println!("[BENCH] Detection time:       {:.2?}", detection_time);
        println!("[BENCH] Recognition time:     {:.2?}", recognition_time);
        println!("[BENCH] Number of text boxes: {}", sorted_boxes.len());

        if !sorted_boxes.is_empty() {
            let avg_recog = recognition_time.as_secs_f32() / sorted_boxes.len() as f32;
            println!(
                "[BENCH] Avg time per box:     {:.3?}s",
                std::time::Duration::from_secs_f32(avg_recog)
            );
        }
        println!("===================================\n");

        let finalized_doc_text = recognized_lines.join("\n");
        if finalized_doc_text.is_empty() {
            Ok("No legible text matrix structures detected in asset boundary.".to_string())
        } else {
            Ok(finalized_doc_text)
        }
    })
    .await
    .map_err(|e| format!("Inference thread panic: {}", e))?
}
