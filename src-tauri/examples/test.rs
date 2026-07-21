use std::time::Instant;

fn original_loop(w: u32, h: u32) -> Vec<f32> {
    let mut data = Vec::with_capacity(3 * h as usize * w as usize);
    let img: Vec<u8> = vec![0; (w * h * 3) as usize];
    for c in 0..3 {
        for y_img in 0..h {
            for x_img in 0..w {
                let idx = ((y_img * w + x_img) * 3 + c) as usize;
                let raw_value = img[idx] as f32 / 255.0;
                data.push((raw_value - 0.5) / 0.5);
            }
        }
    }
    data
}

fn optimized_loop(w: u32, h: u32) -> Vec<f32> {
    let mut data = Vec::with_capacity(3 * h as usize * w as usize);
    let img: Vec<u8> = vec![0; (w * h * 3) as usize];
    for c in 0..3 {
        data.extend(
            img.chunks_exact(3).map(|p| (p[c as usize] as f32 / 255.0 - 0.5) / 0.5)
        );
    }
    data
}

fn main() {
    let w = 200;
    let h = 48;

    // Warmup
    original_loop(w, h);
    optimized_loop(w, h);

    let iters = 10000;

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(original_loop(std::hint::black_box(w), std::hint::black_box(h)));
    }
    println!("original_loop: {:?}", start.elapsed());

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(optimized_loop(std::hint::black_box(w), std::hint::black_box(h)));
    }
    println!("optimized_loop: {:?}", start.elapsed());
}
