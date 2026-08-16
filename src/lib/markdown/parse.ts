/**
 * Markdown → HTML projection (frontend-only).
 * Source text stays canonical; this is a pure view transform.
 * Fenced code uses the shared highlight.js pipeline.
 */
import { Marked } from "marked";
import { renderFencedBlock, unescapeHtml } from "./highlight";

const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		code({ text, lang, escaped }) {
			const raw = escaped ? unescapeHtml(text) : text;
			return renderFencedBlock(raw, lang);
		},
	},
});

/**
 * Parse markdown source into raw HTML (not XSS-safe — always sanitize before inject).
 */
export function parseMarkdownToHtml(source: string): string {
	if (!source) return "";
	const result = marked.parse(source, { async: false });
	return typeof result === "string" ? result : "";
}
