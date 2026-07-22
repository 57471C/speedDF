/**
 * Single shared pdf.js document for the active workspace PDF.
 *
 * Main-page paints and sidebar thumbnails used to call getDocument() with a
 * full byte copy on every paint. On large PDFs that allocated unbounded
 * worker/document heaps even with no user interaction (viewport preload +
 * thumbnails). This module owns one PDFDocumentProxy per rawBytes identity
 * and exposes idle cleanup + hard destroy (including optional worker kill).
 */

import * as pdfjsLib from "pdfjs-dist";
import { globalPdfWorkerInstance } from "../../pdfStore.svelte";
import { clearPdfRenderQueue, isPdfRenderBusy } from "./pdfRenderQueue";

/** pdf.js document proxy for the active workspace PDF. */
export type SharedPdfDocument = Awaited<
	ReturnType<typeof pdfjsLib.getDocument>["promise"]
>;

/** Loose page proxy shape we clean up after paints. */
export type SharedPdfPage = {
	cleanup: (resetStats?: boolean) => boolean | void;
};

export type DestroySharedPdfOptions = {
	/**
	 * When true, also destroy the global PDFWorker so Wasm/heap can be reclaimed
	 * after the last document closes. Next open creates a fresh worker.
	 */
	destroyWorker?: boolean;
};

let boundBytes: Uint8Array | null = null;
let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
let docPromise: Promise<SharedPdfDocument> | null = null;
let docInstance: SharedPdfDocument | null = null;

/** Serialise destroy so open/close races cannot leave dual documents alive. */
let destroyChain: Promise<void> = Promise.resolve();

/** Idle cleanup interval — frees unused page caches without re-parsing. */
let idleCleanupTimer: ReturnType<typeof setInterval> | null = null;
/** 30s: low CPU, enough to reclaim operator lists after thumbs settle. */
const IDLE_CLEANUP_MS = 30_000;

function ensureWorker() {
	if (!globalPdfWorkerInstance.current) {
		globalPdfWorkerInstance.current = new pdfjsLib.PDFWorker();
	}
	return globalPdfWorkerInstance.current;
}

function startIdleCleanup() {
	if (idleCleanupTimer != null) return;
	if (typeof window === "undefined") return;
	idleCleanupTimer = setInterval(() => {
		void runIdleCleanup();
	}, IDLE_CLEANUP_MS);
}

function stopIdleCleanup() {
	if (idleCleanupTimer == null) return;
	clearInterval(idleCleanupTimer);
	idleCleanupTimer = null;
}

/**
 * Soft cleanup: drop unused page data / operator lists on the shared doc.
 * Does not destroy the document or require a re-parse.
 */
export async function runIdleCleanup(): Promise<void> {
	const doc = docInstance;
	if (!doc) return;
	// pdf.js forbids cleanup while a page.render() is in flight.
	if (isPdfRenderBusy()) return;
	try {
		// keepLoadedFonts: true — avoid re-fetching fonts on next paint
		await doc.cleanup(true);
	} catch {
		/* ignore — document may already be destroyed */
	}
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
	// Identity check only — rawBytes is replaced as a whole on load/save.
	return a != null && a === b;
}

/**
 * Get (or create) the shared PDFDocumentProxy for these workspace bytes.
 * When `bytes` is a new reference, the previous document is fully destroyed.
 */
export async function getSharedWorkspacePdf(
	bytes: Uint8Array,
): Promise<SharedPdfDocument | null> {
	if (!bytes || bytes.byteLength === 0) return null;

	// Wait for any in-flight destroy (close-then-reopen races).
	await destroyChain;

	if (sameBytes(boundBytes, bytes) && docPromise) {
		try {
			return await docPromise;
		} catch {
			// Fall through and recreate after a failed prior load.
			boundBytes = null;
			docPromise = null;
			docInstance = null;
			loadingTask = null;
		}
	}

	// Tear down any prior document before allocating a new full parse.
	await destroySharedWorkspacePdf();

	boundBytes = bytes;
	ensureWorker();

	const task = pdfjsLib.getDocument({
		// pdf.js may transfer/detach the buffer — keep a private copy once.
		data: bytes.slice(0),
		cMapUrl: `${window.location.origin}/cmaps/`,
		cMapPacked: true,
		standardFontDataUrl: `${window.location.origin}/standard_fonts/`,
		wasmUrl: `${window.location.origin}/`,
		worker: ensureWorker(),
		useSystemFonts: true,
		enableXfa: false,
	});
	loadingTask = task;

	docPromise = task.promise
		.then((doc) => {
			docInstance = doc;
			startIdleCleanup();
			return doc;
		})
		.catch((err: unknown) => {
			// Allow retry on next call
			if (loadingTask === task) {
				loadingTask = null;
				docPromise = null;
				docInstance = null;
				boundBytes = null;
			}
			throw err;
		});

	return docPromise;
}

async function destroySharedWorkspacePdfImpl(
	opts: DestroySharedPdfOptions = {},
): Promise<void> {
	stopIdleCleanup();

	// Unblock queued paints so they do not hold the worker after we kill the doc.
	clearPdfRenderQueue();

	const task = loadingTask;
	const doc = docInstance;
	loadingTask = null;
	docPromise = null;
	docInstance = null;
	boundBytes = null;

	if (doc) {
		try {
			// Free page caches on main + worker threads first.
			await doc.cleanup(false);
		} catch {
			/* ignore */
		}
	}
	// loadingTask.destroy() tears down the worker transport for this document.
	if (task) {
		try {
			await task.destroy();
		} catch {
			/* ignore */
		}
	} else if (doc) {
		try {
			await doc.loadingTask.destroy();
		} catch {
			/* ignore */
		}
	}

	// Kill the global PDFWorker so Wasm/native heaps can be reclaimed after
	// the last document closes. Open/close cycles otherwise leave a growing
	// worker heap even when PDFDocumentProxy is destroyed.
	if (opts.destroyWorker && globalPdfWorkerInstance.current) {
		try {
			globalPdfWorkerInstance.current.destroy();
		} catch {
			/* ignore */
		}
		globalPdfWorkerInstance.current = null;
	}
}

/**
 * Fully destroy the shared document + loading task and stop idle cleanup.
 * Call on document close / tab switch when the active PDF is going away.
 * Serialised so concurrent close/open cannot double-allocate.
 */
export function destroySharedWorkspacePdf(
	opts: DestroySharedPdfOptions = {},
): Promise<void> {
	destroyChain = destroyChain
		.then(() => destroySharedWorkspacePdfImpl(opts))
		.catch(() => {
			/* never reject the chain */
		});
	return destroyChain;
}

/** Best-effort page cleanup after a paint (canvas pixels remain). */
export function cleanupPdfPage(page: SharedPdfPage | null | undefined): void {
	if (!page) return;
	try {
		page.cleanup();
	} catch {
		/* ignore */
	}
}

/** True when the shared cache is bound to these exact bytes. */
export function isSharedPdfBoundTo(bytes: Uint8Array | null | undefined): boolean {
	return !!bytes && sameBytes(boundBytes, bytes);
}

/** True when a shared document is currently loaded. */
export function hasSharedWorkspacePdf(): boolean {
	return docInstance != null || docPromise != null;
}
