//! Optional Explorer and Outlook preview for `.pdf`.
//! Bytes are staged under the preview user-data folder and shown by Edge's PDF
//! viewer. The viewer is not a general browser: only that one document URL and
//! the built-in PDF extension are allowed to navigate.

use std::path::{Path, PathBuf};

pub(crate) const PDF_REFUSE: &str = "Can't preview this PDF.";
pub(crate) const PDF_MAX: u64 = 15 * 1024 * 1024;
pub(crate) const PDF_HOST: &str = "speeddf-pdf.invalid";
pub(crate) const PDF_FILE: &str = "preview.pdf";

const DOCUMENT_BARE: &str = "https://speeddf-pdf.invalid/preview.pdf";
const PDF_VIEWER_PREFIX: &str = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";

pub(crate) struct StagedPdf {
    pub folder: PathBuf,
    pub uri: String,
    pub bytes: u64,
}

pub(crate) fn is_pdf_name(name: &str) -> bool {
    name.rsplit(['\\', '/'])
        .next()
        .unwrap_or(name)
        .trim()
        .to_ascii_lowercase()
        .ends_with(".pdf")
}

pub(crate) fn over_cap(bytes: u64) -> bool {
    bytes > PDF_MAX
}

pub(crate) fn has_pdf_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 5 && bytes.starts_with(b"%PDF-")
}

pub(crate) fn document_uri() -> String {
    format!("{DOCUMENT_BARE}#page=1")
}

/// `true` when `uri` is the staged document or Edge's built-in PDF viewer.
pub(crate) fn pdf_navigation_allowed(uri: &str) -> bool {
    let lower = uri.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    let bare = lower.split(['#', '?']).next().unwrap_or(&lower);
    bare == DOCUMENT_BARE || lower.starts_with(PDF_VIEWER_PREFIX)
}

pub(crate) fn stage_bytes(bytes: &[u8]) -> Result<StagedPdf, ()> {
    if bytes.is_empty() || over_cap(bytes.len() as u64) || !has_pdf_magic(bytes) {
        return Err(());
    }
    let folder = stage_folder()?;
    let path = folder.join(PDF_FILE);
    std::fs::write(&path, bytes).map_err(|_| ())?;
    Ok(StagedPdf {
        folder,
        uri: document_uri(),
        bytes: bytes.len() as u64,
    })
}

pub(crate) fn remove_staged(folder: &str) {
    if folder.is_empty() {
        return;
    }
    let folder = PathBuf::from(folder);
    let _ = std::fs::remove_file(folder.join(PDF_FILE));
    let _ = std::fs::remove_dir(&folder);
}

fn stage_folder() -> Result<PathBuf, ()> {
    let local = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty());
    let Some(local) = local else {
        return Err(());
    };
    let speed = PathBuf::from(local).join("speedDF");
    let base = speed.join("preview-wv2");
    let pid = base.join(std::process::id().to_string());
    let folder = pid.join("pdf-stage");
    for dir in [&speed, &base, &pid, &folder] {
        ensure_dir(dir)?;
    }
    Ok(folder)
}

fn ensure_dir(path: &Path) -> Result<(), ()> {
    match std::fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(err)
            if err.kind() == std::io::ErrorKind::AlreadyExists || err.raw_os_error() == Some(183) =>
        {
            Ok(())
        }
        Err(_) => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        document_uri, has_pdf_magic, is_pdf_name, over_cap, pdf_navigation_allowed, PDF_MAX,
    };

    #[test]
    fn names_and_magic() {
        assert!(is_pdf_name(r"C:\docs\Page.PDF"));
        assert!(is_pdf_name("scan.pdf"));
        assert!(!is_pdf_name("notes.md"));
        assert!(!is_pdf_name("diagram.svg"));
        assert!(!is_pdf_name("notpdf.txt"));
        assert!(has_pdf_magic(b"%PDF-1.7\n"));
        assert!(!has_pdf_magic(b"%PDF"));
        assert!(!has_pdf_magic(b"<html"));
        assert!(!over_cap(PDF_MAX));
        assert!(over_cap(PDF_MAX + 1));
    }

    #[test]
    fn navigation_stays_on_the_staged_pdf() {
        let uri = document_uri();
        assert!(pdf_navigation_allowed(&uri));
        assert!(pdf_navigation_allowed(
            "https://speeddf-pdf.invalid/preview.pdf"
        ));
        assert!(pdf_navigation_allowed(
            "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html"
        ));
        assert!(!pdf_navigation_allowed("https://example.com/preview.pdf"));
        assert!(!pdf_navigation_allowed("file:///C:/docs/secret.pdf"));
        assert!(!pdf_navigation_allowed("data:text/html,hi"));
        assert!(!pdf_navigation_allowed("javascript:alert(1)"));
    }
}
