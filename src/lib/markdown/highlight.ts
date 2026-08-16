/**
 * Shared syntax highlighter (highlight.js core + a small language set).
 * Used by the source overlay and by fenced ``` blocks in the preview.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

/** Overlay re-highlight delay (ms). Textarea stays live. */
export const EDITOR_HIGHLIGHT_DEBOUNCE_MS = 64;

const LANG_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	rs: "rust",
	py: "python",
	sh: "bash",
	zsh: "bash",
	shell: "bash",
	html: "xml",
	svg: "xml",
	xhtml: "xml",
	md: "markdown",
	txt: "plaintext",
	text: "plaintext",
};

let registered = false;

function ensureLanguages(): void {
	if (registered) return;
	registered = true;
	hljs.registerLanguage("javascript", javascript);
	hljs.registerLanguage("typescript", typescript);
	hljs.registerLanguage("rust", rust);
	hljs.registerLanguage("json", json);
	hljs.registerLanguage("css", css);
	hljs.registerLanguage("xml", xml);
	hljs.registerLanguage("python", python);
	hljs.registerLanguage("bash", bash);
	hljs.registerLanguage("markdown", markdown);
	hljs.registerLanguage("plaintext", plaintext);
}

export function escapeHtml(text: string): string {
	return (text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function unescapeHtml(text: string): string {
	return (text ?? "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Map a fence info-string (`ts`, `JS`, `rust`) onto a registered language. */
export function resolveHighlightLang(lang: string | undefined | null): string | null {
	if (!lang) return null;
	ensureLanguages();
	const key = lang.trim().toLowerCase();
	if (!key) return null;
	const resolved = LANG_ALIASES[key] ?? key;
	return hljs.getLanguage(resolved) ? resolved : null;
}

export function highlightFenced(
	code: string,
	lang?: string | null,
): { html: string; language: string | null } {
	ensureLanguages();
	const resolved = resolveHighlightLang(lang ?? undefined);
	if (!resolved) {
		return { html: escapeHtml(code ?? ""), language: null };
	}
	try {
		return {
			html: hljs.highlight(code ?? "", {
				language: resolved,
				ignoreIllegals: true,
			}).value,
			language: resolved,
		};
	} catch {
		return { html: escapeHtml(code ?? ""), language: resolved };
	}
}

/** Preview HTML for a marked fenced/indented code token. */
export function renderFencedBlock(code: string, lang?: string | null): string {
	const { html, language } = highlightFenced(code, lang);
	const langClass = language ? ` language-${escapeHtml(language)}` : "";
	const dataLang = lang
		? ` data-lang="${escapeHtml(lang.trim().split(/\s+/)[0] || "")}"`
		: "";
	return `<pre><code class="hljs${langClass}"${dataLang}>${html}</code></pre>\n`;
}

function highlightMarkdownFragment(fragment: string): string {
	if (!fragment) return "";
	ensureLanguages();
	try {
		return hljs.highlight(fragment, {
			language: "markdown",
			ignoreIllegals: true,
		}).value;
	} catch {
		return escapeHtml(fragment);
	}
}

const FENCE_OPEN = /^(\s*)(```|~~~)(.*)$/;

function isFenceClose(line: string, marker: string): boolean {
	const m = FENCE_OPEN.exec(line);
	return !!m && m[2] === marker && m[3].trim() === "";
}

/**
 * Highlight markdown source for the editor overlay.
 * Fenced ```ts / ```rust / ```js bodies use the same language highlighters
 * as the preview; surrounding prose uses the markdown grammar.
 * Output character stream (decoded) matches `source` so the overlay lines up.
 */
export function highlightMarkdownSource(source: string): string {
	if (!source) return "";
	ensureLanguages();

	const lines = source.split("\n");
	const out: string[] = [];
	let mdBuf: string[] = [];
	let inFence = false;
	let fenceMarker = "";
	let fenceLang = "";
	let fenceOpenLine = "";
	let fenceBody: string[] = [];

	const flushMarkdown = () => {
		if (mdBuf.length === 0) return;
		out.push(highlightMarkdownFragment(mdBuf.join("\n")));
		mdBuf = [];
	};

	const emitFence = (closeLine: string | null) => {
		const body = fenceBody.join("\n");
		const { html } = highlightFenced(body, fenceLang || null);
		const open = `<span class="hljs-meta">${escapeHtml(fenceOpenLine)}</span>`;
		if (closeLine == null) {
			out.push(body.length > 0 ? `${open}\n${html}` : open);
		} else {
			const close = `<span class="hljs-meta">${escapeHtml(closeLine)}</span>`;
			out.push(body.length > 0 ? `${open}\n${html}\n${close}` : `${open}\n${close}`);
		}
		inFence = false;
		fenceBody = [];
	};

	for (const line of lines) {
		if (!inFence) {
			const open = FENCE_OPEN.exec(line);
			if (open) {
				flushMarkdown();
				inFence = true;
				fenceMarker = open[2];
				fenceLang = open[3].trim().split(/\s+/)[0] || "";
				fenceOpenLine = line;
				fenceBody = [];
			} else {
				mdBuf.push(line);
			}
		} else if (isFenceClose(line, fenceMarker)) {
			emitFence(line);
		} else {
			fenceBody.push(line);
		}
	}

	if (inFence) {
		emitFence(null);
	} else {
		flushMarkdown();
	}

	return out.join("\n");
}
