/**
 * Global pdf.js render concurrency gate.
 *
 * ICC/qcms Wasm modules allocate per active render; unrestricted concurrent
 * main-page + thumbnail paints exhaust Wasm memory. This queue caps how many
 * page.render() / paint jobs run at once and prefers main-view (high) work
 * over background thumbnails (low).
 *
 * Pair with `sharedPdfDocument.ts`: one PDFDocumentProxy per workspace bytes,
 * never getDocument() per page paint (that was the large-PDF idle leak).
 */

export type PdfRenderPriority = "high" | "low";

/** Max simultaneous pdf.js paint slots (main + thumbs combined). */
export const PDF_RENDER_MAX_CONCURRENT = 2;

/**
 * While false, only high-priority (main page) jobs run.
 * Set true after the first main page paint so open stays snappy.
 */
let lowPriorityAllowed = false;

type QueueEntry = {
	priority: PdfRenderPriority;
	/** FIFO within the same priority. */
	seq: number;
	run: () => void;
};

let activeCount = 0;
let seqCounter = 0;
const waitQueue: QueueEntry[] = [];

/** True when any paint slot is held (main or thumbnail). */
export function isPdfRenderBusy(): boolean {
	return activeCount > 0 || waitQueue.length > 0;
}

/** Gate background thumbnail paints until the main page is visible. */
export function setLowPriorityAllowed(allowed: boolean): void {
	lowPriorityAllowed = allowed;
	if (allowed) pump();
}

export function isLowPriorityAllowed(): boolean {
	return lowPriorityAllowed;
}

/**
 * Unblock every waiter that has not yet received a slot.
 * Balances `activeCount` so each waiter's `finally` still decrements safely.
 * Call on document close so orphaned paints do not keep the worker busy.
 */
export function clearPdfRenderQueue(): void {
	while (waitQueue.length > 0) {
		const entry = waitQueue.shift();
		if (!entry) break;
		// Grant the slot so the awaiter proceeds; isCancelled / destroyed doc
		// will short-circuit fn, and finally will release the count.
		activeCount += 1;
		entry.run();
	}
	// After close, keep low priority blocked until next main paint
	lowPriorityAllowed = false;
}

function pump(): void {
	while (activeCount < PDF_RENDER_MAX_CONCURRENT && waitQueue.length > 0) {
		// Prefer high-priority (main page) jobs over thumbnail work.
		let idx = waitQueue.findIndex((e) => e.priority === "high");
		if (idx < 0) {
			// Hold low-priority (thumbs) until main view has painted once.
			if (!lowPriorityAllowed) break;
			idx = 0;
		}
		const entry = waitQueue.splice(idx, 1)[0];
		activeCount += 1;
		entry.run();
	}
}

/**
 * Run `fn` inside a limited concurrency slot.
 * Returns `null` if `isCancelled()` is true before the slot is granted or before `fn` runs.
 */
export async function runWithPdfRenderSlot<T>(
	priority: PdfRenderPriority,
	fn: () => Promise<T>,
	isCancelled?: () => boolean,
): Promise<T | null> {
	if (isCancelled?.()) return null;

	await new Promise<void>((resolve) => {
		const entry: QueueEntry = {
			priority,
			seq: ++seqCounter,
			run: () => resolve(),
		};
		waitQueue.push(entry);
		// Stable order for same priority
		waitQueue.sort((a, b) => {
			if (a.priority !== b.priority) {
				return a.priority === "high" ? -1 : 1;
			}
			return a.seq - b.seq;
		});
		pump();
	});

	try {
		if (isCancelled?.()) return null;
		return await fn();
	} finally {
		activeCount = Math.max(0, activeCount - 1);
		pump();
	}
}

/**
 * Debounce rapid re-entrancy (zoom scroll, rotation spam, version bumps).
 * Leading edge is delayed; only the latest call runs.
 */
export function debounceLeadingLatest(
	fn: () => void,
	ms: number,
): { schedule: () => void; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	return {
		schedule() {
			const gen = ++generation;
			if (timer != null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				if (gen === generation) fn();
			}, ms);
		},
		cancel() {
			generation += 1;
			if (timer != null) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}

/** Shared thumbnail paint knobs — keep Wasm/canvas small (esp. ICC-heavy PDFs). */
export const THUMBNAIL_MAX_EDGE_PX = 84;
export const THUMBNAIL_MAX_SCALE = 0.18;
/** Even smaller caps when source PDF is large (byte length). */
export const THUMBNAIL_LARGE_DOC_BYTES = 8 * 1024 * 1024; // 8 MB
export const THUMBNAIL_LARGE_MAX_EDGE_PX = 64;
export const THUMBNAIL_LARGE_MAX_SCALE = 0.12;
export const THUMBNAIL_RETRY_MAX_SCALE = 0.08;
export const THUMBNAIL_RETRY_MAX_EDGE_PX = 48;
export const THUMBNAIL_JPEG_QUALITY = 0.4;
export const THUMBNAIL_DEBOUNCE_MS = 150;

/**
 * Higher-quality page-1 render for Recent Documents cards (after the full
 * low-res background fill completes). Larger edge / scale / JPEG quality.
 */
export const RECENT_THUMB_MAX_EDGE_PX = 280;
export const RECENT_THUMB_MAX_SCALE = 0.55;
export const RECENT_THUMB_JPEG_QUALITY = 0.82;

export type ThumbnailScalePlan = {
	maxEdgePx: number;
	maxScale: number;
	/** Second attempt after a failed render (even smaller). */
	retryMaxEdgePx: number;
	retryMaxScale: number;
};

/**
 * Pick conservative thumbnail limits from document size so ICC/Wasm paints
 * stay within memory on multi-page colour PDFs.
 */
export function thumbnailScalePlanForBytes(
	byteLength: number | null | undefined,
): ThumbnailScalePlan {
	const large =
		typeof byteLength === "number" && byteLength >= THUMBNAIL_LARGE_DOC_BYTES;
	return {
		maxEdgePx: large ? THUMBNAIL_LARGE_MAX_EDGE_PX : THUMBNAIL_MAX_EDGE_PX,
		maxScale: large ? THUMBNAIL_LARGE_MAX_SCALE : THUMBNAIL_MAX_SCALE,
		retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
		retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
	};
}

/** Compute viewport scale for a page width/height in PDF units. */
export function computeThumbnailScale(
	pageWidthPts: number,
	maxEdgePx: number,
	maxScale: number,
): number {
	const raw = maxEdgePx / Math.max(0.1, Math.abs(pageWidthPts));
	return Math.min(maxScale, Math.max(0.05, raw));
}
