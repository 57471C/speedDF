/**
 * Line-map scroll sync for markdown split view (editor ↔ preview).
 * Preview blocks carry data-md-line. Panes align through that map, not
 * scrollTop/maxScroll, so a tall image or fence cannot drag the other pane.
 */

/** Fallback when the textarea's computed line-height is not a px length. Matches the editor CSS. */
export const MARKDOWN_EDITOR_LINE_HEIGHT_PX = 20;

export type MarkdownScrollable = {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
};

/** Ignore apply when already within this many CSS px (kills echo jitter). */
export const SCROLL_SYNC_EPSILON_PX = 1;

/** Skip preview → editor while the user typed within this window. */
export const SCROLL_SYNC_TYPING_GUARD_MS = 400;

export function maxScroll(el: MarkdownScrollable): number {
	return Math.max(0, el.scrollHeight - el.clientHeight);
}

/** 0 at top, 1 at bottom. No overflow → 0. */
export function scrollRatio(el: MarkdownScrollable): number {
	const max = maxScroll(el);
	if (max <= 0) return 0;
	const r = el.scrollTop / max;
	if (r <= 0) return 0;
	if (r >= 1) return 1;
	return r;
}

/**
 * Set scrollTop from a 0..1 ratio. Returns true if the value changed
 * enough to be worth writing (and therefore emitting a scroll event).
 */
export function applyScrollRatio(
	el: MarkdownScrollable,
	ratio: number,
	epsilonPx = SCROLL_SYNC_EPSILON_PX,
): boolean {
	const max = maxScroll(el);
	const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
	const next = r * max;
	if (Math.abs(el.scrollTop - next) < epsilonPx) return false;
	el.scrollTop = next;
	return true;
}

export function shouldSkipPreviewToEditor(
	lastTypedAt: number,
	now: number,
	guardMs = SCROLL_SYNC_TYPING_GUARD_MS,
): boolean {
	return now - lastTypedAt < guardMs;
}

/** Clamp a saved scrollTop to the element's current max (after a re-layout). */
export function clampRestoredScrollTop(
	el: MarkdownScrollable,
	savedTop: number,
): number {
	const max = maxScroll(el);
	if (savedTop <= 0 || max <= 0) return 0;
	if (savedTop >= max) return max;
	return savedTop;
}

/**
 * Write scrollTop back after a content patch. Returns the value applied.
 * Call after layout (tick + rAF); the scroller element must be the same node.
 */
export function restoreScrollTop(
	el: MarkdownScrollable,
	savedTop: number,
): number {
	const next = clampRestoredScrollTop(el, savedTop);
	el.scrollTop = next;
	return next;
}

/** One preview block: source line and its top inside the preview scroll content. */
export type LineAnchor = {
	line: number;
	top: number;
};

/**
 * Drop duplicate lines (keep the topmost) and any later anchor that sits
 * above the previous one, so interpolation never runs backwards.
 */
export function collapseLineAnchors(anchors: readonly LineAnchor[]): LineAnchor[] {
	const sorted = [...anchors].sort((a, b) => a.line - b.line || a.top - b.top);
	const out: LineAnchor[] = [];
	for (const anchor of sorted) {
		if (!Number.isFinite(anchor.line) || anchor.line < 1) continue;
		if (!Number.isFinite(anchor.top)) continue;
		const prev = out[out.length - 1];
		if (prev && prev.line === anchor.line) continue;
		if (prev && anchor.top < prev.top) continue;
		out.push({ line: anchor.line, top: anchor.top });
	}
	return out;
}

/**
 * Content Y in the preview for a source line.
 * Between two anchors the position is the fraction of the source-line span,
 * not a fraction of either pane's scroll height.
 */
export function previewOffsetForLine(
	anchors: readonly LineAnchor[],
	line: number,
): number | null {
	const map = collapseLineAnchors(anchors);
	if (map.length === 0 || !Number.isFinite(line)) return null;
	const first = map[0];
	if (line <= first.line) return first.top;
	let prev = first;
	for (let i = 1; i < map.length; i++) {
		const next = map[i];
		if (line < next.line) {
			const span = next.line - prev.line;
			if (span <= 0) return prev.top;
			const t = (line - prev.line) / span;
			return prev.top + t * (next.top - prev.top);
		}
		if (line === next.line) return next.top;
		prev = next;
	}
	return prev.top;
}

/**
 * Source line (possibly fractional) at a preview content Y.
 * Past the last anchor stays on that line — no scroll-height ratio.
 */
export function sourceLineForContentY(
	anchors: readonly LineAnchor[],
	y: number,
): number | null {
	const map = collapseLineAnchors(anchors);
	if (map.length === 0 || !Number.isFinite(y)) return null;
	const first = map[0];
	if (y <= first.top) return first.line;
	let prev = first;
	for (let i = 1; i < map.length; i++) {
		const next = map[i];
		if (y < next.top) {
			const span = next.top - prev.top;
			if (span <= 0) return prev.line;
			const t = (y - prev.top) / span;
			return prev.line + t * (next.line - prev.line);
		}
		if (y === next.top) return next.line;
		prev = next;
	}
	return prev.line;
}

/** 1-based source line at the editor viewport top. Fractional within a line. */
export function sourceLineAtScrollTop(scrollTop: number, lineHeight: number): number {
	const lh = lineHeight > 0 ? lineHeight : MARKDOWN_EDITOR_LINE_HEIGHT_PX;
	const y = scrollTop > 0 ? scrollTop : 0;
	return y / lh + 1;
}

/** 1-based line containing a caret offset in the source string. */
export function sourceLineAtOffset(text: string, offset: number): number {
	const end = Math.max(0, Math.min(offset, text.length));
	let line = 1;
	for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

/** Editor scrollTop that puts `line` at the viewport top, clamped to maxScroll. */
export function scrollTopForSourceLine(
	line: number,
	lineHeight: number,
	max: number,
): number {
	const lh = lineHeight > 0 ? lineHeight : MARKDOWN_EDITOR_LINE_HEIGHT_PX;
	const top = (Math.max(1, line) - 1) * lh;
	if (top <= 0 || max <= 0) return 0;
	if (top >= max) return max;
	return top;
}

/**
 * Read data-md-line blocks. `top` is in the scroller's content coordinates
 * (viewport delta + scrollTop), so CSS zoom on the preview child stays consistent.
 */
export function readLineAnchors(scrollParent: HTMLElement): LineAnchor[] {
	const origin = scrollParent.getBoundingClientRect().top;
	const scrollTop = scrollParent.scrollTop;
	const anchors: LineAnchor[] = [];
	scrollParent.querySelectorAll<HTMLElement>("[data-md-line]").forEach((node) => {
		const line = Number(node.getAttribute("data-md-line"));
		if (!Number.isFinite(line) || line < 1) return;
		const top = node.getBoundingClientRect().top - origin + scrollTop;
		anchors.push({ line, top });
	});
	return collapseLineAnchors(anchors);
}

export type MarkdownScrollSync = {
	onEditorScroll: () => void;
	onPreviewScroll: () => void;
	noteTyping: () => void;
	/** Block sync while preview HTML is patched and scrollTop is restored. */
	hold: () => void;
	/** Release after restore (two rAF so the restore echo is ignored). */
	release: () => void;
	/**
	 * One editor → preview realign from the line map (after an image load).
	 * If sync is held or an apply is in flight, it runs once when the lock lifts.
	 */
	realign: () => void;
	dispose: () => void;
	/** Test / debug: true while a programmatic apply is in flight. */
	readonly isApplying: boolean;
};

/**
 * Coalesces scroll events to one rAF apply and ignores the echo from the
 * destination pane. Preview → editor is suppressed while the user is typing
 * so we do not yank the caret; editor → preview still runs.
 */
export function createMarkdownScrollSync(opts: {
	getEditor: () => MarkdownScrollable | null;
	getPreview: () => MarkdownScrollable | null;
	/** Source line at the editor viewport top (fractional). */
	getViewportLine?: () => number | null;
	/** Caret line. Used instead of the viewport top while the typing guard is active. */
	getCaretLine?: () => number | null;
	getPreviewAnchors?: () => readonly LineAnchor[];
	getEditorLineHeight?: () => number;
	now?: () => number;
	typingGuardMs?: number;
	raf?: (cb: FrameRequestCallback) => number;
	caf?: (id: number) => void;
}): MarkdownScrollSync {
	const nowFn = opts.now ?? Date.now;
	const guard = opts.typingGuardMs ?? SCROLL_SYNC_TYPING_GUARD_MS;
	const raf = opts.raf ?? requestAnimationFrame;
	const caf = opts.caf ?? cancelAnimationFrame;

	let applying = false;
	let lastTypedAt = 0;
	let applyRaf = 0;
	let unlockRaf = 0;
	let pending: "editor" | "preview" | null = null;
	let realignPending = false;

	function lineHeight(): number {
		const lh = opts.getEditorLineHeight?.() ?? MARKDOWN_EDITOR_LINE_HEIGHT_PX;
		return lh > 0 ? lh : MARKDOWN_EDITOR_LINE_HEIGHT_PX;
	}

	function anchors(): LineAnchor[] {
		return collapseLineAnchors(opts.getPreviewAnchors?.() ?? []);
	}

	function writeScrollTop(el: MarkdownScrollable, next: number): void {
		const max = maxScroll(el);
		const clamped = next <= 0 || max <= 0 ? 0 : next >= max ? max : next;
		if (Math.abs(el.scrollTop - clamped) < SCROLL_SYNC_EPSILON_PX) return;
		el.scrollTop = clamped;
	}

	function lockEcho() {
		applying = true;
		if (unlockRaf) caf(unlockRaf);
		unlockRaf = raf(() => {
			unlockRaf = raf(unlock);
		});
	}

	function unlock() {
		unlockRaf = 0;
		applying = false;
		if (realignPending) {
			realignPending = false;
			schedule("editor");
		}
	}

	function applyFrom(source: "editor" | "preview") {
		const editor = opts.getEditor();
		const preview = opts.getPreview();
		if (!editor || !preview) return;

		const typing = shouldSkipPreviewToEditor(lastTypedAt, nowFn(), guard);
		if (source === "preview" && typing) return;

		const map = anchors();
		if (map.length === 0) return;

		if (source === "editor") {
			const caret = typing ? (opts.getCaretLine?.() ?? null) : null;
			const line = caret ?? opts.getViewportLine?.() ?? null;
			if (line == null) return;
			const y = previewOffsetForLine(map, line);
			if (y == null) return;
			lockEcho();
			writeScrollTop(preview, y);
			return;
		}

		const line = sourceLineForContentY(map, preview.scrollTop);
		if (line == null) return;
		lockEcho();
		writeScrollTop(editor, scrollTopForSourceLine(line, lineHeight(), maxScroll(editor)));
	}

	function schedule(source: "editor" | "preview") {
		if (applying) return;
		pending = source;
		if (applyRaf) return;
		applyRaf = raf(() => {
			applyRaf = 0;
			const src = pending;
			pending = null;
			if (src) applyFrom(src);
		});
	}

	return {
		onEditorScroll() {
			schedule("editor");
		},
		onPreviewScroll() {
			schedule("preview");
		},
		noteTyping() {
			lastTypedAt = nowFn();
		},
		hold() {
			applying = true;
			pending = null;
			realignPending = false;
			if (applyRaf) {
				caf(applyRaf);
				applyRaf = 0;
			}
			if (unlockRaf) {
				caf(unlockRaf);
				unlockRaf = 0;
			}
		},
		realign() {
			if (applying) {
				realignPending = true;
				return;
			}
			schedule("editor");
		},
		release() {
			if (unlockRaf) caf(unlockRaf);
			unlockRaf = raf(() => {
				unlockRaf = raf(unlock);
			});
		},
		dispose() {
			if (applyRaf) caf(applyRaf);
			if (unlockRaf) caf(unlockRaf);
			applyRaf = 0;
			unlockRaf = 0;
			pending = null;
			realignPending = false;
			applying = false;
		},
		get isApplying() {
			return applying;
		},
	};
}
