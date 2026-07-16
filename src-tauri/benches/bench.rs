use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;
use image::{ImageBuffer, Rgb};

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

fn benchmark(c: &mut Criterion) {
    let target_w = 200;
    let target_h = 48;
    let img = ImageBuffer::from_fn(target_w, target_h, |x, y| {
        Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
    });

    c.bench_function("original_loop", |b| {
        b.iter(|| original_loop(black_box(&img), black_box(target_w), black_box(target_h)))
    });
    c.bench_function("optimized_loop", |b| {
        b.iter(|| optimized_loop(black_box(&img), black_box(target_w), black_box(target_h)))
    });
}

criterion_group!(benches, benchmark);
criterion_main!(benches);
