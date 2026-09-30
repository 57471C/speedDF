//! Markdown to a sanitized HTML document. The fragment is cleaned before it
//! is wrapped, so the preview stylesheet is ours and the document cannot carry
//! script, event handlers, or `javascript:` URLs.

use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MdKind {
    Paragraph,
    Heading(u8),
    Bullet,
    Numbered(u64),
    Code,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MdRun {
    pub text: String,
    pub strong: bool,
    pub code: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MdBlock {
    pub kind: MdKind,
    pub runs: Vec<MdRun>,
}

pub(crate) fn markdown_blocks(source: &str) -> Vec<MdBlock> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(source, options);

    let mut blocks = Vec::new();
    let mut runs = Vec::new();
    let mut strong = 0i32;
    let mut lists: Vec<Option<u64>> = Vec::new();
    let mut in_item = false;
    let mut item_body = false;
    let mut kind = MdKind::Paragraph;
    let mut in_html = 0i32;

    for event in parser {
        match event {
            Event::Start(Tag::HtmlBlock) => in_html += 1,
            Event::End(TagEnd::HtmlBlock) => in_html -= 1,
            Event::Html(_) | Event::InlineHtml(_) => {}
            Event::Start(Tag::Heading { level, .. }) => {
                kind = MdKind::Heading(heading_rank(level));
            }
            Event::End(TagEnd::Heading(_)) => {
                flush_block(&mut blocks, &mut runs, kind);
                kind = MdKind::Paragraph;
            }
            Event::Start(Tag::List(start)) => lists.push(start),
            Event::End(TagEnd::List(_)) => {
                lists.pop();
            }
            Event::Start(Tag::Item) => {
                in_item = true;
                item_body = false;
                kind = match lists.last_mut() {
                    Some(next) => match *next {
                        Some(n) => {
                            *next = Some(n.saturating_add(1));
                            MdKind::Numbered(n)
                        }
                        None => MdKind::Bullet,
                    },
                    None => MdKind::Bullet,
                };
            }
            Event::End(TagEnd::Item) => {
                flush_block(&mut blocks, &mut runs, kind);
                in_item = false;
                item_body = false;
                kind = MdKind::Paragraph;
            }
            Event::Start(Tag::CodeBlock(_)) => kind = MdKind::Code,
            Event::End(TagEnd::CodeBlock) => {
                flush_block(&mut blocks, &mut runs, MdKind::Code);
                kind = MdKind::Paragraph;
            }
            Event::Start(Tag::Strong) | Event::Start(Tag::Emphasis) => strong += 1,
            Event::End(TagEnd::Strong) | Event::End(TagEnd::Emphasis) => strong = (strong - 1).max(0),
            Event::TaskListMarker(checked) => {
                push_run(
                    &mut runs,
                    if checked { "[x] " } else { "[ ] " },
                    false,
                    false,
                );
            }
            Event::Text(text) => {
                if in_html > 0 {
                    continue;
                }
                push_run(&mut runs, text.as_ref(), strong > 0, false);
            }
            Event::Code(text) => {
                if in_html > 0 {
                    continue;
                }
                push_run(&mut runs, text.as_ref(), strong > 0, true);
            }
            Event::SoftBreak => push_run(&mut runs, " ", false, false),
            Event::HardBreak => push_run(&mut runs, "\n", false, false),
            Event::Rule => {
                flush_block(&mut blocks, &mut runs, kind);
                push_run(&mut runs, "—", false, false);
                flush_block(&mut blocks, &mut runs, MdKind::Paragraph);
            }
            Event::End(TagEnd::Paragraph) | Event::End(TagEnd::TableCell) => {
                let block_kind = if in_item && !item_body { kind } else { MdKind::Paragraph };
                flush_block(&mut blocks, &mut runs, block_kind);
                if in_item {
                    item_body = true;
                }
            }
            _ => {}
        }
    }
    flush_block(&mut blocks, &mut runs, kind);
    blocks
}

fn heading_rank(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn push_run(runs: &mut Vec<MdRun>, text: &str, strong: bool, code: bool) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = runs.last_mut() {
        if last.strong == strong && last.code == code {
            last.text.push_str(text);
            return;
        }
    }
    runs.push(MdRun {
        text: text.to_string(),
        strong,
        code,
    });
}

fn flush_block(blocks: &mut Vec<MdBlock>, runs: &mut Vec<MdRun>, kind: MdKind) {
    if runs.iter().all(|run| run.text.trim().is_empty()) {
        runs.clear();
        return;
    }
    let mut runs = std::mem::take(runs);
    match kind {
        MdKind::Bullet => runs.insert(
            0,
            MdRun {
                text: "• ".to_string(),
                strong: false,
                code: false,
            },
        ),
        MdKind::Numbered(n) => runs.insert(
            0,
            MdRun {
                text: format!("{n}. "),
                strong: false,
                code: false,
            },
        ),
        _ => {}
    }
    blocks.push(MdBlock { kind, runs });
}

const HTML_CAP: usize = 1_500_000;

pub(crate) fn markdown_document(source: &str) -> String {
    let mut document = wrap(&sanitize(&render(source)));
    if document.len() > HTML_CAP {
        let end = source.floor_char_boundary(source.len().min(800_000));
        document = wrap(&format!("{}<p>…</p>", sanitize(&render(&source[..end]))));
    }
    document
}

fn render(source: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(source, options);
    let mut html_out = String::new();
    html::push_html(&mut html_out, parser);
    html_out
}

fn sanitize(fragment: &str) -> String {
    ammonia::clean(fragment).to_string()
}

fn wrap(fragment: &str) -> String {
    format!(
        concat!(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:;\">",
            "<style>",
            "body{{margin:16px;font:16px/1.45 'Segoe UI',sans-serif;color:#1b1b1b;background:#fff;}}",
            "pre,code{{font-family:Consolas,'Cascadia Mono',monospace;}}",
            "pre{{background:#f4f4f4;padding:8px;overflow:auto;}}",
            "table{{border-collapse:collapse;}}",
            "td,th{{border:1px solid #ccc;padding:4px 8px;}}",
            "a{{color:#0b6e4f;}}",
            "</style></head><body>",
            "{fragment}",
            "</body></html>"
        ),
        fragment = fragment
    )
}

#[cfg(test)]
mod tests {
    use super::{markdown_blocks, markdown_document, MdKind};

    #[test]
    fn renders_markdown_and_strips_script() {
        let html = markdown_document(
            "# Hello\n\n**bold**\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n",
        );
        let lower = html.to_ascii_lowercase();
        assert!(lower.contains("<h1"));
        assert!(lower.contains("hello"));
        assert!(lower.contains("<strong>"));
        assert!(lower.contains("bold"));
        assert!(!lower.contains("<script"));
        assert!(!lower.contains("onerror"));
        assert!(!lower.contains("javascript:"));
        assert!(lower.contains("content-security-policy"));
        assert!(lower.contains("script-src 'none'"));
    }

    #[test]
    fn gdi_blocks_keep_headings_and_lists_and_drop_script() {
        let source = include_str!("../fixtures/spike.md");
        let blocks = markdown_blocks(source);
        let flat = blocks
            .iter()
            .map(|block| {
                block
                    .runs
                    .iter()
                    .map(|run| run.text.as_str())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(blocks.iter().any(|block| {
            block.kind == MdKind::Heading(1)
                && block.runs.iter().any(|run| run.text.contains("Spike heading"))
        }));
        assert!(flat.contains("• alpha item"));
        assert!(flat.contains("• beta item"));
        assert!(flat.contains("1. first step"));
        assert!(flat.contains("2. second step"));
        assert!(blocks.iter().any(|block| {
            block.runs.iter().any(|run| run.strong && run.text == "name")
        }));
        assert!(blocks.iter().any(|block| {
            block.kind == MdKind::Code
                && block.runs.iter().any(|run| run.text.contains("let spike = 1"))
        }));
        let lower = flat.to_ascii_lowercase();
        assert!(!lower.contains("script"));
        assert!(!lower.contains("alert"));
    }
}
