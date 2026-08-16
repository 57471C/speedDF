/**
 * Relative-position scroll sync for markdown split view (editor ↔ preview).
 * v1 maps scrollTop / maxScroll; heading-anchor matching is out of scope.
 */

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

export type MarkdownScrollSync = {
	onEditorScroll: () => void;
	onPreviewScroll: () => void;
	noteTyping: () => void;
	/** Block sync while preview HTML is patched and scrollTop is restored. */
	hold: () => void;
	/** Release after restore (two rAF so the restore echo is ignored). */
	release: () => void;
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

	function unlock() {
		unlockRaf = 0;
		applying = false;
	}

	function applyFrom(source: "editor" | "preview") {
		const editor = opts.getEditor();
		const preview = opts.getPreview();
		if (!editor || !preview) return;

		if (source === "preview" && shouldSkipPreviewToEditor(lastTypedAt, nowFn(), guard)) {
			return;
		}

		const from = source === "editor" ? editor : preview;
		const to = source === "editor" ? preview : editor;
		const ratio = scrollRatio(from);

		applying = true;
		applyScrollRatio(to, ratio);
		// Two frames so the destination's scroll event is ignored even if
		// the browser delivers it asynchronously after layout.
		if (unlockRaf) caf(unlockRaf);
		unlockRaf = raf(() => {
			unlockRaf = raf(unlock);
		});
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
			if (applyRaf) {
				caf(applyRaf);
				applyRaf = 0;
			}
			if (unlockRaf) {
				caf(unlockRaf);
				unlockRaf = 0;
			}
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
			applying = false;
		},
		get isApplying() {
			return applying;
		},
	};
}
