/**
 * Capture PDF text-layer selections and map client rects into page-% geometry
 * for annotation factories (highlight / underline / strikethrough).
 */

export type PageRectPct = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Snapshot of a live text selection anchored to a document page. */
export type TextSelectionSnapshot = {
	text: string;
	/** 1-based page number from data-page-number */
	pageNum: number;
	/** Line-level rects in page % (top-left origin) */
	rects: PageRectPct[];
};

function clampPct(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(0, n));
}

/**
 * True when the current window selection has non-empty text
 * (PDF text layer or focused text control).
 */
export function hasNonEmptyTextSelection(): boolean {
	const el = document.activeElement;
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
		const start = el.selectionStart ?? 0;
		const end = el.selectionEnd ?? 0;
		if (end > start) return true;
	}
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
	return (sel.toString() || "").trim().length > 0;
}

/**
 * Capture selection + page-relative rects for annotation actions.
 * Returns null when there is no usable selection on a document page
 * (plain form inputs still report text via {@link getSelectedText}).
 */
export function captureTextSelectionSnapshot(): TextSelectionSnapshot | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
	const text = (sel.toString() || "").replace(/\s+/g, " ").trim();
	if (!text) return null;

	const range = sel.getRangeAt(0);
	const node = range.commonAncestorContainer;
	const el =
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	if (!el) return null;

	const pageEl = el.closest("[data-page-number]") as HTMLElement | null;
	if (!pageEl) return null;

	// Prefer selections that involve the text layer (PDF canvas text)
	const inTextLayer = !!el.closest(".textLayer");
	if (!inTextLayer) {
		// Allow selection that starts in text layer but ancestor is page shell
		const textLayer = pageEl.querySelector(".textLayer");
		if (!textLayer) return null;
		// If neither end is inside the text layer, skip
		const startEl =
			range.startContainer.nodeType === Node.ELEMENT_NODE
				? (range.startContainer as Element)
				: range.startContainer.parentElement;
		const endEl =
			range.endContainer.nodeType === Node.ELEMENT_NODE
				? (range.endContainer as Element)
				: range.endContainer.parentElement;
		if (
			!startEl?.closest(".textLayer") &&
			!endEl?.closest(".textLayer")
		) {
			return null;
		}
	}

	const pageNum = parseInt(pageEl.getAttribute("data-page-number") || "", 10);
	if (!Number.isFinite(pageNum) || pageNum < 1) return null;

	const pageBox = pageEl.getBoundingClientRect();
	if (pageBox.width < 1 || pageBox.height < 1) return null;

	const clientRects = Array.from(range.getClientRects());
	const rects: PageRectPct[] = [];
	for (const r of clientRects) {
		if (r.width < 0.5 || r.height < 0.5) continue;
		rects.push({
			x: clampPct(((r.left - pageBox.left) / pageBox.width) * 100),
			y: clampPct(((r.top - pageBox.top) / pageBox.height) * 100),
			width: clampPct((r.width / pageBox.width) * 100),
			height: clampPct((r.height / pageBox.height) * 100),
		});
	}
	if (rects.length === 0) return null;

	return { text, pageNum, rects };
}

/** Plain selected text from selection or focused control. */
export function getSelectedText(): string {
	const el = document.activeElement;
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
		const start = el.selectionStart ?? 0;
		const end = el.selectionEnd ?? 0;
		if (end > start) return el.value.slice(start, end);
	}
	return (window.getSelection()?.toString() || "").trim();
}

/** Center of the first selection rect (for comment pin placement). */
export function selectionAnchorPct(
	snap: TextSelectionSnapshot,
): { x: number; y: number } {
	const r = snap.rects[0];
	return {
		x: clampPct(r.x + r.width / 2),
		y: clampPct(r.y + r.height / 2),
	};
}
