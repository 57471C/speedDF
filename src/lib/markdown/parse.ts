/**
 * Markdown → HTML projection (frontend-only).
 * Source text stays canonical; this is a pure view transform.
 */
import { marked } from "marked";

marked.setOptions({
	gfm: true,
	breaks: false,
});

/**
 * Parse markdown source into raw HTML (not XSS-safe — always sanitize before {@html}).
 */
export function parseMarkdownToHtml(source: string): string {
	if (!source) return "";
	const result = marked.parse(source, { async: false });
	return typeof result === "string" ? result : "";
}
