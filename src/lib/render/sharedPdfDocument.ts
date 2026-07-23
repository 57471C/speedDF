/**
 * Single shared pdf.js document for the active workspace PDF.
 *
 * Main-page paints and sidebar thumbnails used to call getDocument() with a
 * full byte copy on every paint. On large PDFs that allocated unbounded
 * worker/document heaps even with no user interaction (viewport preload +
 * thumbnails). This module owns one PDFDocumentProxy per rawBytes identity
 * and exposes idle cleanup + hard destroy (including optional worker kill).
 *
 * Concurrency: all open/create paths are serialised on `opChain` so concurrent
 * callers (loadDocument + registerRecentFile $effect + first paint) join the
 * same in-flight loadingTask instead of aborting each other ("Loading aborted").
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
	pageNumber?: number;
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

/**
 * Serialises open + destroy so concurrent getSharedWorkspacePdf calls never
 * destroy each other's in-flight loadingTask.
 */
let opChain: Promise<unknown> = Promise.resolve();

/** Idle cleanup interval — frees unused page caches without re-parsing. */
let idleCleanupTimer: ReturnType<typeof setInterval> | null = null;
/** 30s: low CPU, enough to reclaim operator lists after thumbs settle. */
const IDLE_CLEANUP_MS = 30_000;

/**
 * Idle timer is armed only after main page paint (or mainViewGate fallback).
 * Starting it on getDocument resolve raced cold open / first paint.
 */
let idleCleanupAllowed = false;

/**
 * Temporary idle-allocation telemetry. Strip once memory graphs stay flat.
 * Prefix makes it easy to filter in DevTools / WebView2 console.
 */
const IDLE_LOG_PREFIX = "[idle-mem]";

/** Last user / paint activity timestamp (ms). Used so cleanup only runs when idle. */
let lastActivityAt = 0;

/** Monotonic counters for temporary logging. */
let stats = {
	getDocumentCalls: 0,
	getPageCalls: 0,
	pageCleanups: 0,
	docCleanups: 0,
	docCleanupFails: 0,
	idleTicks: 0,
	abortedLoads: 0,
};

function readJsHeap(): {
	usedMB: number | null;
	totalMB: number | null;
} {
	try {
		const perf = performance as Performance & {
			memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
		};
		const m = perf.memory;
		if (!m?.usedJSHeapSize) return { usedMB: null, totalMB: null };
		return {
			usedMB: Math.round((m.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
			totalMB:
				m.totalJSHeapSize != null
					? Math.round((m.totalJSHeapSize / (1024 * 1024)) * 10) / 10
					: null,
		};
	} catch {
		return { usedMB: null, totalMB: null };
	}
}

function idleLog(message: string, extra?: Record<string, unknown>): void {
	const heap = readJsHeap();
	const payload = {
		...extra,
		heapUsedMB: heap.usedMB,
		heapTotalMB: heap.totalMB,
		renderBusy: isPdfRenderBusy(),
		hasDoc: docInstance != null,
		loading: isLoadInFlight(),
		idleCleanupAllowed,
		idleMs: lastActivityAt > 0 ? Date.now() - lastActivityAt : null,
		stats: { ...stats },
	};
	console.log(`${IDLE_LOG_PREFIX} ${message}`, payload);
}

/** True while getDocument has started but PDFDocumentProxy is not ready. */
function isLoadInFlight(): boolean {
	return docPromise != null && docInstance == null;
}

/** Call from scroll / zoom / paint paths so idle cleanup knows activity. */
export function notePdfActivity(reason?: string): void {
	lastActivityAt = Date.now();
	void reason;
}

function ensureWorker() {
	if (!globalPdfWorkerInstance.current) {
		globalPdfWorkerInstance.current = new pdfjsLib.PDFWorker();
	}
	return globalPdfWorkerInstance.current;
}

function startIdleCleanup() {
	if (idleCleanupTimer != null) return;
	if (typeof window === "undefined") return;
	if (!idleCleanupAllowed) return;
	if (!docInstance) return;
	lastActivityAt = Date.now();
	idleCleanupTimer = setInterval(() => {
		void runIdleCleanup();
	}, IDLE_CLEANUP_MS);
	idleLog("idle cleanup timer started", { intervalMs: IDLE_CLEANUP_MS });
}

function stopIdleCleanup() {
	if (idleCleanupTimer == null) return;
	clearInterval(idleCleanupTimer);
	idleCleanupTimer = null;
	idleLog("idle cleanup timer stopped");
}

/**
 * Arm the 30s idle cleanup timer. Call only after the shared document is fully
 * loaded **and** the main page has painted (see mainViewGate.markMainViewReady).
 */
export function enableSharedPdfIdleCleanup(): void {
	idleCleanupAllowed = true;
	if (docInstance) {
		startIdleCleanup();
	} else {
		idleLog("idle cleanup armed (waiting for docInstance)");
	}
}

/**
 * Soft cleanup: drop unused page data / operator lists / commonObjs / fonts
 * on the shared doc. Does not destroy the document or require a re-parse.
 *
 * Never runs while getDocument is still in flight or before idle is armed.
 */
export async function runIdleCleanup(): Promise<void> {
	stats.idleTicks += 1;

	if (isLoadInFlight()) {
		idleLog("tick: skip (load in flight)");
		return;
	}

	const doc = docInstance;
	if (!doc) {
		idleLog("tick: no shared doc");
		return;
	}

	// Still painting / queued → skip (pdf.js forbids cleanup mid-render).
	if (isPdfRenderBusy()) {
		idleLog("tick: skip (render busy)");
		return;
	}

	// Require a quiet period so we do not thrash fonts during continuous use.
	const idleFor = Date.now() - (lastActivityAt || Date.now());
	if (idleFor < IDLE_CLEANUP_MS * 0.5) {
		idleLog("tick: skip (recent activity)", { idleForMs: idleFor });
		return;
	}

	const before = readJsHeap();
	try {
		// Aggressive free: fonts + common objects + page operator lists.
		// Document parse + page proxies remain; next paint rebinds fonts once.
		await doc.cleanup(false);
		// Bail if a destroy/load replaced the doc while we awaited.
		if (docInstance !== doc) {
			idleLog("tick: skip apply (doc replaced during cleanup)");
			return;
		}
		stats.docCleanups += 1;
		const after = readJsHeap();
		idleLog("cleanup(false) ok", {
			beforeMB: before.usedMB,
			afterMB: after.usedMB,
			deltaMB:
				before.usedMB != null && after.usedMB != null
					? Math.round((after.usedMB - before.usedMB) * 10) / 10
					: null,
			idleForMs: idleFor,
		});
	} catch (err) {
		if (docInstance !== doc) return;
		// A page may still be finishing; try soft keep-fonts cleanup.
		stats.docCleanupFails += 1;
		try {
			await doc.cleanup(true);
			if (docInstance !== doc) return;
			stats.docCleanups += 1;
			const after = readJsHeap();
			idleLog("cleanup(true) fallback ok", {
				beforeMB: before.usedMB,
				afterMB: after.usedMB,
				err: String((err as Error)?.message || err),
			});
		} catch (err2) {
			idleLog("cleanup failed", {
				err: String((err2 as Error)?.message || err2),
				beforeMB: before.usedMB,
			});
		}
	}
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
	// Identity check only — rawBytes is replaced as a whole on load/save.
	return a != null && a === b;
}

/**
 * Await the current in-flight promise if it matches `bytes`.
 * Returns null when there is nothing to join.
 */
async function joinExisting(
	bytes: Uint8Array,
): Promise<SharedPdfDocument | null | undefined> {
	if (!sameBytes(boundBytes, bytes) || !docPromise) return undefined;
	try {
		return await docPromise;
	} catch {
		// Failed prior load for these bytes — clear only if still the same attempt.
		if (sameBytes(boundBytes, bytes)) {
			boundBytes = null;
			docPromise = null;
			docInstance = null;
			loadingTask = null;
		}
		return undefined;
	}
}

/**
 * Create a new shared document for `bytes`. Caller must hold opChain.
 * Does **not** destroy an in-flight load for the same bytes.
 */
async function createSharedDocument(
	bytes: Uint8Array,
): Promise<SharedPdfDocument> {
	// Tear down a *different* document only. Same-bytes in-flight is joined above.
	if (
		boundBytes != null ||
		loadingTask != null ||
		docPromise != null ||
		docInstance != null
	) {
		if (!sameBytes(boundBytes, bytes)) {
			idleLog("replacing shared doc (bytes identity changed)", {
				prevBytes: boundBytes?.byteLength ?? 0,
				nextBytes: bytes.byteLength,
				wasLoading: isLoadInFlight(),
			});
			await destroySharedWorkspacePdfImpl({ destroyWorker: false });
		}
	}

	// Another waiter may have created while we destroyed.
	const joined = await joinExisting(bytes);
	if (joined !== undefined) {
		if (joined) return joined;
		// joinExisting cleared a failed load — fall through to recreate
	}

	boundBytes = bytes;
	ensureWorker();
	stats.getDocumentCalls += 1;
	notePdfActivity("getDocument");
	idleLog("getDocument (shared)", {
		byteLength: bytes.byteLength,
		getDocumentCalls: stats.getDocumentCalls,
	});

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

	const thisPromise = task.promise
		.then((doc) => {
			// Ignore late resolve if this task was superseded/destroyed.
			if (loadingTask !== task) {
				idleLog("getDocument resolve ignored (task superseded)");
				throw new Error("Loading aborted");
			}
			docInstance = doc;
			// Idle timer starts only after main paint via enableSharedPdfIdleCleanup.
			if (idleCleanupAllowed) {
				startIdleCleanup();
			}
			idleLog("getDocument resolved", {
				numPages: doc.numPages,
			});
			return doc;
		})
		.catch((err: unknown) => {
			if (loadingTask === task) {
				loadingTask = null;
				docPromise = null;
				docInstance = null;
				boundBytes = null;
			}
			const msg = String((err as Error)?.message || err);
			if (/abort/i.test(msg)) {
				stats.abortedLoads += 1;
				idleLog("getDocument aborted", { err: msg });
			}
			throw err;
		});

	docPromise = thisPromise;
	return thisPromise;
}

/**
 * Get (or create) the shared PDFDocumentProxy for these workspace bytes.
 * Concurrent callers with the same `bytes` reference share one loadingTask.
 * A new `bytes` identity replaces the previous document after the prior op settles.
 */
export async function getSharedWorkspacePdf(
	bytes: Uint8Array,
): Promise<SharedPdfDocument | null> {
	if (!bytes || bytes.byteLength === 0) return null;

	// Fast path: already bound / loading these exact bytes (no queue hop).
	const quick = await joinExisting(bytes);
	if (quick) return quick;

	const run = async (): Promise<SharedPdfDocument | null> => {
		// Re-check under the lock — concurrent caller may have finished create.
		const again = await joinExisting(bytes);
		if (again) return again;
		if (again === null) {
			// joinExisting only returns null if promise resolved null — not used
		}
		return createSharedDocument(bytes);
	};

	const result = opChain.then(run, run);
	// Keep the chain alive even when a load fails so later ops still serialise.
	opChain = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

/**
 * getPage wrapper that records activity + counters for idle telemetry.
 * Prefer this over raw pdfDocument.getPage when diagnosing idle growth.
 */
export async function getSharedPdfPage(
	doc: SharedPdfDocument,
	pageNumber: number,
): Promise<SharedPdfPage & Record<string, unknown>> {
	stats.getPageCalls += 1;
	notePdfActivity("getPage");
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const page = (await doc.getPage(pageNumber)) as any;
	return page;
}

async function destroySharedWorkspacePdfImpl(
	opts: DestroySharedPdfOptions = {},
): Promise<void> {
	stopIdleCleanup();
	idleCleanupAllowed = false;

	// Unblock queued paints so they do not hold the worker after we kill the doc.
	clearPdfRenderQueue();

	const task = loadingTask;
	const doc = docInstance;
	const wasLoading = isLoadInFlight();
	loadingTask = null;
	docPromise = null;
	docInstance = null;
	boundBytes = null;

	if (doc) {
		try {
			// Free page caches on main + worker threads first (drop fonts too).
			await doc.cleanup(false);
		} catch {
			/* ignore */
		}
	}
	// loadingTask.destroy() tears down the worker transport for this document.
	// This is what surfaces as "Loading aborted" to any waiter of task.promise —
	// only call when closing / replacing bytes, never while same-bytes joiners wait.
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
		idleLog("PDFWorker destroyed");
	}

	idleLog("shared document destroyed", {
		destroyWorker: !!opts.destroyWorker,
		wasLoading,
	});
}

/**
 * Fully destroy the shared document + loading task and stop idle cleanup.
 * Call on document close / tab switch when the active PDF is going away.
 * Serialised with getSharedWorkspacePdf so we never half-destroy a new open.
 */
export function destroySharedWorkspacePdf(
	opts: DestroySharedPdfOptions = {},
): Promise<void> {
	const run = () => destroySharedWorkspacePdfImpl(opts);
	const result = opChain.then(run, run);
	opChain = result.then(
		() => undefined,
		() => undefined,
	);
	return result.then(() => undefined);
}

/** Best-effort page cleanup after a paint (canvas pixels remain). */
export function cleanupPdfPage(page: SharedPdfPage | null | undefined): void {
	if (!page) return;
	try {
		const ok = page.cleanup();
		stats.pageCleanups += 1;
		// false means render still in flight — intentional, not an error
		if (ok === false) {
			idleLog("page.cleanup deferred (render in flight)", {
				pageNumber: page.pageNumber,
			});
		}
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

/** Test/debug helper — current idle telemetry counters. */
export function getSharedPdfIdleStats(): Readonly<typeof stats> {
	return { ...stats };
}
