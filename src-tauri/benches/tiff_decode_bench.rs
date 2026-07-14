use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_rgb_u16(c: &mut Criterion) {
    let mut data = vec![];
    for i in 0..1920 * 1080 {
        data.push(i as u16);
        data.push(i as u16);
        data.push(i as u16);
    }

    c.bench_function("rgb_u16_chunk_extend", |b| {
        b.iter(|| {
            let mut rgba_buffer = Vec::with_capacity((1920 * 1080 * 4) as usize);
            for chunk in black_box(&data).chunks_exact(3) {
                rgba_buffer.extend_from_slice(&[
                    (chunk[0] >> 8) as u8,
                    (chunk[1] >> 8) as u8,
                    (chunk[2] >> 8) as u8,
                    255,
                ]);
            }
            rgba_buffer
        })
    });
}

fn bench_rgba_u16(c: &mut Criterion) {
    let mut data = vec![];
    for i in 0..1920 * 1080 {
        data.push(i as u16);
        data.push(i as u16);
        data.push(i as u16);
        data.push(i as u16);
    }

    c.bench_function("rgba_u16_chunk_extend", |b| {
        b.iter(|| {
            let mut rgba_buffer = Vec::with_capacity((1920 * 1080 * 4) as usize);
            for chunk in black_box(&data).chunks_exact(4) {
                rgba_buffer.extend_from_slice(&[
                    (chunk[0] >> 8) as u8,
                    (chunk[1] >> 8) as u8,
                    (chunk[2] >> 8) as u8,
                    (chunk[3] >> 8) as u8,
                ]);
            }
            rgba_buffer
        })
    });
}

criterion_group!(benches, bench_rgb_u16, bench_rgba_u16);
criterion_main!(benches);
