//! Optional Explorer preview for `.svg`.
//! The file is shown as a static image. Script and external documents are not run.

pub(crate) const SVG_REFUSE: &str = "Can't preview this SVG.";
const SVG_MAX: usize = 1024 * 1024;

pub(crate) fn is_svg_name(name: &str) -> bool {
    name.rsplit(['\\', '/'])
        .next()
        .unwrap_or(name)
        .trim()
        .to_ascii_lowercase()
        .ends_with(".svg")
}

/// `Ok` is a script-free HTML page whose only image is the SVG bytes.
/// `Err` is a static reason. Callers log that reason and paint [`SVG_REFUSE`].
pub(crate) fn prepare_svg(bytes: &[u8], truncated: bool) -> Result<String, &'static str> {
    if truncated || bytes.is_empty() || bytes.len() > SVG_MAX {
        return Err("huge");
    }
    let mut raw = bytes;
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw = &raw[3..];
    }
    if raw.is_empty() {
        return Err("huge");
    }
    let text = String::from_utf8_lossy(raw);
    let lower = text.to_ascii_lowercase();
    if !lower.contains("<svg") {
        return Err("not-svg");
    }
    if is_hostile(&lower) {
        return Err("hostile");
    }
    let page = wrap_image(&base64(raw));
    if page.len() > 1_500_000 {
        return Err("huge");
    }
    Ok(page)
}

fn is_hostile(lower: &str) -> bool {
    const MARKERS: &[&str] = &[
        "<!entity",
        "<script",
        "javascript:",
        "<foreignobject",
        "<iframe",
        "<embed",
        "<object",
    ];
    if MARKERS.iter().any(|marker| lower.contains(marker)) {
        return true;
    }
    has_inline_handler(lower)
}

fn has_inline_handler(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i + 5 < bytes.len() {
        let boundary = matches!(bytes[i], b' ' | b'\n' | b'\r' | b'\t' | b'/');
        if boundary && bytes[i + 1] == b'o' && bytes[i + 2] == b'n' {
            let rest = &lower[i + 3..];
            if let Some(eq) = rest.find('=') {
                let name = &rest[..eq];
                if (1..=20).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphabetic()) {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

fn wrap_image(b64: &str) -> String {
    format!(
        concat!(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:;\">",
            "<style>html,body{{margin:0;height:100%;background:#fff;}}",
            "img{{display:block;max-width:100%;max-height:100%;margin:auto;}}</style>",
            "</head><body><img alt=\"\" src=\"data:image/svg+xml;base64,{b64}\"></body></html>"
        ),
        b64 = b64
    )
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    let rest = bytes.len() - i;
    if rest == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{is_svg_name, prepare_svg};

    const ICON: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0b6e4f"/></svg>"##;

    #[test]
    fn treats_svg_as_a_static_image() {
        let html = prepare_svg(ICON.as_bytes(), false).unwrap();
        let lower = html.to_ascii_lowercase();
        assert!(lower.contains("script-src 'none'"));
        assert!(lower.contains("img-src data:"));
        assert!(lower.contains("data:image/svg+xml;base64,"));
        assert!(!lower.contains("<script"));
        assert!(!lower.contains("<rect"));
    }

    #[test]
    fn refuses_script_entities_and_handlers() {
        assert!(prepare_svg(b"<svg><script>alert(1)</script></svg>", false).is_err());
        assert!(prepare_svg(b"<svg><!ENTITY x \"x\"></svg>", false).is_err());
        assert!(prepare_svg(b"<svg onload=\"alert(1)\"></svg>", false).is_err());
        assert!(prepare_svg(br#"<svg><a href="javascript:alert(1)"/></svg>"#, false).is_err());
    }

    #[test]
    fn refuses_empty_truncated_and_non_svg() {
        assert!(prepare_svg(b"", false).is_err());
        assert!(prepare_svg(ICON.as_bytes(), true).is_err());
        assert!(prepare_svg(b"<html>no</html>", false).is_err());
        let huge = vec![b'a'; 1024 * 1024 + 1];
        assert!(prepare_svg(&huge, false).is_err());
    }

    #[test]
    fn names_only_the_svg_extension() {
        assert!(is_svg_name(r"C:\icons\Mark.SVG"));
        assert!(is_svg_name("icon.svg"));
        assert!(!is_svg_name("note.md"));
        assert!(!is_svg_name("picture.svg.png"));
        assert!(!is_svg_name("file.pdf"));
    }
}
