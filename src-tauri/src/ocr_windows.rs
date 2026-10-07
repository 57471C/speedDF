//! Windows.Media.Ocr for the OCR panel.
//! Mac and Linux return `ocr-not-available` and keep tract (`run_local_ocr`).
//! A null Windows engine is `ocr-language-missing`. This module never calls tract.

use serde::Serialize;

/// Longest side passed to `RecognizeAsync`. Boxes are scaled back to the source image.
#[cfg(any(windows, test))]
pub(crate) const MAX_OCR_SIDE: u32 = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    #[serde(rename = "box")]
    pub bounds: OcrBox,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPage {
    pub lines: Vec<OcrLine>,
    pub text: String,
    pub elapsed_ms: u64,
}

/// Fit `src_w` x `src_h` inside `max_side` on the longest edge. 1:1 when already inside.
#[cfg(any(windows, test))]
pub(crate) fn capped_size(src_w: u32, src_h: u32, max_side: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 || max_side == 0 {
        return (src_w, src_h);
    }
    let longest = src_w.max(src_h);
    if longest <= max_side {
        return (src_w, src_h);
    }
    let scale = f64::from(max_side) / f64::from(longest);
    let dst_w = ((f64::from(src_w) * scale).round() as u32).max(1);
    let dst_h = ((f64::from(src_h) * scale).round() as u32).max(1);
    (dst_w, dst_h)
}

/// Map a box from the recognized bitmap back onto source-image pixels.
#[cfg(any(windows, test))]
pub(crate) fn scale_box_to_source(
    recognized: OcrBox,
    src_w: u32,
    src_h: u32,
    recognized_w: u32,
    recognized_h: u32,
) -> OcrBox {
    if recognized_w == 0 || recognized_h == 0 {
        return recognized;
    }
    let scale_x = src_w as f32 / recognized_w as f32;
    let scale_y = src_h as f32 / recognized_h as f32;
    OcrBox {
        x: recognized.x * scale_x,
        y: recognized.y * scale_y,
        width: recognized.width * scale_x,
        height: recognized.height * scale_y,
    }
}

#[cfg(any(windows, test))]
fn union_box(a: OcrBox, b: OcrBox) -> OcrBox {
    let left = a.x.min(b.x);
    let top = a.y.min(b.y);
    let right = (a.x + a.width).max(b.x + b.width);
    let bottom = (a.y + a.height).max(b.y + b.height);
    OcrBox {
        x: left,
        y: top,
        width: (right - left).max(0.0),
        height: (bottom - top).max(0.0),
    }
}

#[cfg(windows)]
mod winrt {
    use super::{
        capped_size, scale_box_to_source, union_box, OcrBox, OcrLine, OcrPage, MAX_OCR_SIDE,
    };
    use std::time::Instant;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat,
        BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    fn winrt_err(err: windows::core::Error) -> String {
        format!("ocr-windows: {err}")
    }

    struct CloseBitmap(windows::Graphics::Imaging::SoftwareBitmap);
    impl Drop for CloseBitmap {
        fn drop(&mut self) {
            let _ = self.0.Close();
        }
    }

    /// `TryCreateFromUserProfileLanguages` returns a null engine when the user has no OCR language.
    /// windows-rs surfaces that null as an empty error (success code, no object).
    fn create_user_engine() -> Result<OcrEngine, String> {
        match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(engine) => Ok(engine),
            Err(err) if err.code().0 == 0 => Err("ocr-language-missing".to_string()),
            Err(err) => Err(winrt_err(err)),
        }
    }

    fn side_cap() -> u32 {
        match OcrEngine::MaxImageDimension() {
            Ok(max_dim) if max_dim > 0 => max_dim.min(MAX_OCR_SIDE),
            _ => MAX_OCR_SIDE,
        }
    }

    fn decode_bgra8(
        png: &[u8],
    ) -> Result<(windows::Graphics::Imaging::SoftwareBitmap, u32, u32), String> {
        let stream = InMemoryRandomAccessStream::new().map_err(winrt_err)?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(winrt_err)?;
        writer.WriteBytes(png).map_err(winrt_err)?;
        writer
            .StoreAsync()
            .map_err(winrt_err)?
            .get()
            .map_err(winrt_err)?;
        // Drop the writer's claim so the decoder can read the same stream.
        writer.DetachStream().map_err(winrt_err)?;
        stream.Seek(0).map_err(winrt_err)?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(winrt_err)?
            .get()
            .map_err(winrt_err)?;
        // Oriented size is the pixel grid the preview shows. RespectExifOrientation below matches it.
        let src_w = decoder.OrientedPixelWidth().map_err(winrt_err)?;
        let src_h = decoder.OrientedPixelHeight().map_err(winrt_err)?;
        if src_w == 0 || src_h == 0 {
            let _ = stream.Close();
            return Err("ocr-windows: image has no pixels".to_string());
        }

        let (dst_w, dst_h) = capped_size(src_w, src_h, side_cap());
        let transform = BitmapTransform::new().map_err(winrt_err)?;
        transform.SetScaledWidth(dst_w).map_err(winrt_err)?;
        transform.SetScaledHeight(dst_h).map_err(winrt_err)?;
        transform
            .SetInterpolationMode(BitmapInterpolationMode::Fant)
            .map_err(winrt_err)?;

        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .map_err(winrt_err)?
            .get()
            .map_err(winrt_err)?;

        let _ = stream.Close();
        Ok((bitmap, src_w, src_h))
    }

    pub fn recognize(image_png: Vec<u8>) -> Result<OcrPage, String> {
        if image_png.is_empty() {
            return Err("ocr-windows: image has no pixels".to_string());
        }

        let started = Instant::now();
        let (bitmap, src_w, src_h) = decode_bgra8(&image_png)?;
        let bitmap = CloseBitmap(bitmap);
        // A missing OCR language stops here. Tract is not called.
        let engine = create_user_engine()?;

        let rec_w = u32::try_from(bitmap.0.PixelWidth().map_err(winrt_err)?).unwrap_or(0);
        let rec_h = u32::try_from(bitmap.0.PixelHeight().map_err(winrt_err)?).unwrap_or(0);
        if rec_w == 0 || rec_h == 0 {
            return Err("ocr-windows: image has no pixels".to_string());
        }

        // windows-future is built without its std feature, so RecognizeAsync completes via get().
        let result = engine
            .RecognizeAsync(&bitmap.0)
            .map_err(winrt_err)?
            .get()
            .map_err(winrt_err)?;
        drop(bitmap);

        let win_lines = result.Lines().map_err(winrt_err)?;
        let line_count = win_lines.Size().map_err(winrt_err)?;
        let mut lines = Vec::with_capacity(line_count as usize);
        for index in 0..line_count {
            let line = win_lines.GetAt(index).map_err(winrt_err)?;
            let text = line.Text().map_err(winrt_err)?.to_string();
            let words = line.Words().map_err(winrt_err)?;
            let word_count = words.Size().map_err(winrt_err)?;
            let mut bounds: Option<OcrBox> = None;
            for word_index in 0..word_count {
                let word = words.GetAt(word_index).map_err(winrt_err)?;
                let rect = word.BoundingRect().map_err(winrt_err)?;
                let word_box = scale_box_to_source(
                    OcrBox {
                        x: rect.X,
                        y: rect.Y,
                        width: rect.Width,
                        height: rect.Height,
                    },
                    src_w,
                    src_h,
                    rec_w,
                    rec_h,
                );
                bounds = Some(match bounds {
                    Some(acc) => union_box(acc, word_box),
                    None => word_box,
                });
            }
            lines.push(OcrLine {
                text,
                bounds: bounds.unwrap_or(OcrBox {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                }),
            });
        }

        let text = result
            .Text()
            .map(|value| value.to_string())
            .unwrap_or_else(|_| {
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            });
        let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        println!(
            "[BENCH] engine=windows elapsed_ms={elapsed_ms} lines={} source={src_w}x{src_h} recognized={rec_w}x{rec_h}",
            lines.len()
        );

        Ok(OcrPage {
            lines,
            text,
            elapsed_ms,
        })
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn run_windows_ocr(image_png: Vec<u8>) -> Result<OcrPage, String> {
    tokio::task::spawn_blocking(move || winrt::recognize(image_png))
        .await
        .map_err(|err| format!("ocr-windows: {err}"))?
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn run_windows_ocr(image_png: Vec<u8>) -> Result<OcrPage, String> {
    let _ = image_png;
    Err("ocr-not-available".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_small_images_unscaled() {
        assert_eq!(capped_size(800, 600, MAX_OCR_SIDE), (800, 600));
        assert_eq!(capped_size(2000, 1000, MAX_OCR_SIDE), (2000, 1000));
    }

    #[test]
    fn caps_the_longest_side_at_2000() {
        assert_eq!(capped_size(4000, 2000, MAX_OCR_SIDE), (2000, 1000));
        assert_eq!(capped_size(1000, 5000, MAX_OCR_SIDE), (400, 2000));
    }

    #[test]
    fn scales_boxes_back_to_source_pixels() {
        let recognized = OcrBox {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
        };
        let source = scale_box_to_source(recognized, 4000, 2000, 2000, 1000);
        assert!((source.x - 20.0).abs() < 0.01);
        assert!((source.y - 40.0).abs() < 0.01);
        assert!((source.width - 60.0).abs() < 0.01);
        assert!((source.height - 80.0).abs() < 0.01);
    }

    #[test]
    fn unions_word_boxes() {
        let merged = union_box(
            OcrBox {
                x: 10.0,
                y: 20.0,
                width: 30.0,
                height: 10.0,
            },
            OcrBox {
                x: 50.0,
                y: 18.0,
                width: 20.0,
                height: 16.0,
            },
        );
        assert!((merged.x - 10.0).abs() < 0.01);
        assert!((merged.y - 18.0).abs() < 0.01);
        assert!((merged.width - 60.0).abs() < 0.01);
        assert!((merged.height - 16.0).abs() < 0.01);
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn non_windows_command_is_unavailable() {
        let err = run_windows_ocr(vec![1, 2, 3]).await.unwrap_err();
        assert_eq!(err, "ocr-not-available");
    }

    #[cfg(windows)]
    fn one_pixel_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 255, 255, 255]));
        let mut cursor = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("png encode");
        cursor.into_inner()
    }

    /// Decode must succeed even when the OCR language pack is missing.
    /// A missing pack is `ocr-language-missing` and nothing else (no tract).
    #[cfg(windows)]
    #[tokio::test]
    async fn windows_png_recognizes_or_reports_missing_language() {
        let result = run_windows_ocr(one_pixel_png()).await;
        match result {
            Ok(page) => {
                assert!(page.elapsed_ms < 60_000);
            }
            Err(err) => assert_eq!(err, "ocr-language-missing"),
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_caps_a_wide_image_before_recognize() {
        let image = image::RgbaImage::from_pixel(2400, 16, image::Rgba([255, 255, 255, 255]));
        let mut cursor = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("png encode");
        let result = run_windows_ocr(cursor.into_inner()).await;
        match result {
            Ok(page) => assert!(page.elapsed_ms < 60_000),
            Err(err) => assert_eq!(err, "ocr-language-missing"),
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_rejects_bytes_that_are_not_a_bitmap() {
        let err = run_windows_ocr(b"not-a-png".to_vec()).await.unwrap_err();
        assert_ne!(err, "ocr-not-available");
        assert_ne!(err, "ocr-language-missing");
        assert!(err.starts_with("ocr-windows:"));
    }
}
