use std::time::Instant;
use std::sync::Arc;

fn sanitize_onnx_parameter_tokens(bytes: &mut [u8]) {
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

    let target_standard = b"DynamicDimension.";
    if bytes.len() >= target_standard.len() {
        for i in 0..=bytes.len() - target_standard.len() {
            if &bytes[i..i + target_standard.len()] == target_standard {
                bytes[i + 16] = b'_'; // Swaps '.' with '_' at index 16 safely
            }
        }
    }
}

fn main() {
    // create a 15MB file
    let size = 15 * 1024 * 1024;
    let mut data = vec![0u8; size];
    data[100] = b'p'; data[101] = b'2'; data[102] = b'o'; data[103] = b'.'; data[104] = b'1'; data[105] = b'.';
    std::fs::write("dummy_model.onnx", &data).unwrap();

    let start = Instant::now();
    for _ in 0..100 {
        let mut bytes = std::fs::read("dummy_model.onnx").unwrap();
        sanitize_onnx_parameter_tokens(&mut bytes);
    }
    let duration = start.elapsed();
    println!("Baseline (100 iterations of fs::read + sanitize): {:?}", duration);

    let start_cached = Instant::now();
    let mut bytes = std::fs::read("dummy_model.onnx").unwrap();
    sanitize_onnx_parameter_tokens(&mut bytes);
    let arc = Arc::new(bytes);
    for _ in 0..100 {
        let _cached_bytes = arc.clone();
    }
    let duration_cached = start_cached.elapsed();
    println!("Optimized (100 iterations of Arc::clone): {:?}", duration_cached);
}
