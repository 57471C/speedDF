/**
 * Global pdf.js render concurrency gate.
 *
 * ICC/qcms Wasm modules allocate per active render; unrestricted concurrent
 * main-page + thumbnail paints exhaust Wasm memory. This queue caps how many
 * page.render() / paint jobs run at once and prefers main-view (high) work
 * over background thumbnails (low).
 */

export type PdfRenderPriority = "high" | "low";

/** Max simultaneous pdf.js paint slots (main + thumbs combined). */
export const PDF_RENDER_MAX_CONCURRENT = 2;

type QueueEntry = {
	priority: PdfRenderPriority;
	/** FIFO within the same priority. */
	seq: number;
	run: () => void;
};

let activeCount = 0;
let seqCounter = 0;
const waitQueue: QueueEntry[] = [];

function pump(): void {
	while (activeCount < PDF_RENDER_MAX_CONCURRENT && waitQueue.length > 0) {
		// Prefer high-priority (main page) jobs over thumbnail work.
		let idx = waitQueue.findIndex((e) => e.priority === "high");
		if (idx < 0) idx = 0;
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

/** Shared thumbnail paint knobs — keep Wasm/canvas small. */
export const THUMBNAIL_MAX_EDGE_PX = 96;
export const THUMBNAIL_MAX_SCALE = 0.22;
export const THUMBNAIL_JPEG_QUALITY = 0.4;
export const THUMBNAIL_DEBOUNCE_MS = 120;
