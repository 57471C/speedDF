use image::{ImageBuffer, Rgb};
use std::time::Instant;

fn original_loop(img: &ImageBuffer<Rgb<u8>, Vec<u8>>, target_w: u32, target_h: u32) -> Vec<f32> {
    let mut data = Vec::with_capacity(3 * target_h as usize * target_w as usize);
    for c in 0..3 {
        for y_img in 0..target_h {
            for x_img in 0..target_w {
                let pixel = img.get_pixel(x_img, y_img);
                let raw_value = pixel[c] as f32 / 255.0;
                data.push((raw_value - 0.5) / 0.5);
            }
        }
    }
    data
}

fn optimized_loop(img: &ImageBuffer<Rgb<u8>, Vec<u8>>, target_w: u32, target_h: u32) -> Vec<f32> {
    let mut data = Vec::with_capacity(3 * target_h as usize * target_w as usize);
    for c in 0..3 {
        data.extend(img.pixels().map(|p| (p[c] as f32 / 255.0 - 0.5) / 0.5));
    }
    data
}

fn optimized_loop_flat_map(
    img: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    target_w: u32,
    target_h: u32,
) -> Vec<f32> {
    let mut data = Vec::with_capacity(3 * target_h as usize * target_w as usize);
    data.extend((0..3).flat_map(|c| img.pixels().map(move |p| (p[c] as f32 / 255.0 - 0.5) / 0.5)));
    data
}

fn main() {
    let target_w = 200;
    let target_h = 48;
    let img = ImageBuffer::from_fn(target_w, target_h, |x, y| {
        Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
    });

    // Warmup
    original_loop(&img, target_w, target_h);
    optimized_loop(&img, target_w, target_h);
    optimized_loop_flat_map(&img, target_w, target_h);

    let iters = 10000;

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(original_loop(
            std::hint::black_box(&img),
            std::hint::black_box(target_w),
            std::hint::black_box(target_h),
        ));
    }
    println!("original_loop: {:?}", start.elapsed());

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(optimized_loop(
            std::hint::black_box(&img),
            std::hint::black_box(target_w),
            std::hint::black_box(target_h),
        ));
    }
    println!("optimized_loop: {:?}", start.elapsed());

    let start = Instant::now();
    for _ in 0..iters {
        std::hint::black_box(optimized_loop_flat_map(
            std::hint::black_box(&img),
            std::hint::black_box(target_w),
            std::hint::black_box(target_h),
        ));
    }
    println!("optimized_loop_flat_map: {:?}", start.elapsed());
}
