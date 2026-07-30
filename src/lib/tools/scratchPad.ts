/**
 * Scratch Pad persistence helpers (session + localStorage).
 * Stores HTML from a contentEditable notepad so formatting survives restarts.
 */

export const SCRATCH_PAD_STORAGE_KEY = "speeddf_scratch_pad";

const DEFAULT_HTML = "";

/** Load HTML content for the scratch pad (empty string when unset). */
export function loadScratchPadHtml(): string {
	if (typeof localStorage === "undefined") return DEFAULT_HTML;
	try {
		const raw = localStorage.getItem(SCRATCH_PAD_STORAGE_KEY);
		return raw == null ? DEFAULT_HTML : raw;
	} catch {
		return DEFAULT_HTML;
	}
}

/** Persist HTML content (best-effort). */
export function saveScratchPadHtml(html: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(SCRATCH_PAD_STORAGE_KEY, html ?? "");
	} catch {
		/* quota / private mode */
	}
}

/** Clear stored pad content. */
export function clearScratchPadHtml(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(SCRATCH_PAD_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Strips font typefaces, font sizes, font colors, and background colors from HTML,
 * preserving semantic structure (bold, italic, underline, lists, paragraphs).
 */
export function stripFontStylesFromHtml(html: string): string {
	if (!html || !html.trim()) return html;

	if (typeof DOMParser !== "undefined") {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");

		const cleanNode = (node: Node) => {
			if (node.nodeType === 1) {
				const el = node as HTMLElement;
				const tagName = el.tagName.toLowerCase();

				el.removeAttribute("style");
				el.removeAttribute("color");
				el.removeAttribute("face");
				el.removeAttribute("size");
				el.removeAttribute("bgcolor");

				if (tagName === "font") {
					const parent = el.parentNode;
					if (parent) {
						while (el.firstChild) {
							parent.insertBefore(el.firstChild, el);
						}
						parent.removeChild(el);
						return;
					}
				}

				const children = Array.from(el.childNodes);
				for (const child of children) {
					cleanNode(child);
				}
			}
		};

		const children = Array.from(doc.body.childNodes);
		for (const child of children) {
			cleanNode(child);
		}

		return doc.body.innerHTML;
	}

	return html
		.replace(/\s*style="[^"]*"/gi, "")
		.replace(/\s*style='[^']*'/gi, "")
		.replace(/\s*color="[^"]*"/gi, "")
		.replace(/\s*face="[^"]*"/gi, "")
		.replace(/\s*size="[^"]*"/gi, "")
		.replace(/<\/?font[^>]*>/gi, "");
}

