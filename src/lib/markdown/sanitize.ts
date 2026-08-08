/**
 * XSS-safe HTML for markdown projection.
 * DOMPurify runs in the browser (WebView); SSR/tests without window get a light strip.
 */
import DOMPurify from "dompurify";
import { parseMarkdownToHtml } from "./parse";

let hooksInstalled = false;

function ensureHooks(): void {
	if (hooksInstalled || typeof window === "undefined") return;
	hooksInstalled = true;
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			const href = node.getAttribute("href") || "";
			// Block javascript: and similar
			if (/^\s*javascript:/i.test(href)) {
				node.removeAttribute("href");
			}
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer");
		}
		if (node.tagName === "IMG") {
			const src = node.getAttribute("src") || "";
			// Drop script-like schemes; relative / http(s) / data: kept for best-effort images
			if (/^\s*javascript:/i.test(src) || /^\s*vbscript:/i.test(src)) {
				node.removeAttribute("src");
			}
		}
	});
}

/**
 * Sanitize HTML produced by the markdown parser for safe {@html} injection.
 */
export function sanitizeHtml(dirty: string): string {
	if (!dirty) return "";
	if (typeof window === "undefined") {
		// Static/SSR path: strip obvious script tags (app is SPA; real purify runs in WebView)
		return dirty.replace(
			/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
			"",
		);
	}
	ensureHooks();
	return DOMPurify.sanitize(dirty, {
		USE_PROFILES: { html: true },
		// Allow common markdown targets; force safe link behaviour via hook above.
		ADD_ATTR: ["target", "rel"],
	});
}

/**
 * Full pipeline: markdown source → parse → sanitize → safe HTML string.
 */
export function markdownSourceToSafeHtml(source: string): string {
	return sanitizeHtml(parseMarkdownToHtml(source));
}
