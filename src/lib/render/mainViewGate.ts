/**
 * Gates background work (thumbnails) until the main page has painted once.
 * Speeds open of large PDFs by keeping the render queue free for page 1.
 */

import { setLowPriorityAllowed } from "./pdfRenderQueue";
import { enableSharedPdfIdleCleanup } from "./sharedPdfDocument";
import {
	startBackgroundThumbnailGeneration,
	stopBackgroundThumbnailGeneration,
} from "./thumbnailCache";

let mainReady = false;
let readyWaiters: Array<() => void> = [];
/** Fallback so thumbs still start if paint is slow/failed. */
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
const FALLBACK_MS = 2500;

/**
 * Call when a document starts loading / switches so thumbs wait again.
 */
export function resetMainViewReady(): void {
	mainReady = false;
	readyWaiters = [];
	if (fallbackTimer != null) {
		clearTimeout(fallbackTimer);
		fallbackTimer = null;
	}
	// Stop any previous document's background thumbnail fill immediately
	stopBackgroundThumbnailGeneration();
	// Always unlock eventually so sidebar is never stuck empty
	fallbackTimer = setTimeout(() => {
		fallbackTimer = null;
		markMainViewReady();
	}, FALLBACK_MS);
}

/**
 * Signal that the primary workspace page is on-screen (or fallback fired).
 * Idempotent — safe to call after every main paint.
 */
export function markMainViewReady(): void {
	if (mainReady) return;
	mainReady = true;
	if (fallbackTimer != null) {
		clearTimeout(fallbackTimer);
		fallbackTimer = null;
	}
	const waiters = readyWaiters;
	readyWaiters = [];
	for (const w of waiters) {
		try {
			w();
		} catch {
			/* ignore */
		}
	}
	// Notify render queue that low-priority work may proceed
	setLowPriorityAllowed(true);
	// Arm shared-doc idle cleanup only after first main paint (or fallback).
	// Starting the timer on getDocument resolve aborted large cold opens.
	enableSharedPdfIdleCleanup();
	// Low-priority sequential fill for every uncached sidebar thumbnail.
	startBackgroundThumbnailGeneration();
}

export function isMainViewReady(): boolean {
	return mainReady;
}

/** Resolve when main page is ready (or fallback). */
export function waitMainViewReady(): Promise<void> {
	if (mainReady) return Promise.resolve();
	return new Promise<void>((resolve) => {
		readyWaiters.push(resolve);
	});
}
