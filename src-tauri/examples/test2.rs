use std::time::Instant;

fn main() {
    let w: u32 = 200;
    let h: u32 = 48;
    let mut img = vec![0u8; (w * h * 3) as usize];
    for i in 0..img.len() {
        img[i] = (i % 256) as u8;
    }

    let original = || {
        let mut data = Vec::with_capacity(3 * h as usize * w as usize);
        for c in 0..3 {
            for y_img in 0..h {
                for x_img in 0..w {
                    // simulate get_pixel behavior on flat buffer for Rgb8
                    let pixel_idx = ((y_img * w + x_img) * 3) as usize;
                    let pixel = &img[pixel_idx..pixel_idx+3];
                    let raw_value = pixel[c] as f32 / 255.0;
                    data.push((raw_value - 0.5) / 0.5);
                }
            }
        }
        data
    };

    let optimized = || {
        let mut data = Vec::with_capacity(3 * h as usize * w as usize);
        for c in 0..3 {
            data.extend(
                img.chunks_exact(3).map(|p| (p[c] as f32 / 255.0 - 0.5) / 0.5)
            );
        }
        data
    };

    let flat_map = || {
        let mut data = Vec::with_capacity(3 * h as usize * w as usize);
        data.extend(
            (0..3).flat_map(|c| img.chunks_exact(3).map(move |p| (p[c] as f32 / 255.0 - 0.5) / 0.5))
        );
        data
    };

    // Warmup
    original();
    optimized();
    flat_map();

    let iters = 10000;

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(original());
    }
    println!("original: {:?}", start.elapsed());

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(optimized());
    }
    println!("optimized: {:?}", start.elapsed());

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(flat_map());
    }
    println!("flat_map: {:?}", start.elapsed());
}
