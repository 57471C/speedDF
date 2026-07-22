/**
 * Static sidebar/grid page thumbnails.
 *
 * Generate once (lazy) into `pageThumbnailOverrides` as JPEG data URLs, then
 * serve as `<img>` — never re-run pdf.js on zoom/scroll/tab focus.
 * Background generation waits until the main page is ready.
 * Persists to IndexedDB for instant thumbs on re-open.
 */

import * as pdfjsLib from "pdfjs-dist";
import {
	activeDoc,
	clearSessionPageThumbs,
	documentKey,
	setPageThumbnailOverride,
} from "../../pdfStore.svelte";
import { waitMainViewReady } from "./mainViewGate";
import {
	computeThumbnailScale,
	runWithPdfRenderSlot,
	thumbnailScalePlanForBytes,
	THUMBNAIL_JPEG_QUALITY,
} from "./pdfRenderQueue";
import {
	cleanupPdfPage,
	getSharedWorkspacePdf,
} from "./sharedPdfDocument";
import {
	clearLayoutMetaCache,
	clearPersistedThumbnails,
	contentKeyForBytes,
	loadPersistedThumbnails,
	persistThumbnailPage,
	pruneOrphanedPersistedThumbnails,
} from "./thumbnailPersist";

/**
 * Module state bag avoids TDZ issues under circular imports
 * (pdfStore cleanup → dynamic import this file → imports pdfStore).
 */
const thumbState = {
	/** In-flight ensure jobs keyed by workspaceId:pageNum */
	inflight: new Map<string, Promise<void>>(),
	/** Content key for the active document bytes (for IDB). */
	activeContentKey: null as string | null,
};

function workspaceKey(): string {
	return (
		activeDoc.activeDocumentId ||
		activeDoc.filePath ||
		activeDoc.fileName ||
		"doc"
	);
}

function jobKey(pageNum: number): string {
	return `${workspaceKey()}:${pageNum}`;
}

function currentContentKey(): string | null {
	if (thumbState.activeContentKey) return thumbState.activeContentKey;
	const bytes = activeDoc.rawBytes;
	if (!bytes) return null;
	thumbState.activeContentKey = contentKeyForBytes(bytes);
	return thumbState.activeContentKey;
}

/** Call when a new document is bound so IDB keys match. */
export function setThumbnailContentKeyFromBytes(bytes: Uint8Array | null): void {
	thumbState.activeContentKey = bytes ? contentKeyForBytes(bytes) : null;
}

/**
 * Hydrate in-memory overrides from IndexedDB (if path + content match).
 * Returns true when at least one page was restored.
 */
export async function hydrateThumbnailsFromDisk(
	filePath: string | null | undefined,
	bytes: Uint8Array | null | undefined,
): Promise<boolean> {
	if (!filePath || !bytes || bytes.byteLength === 0) return false;
	const key = contentKeyForBytes(bytes);
	thumbState.activeContentKey = key;
	const pages = await loadPersistedThumbnails(filePath, key);
	if (!pages) return false;

	// Only apply if this document is still active
	if (activeDoc.filePath !== filePath && activeDoc.fileName !== filePath) {
		// path may be fileName for some loads
		if (activeDoc.filePath && activeDoc.filePath !== filePath) return false;
	}

	const merged: Record<number, string> = {
		...(activeDoc.pageThumbnailOverrides || {}),
		...pages,
	};
	// Assign via facade setter so openDocuments consumers re-read
	activeDoc.pageThumbnailOverrides = merged;
	console.log(
		`⚡ Hydrated ${Object.keys(pages).length} sidebar thumbnails from disk cache`,
	);
	return true;
}

/**
 * Render one PDF page to a small JPEG data URL (offscreen canvas).
 * Uses the shared workspace PDFDocumentProxy + low-priority paint slot.
 */
export async function generatePageThumbnailDataUrl(
	pageNum: number,
): Promise<string | null> {
	if (activeDoc.fileType === "image") return null;

	// TIFF: encode from decoded PNG page buffer
	if (activeDoc.fileType === "tiff") {
		const pageData = activeDoc.tiffPages[pageNum - 1];
		if (!pageData) return null;
		const result = await runWithPdfRenderSlot("low", async () => {
			const blob = new Blob([pageData as BlobPart], { type: "image/png" });
			const url = URL.createObjectURL(blob);
			try {
				const img = await loadImage(url);
				const rotation = activeDoc.rotations[pageNum] ?? 0;
				return paintImageToJpeg(img, rotation);
			} finally {
				URL.revokeObjectURL(url);
			}
		});
		return result;
	}

	const bytes = activeDoc.rawBytes;
	if (!bytes || activeDoc.fileType !== "pdf") return null;

	const result = await runWithPdfRenderSlot(
		"low",
		async () => {
			// Re-read bytes after waiting for a slot (doc may have closed).
			const liveBytes = activeDoc.rawBytes;
			if (!liveBytes || activeDoc.fileType !== "pdf") return null;

			const pdfDocument = await getSharedWorkspacePdf(liveBytes);
			if (!pdfDocument) return null;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let page: any = null;
			try {
				page = await pdfDocument.getPage(pageNum);
				const plan = thumbnailScalePlanForBytes(liveBytes.byteLength);
				const sessionRot = activeDoc.rotations[pageNum] ?? 0;
				const currentRotation = (page.rotate + sessionRot) % 360;
				const unrotated = page.getViewport({ scale: 1 });
				const isVertical = currentRotation % 180 === 0;
				const renderWidth = isVertical
					? unrotated.width
					: unrotated.height;
				const scale = computeThumbnailScale(
					renderWidth,
					plan.maxEdgePx,
					plan.maxScale,
				);
				const viewport = page.getViewport({
					scale,
					rotation: currentRotation,
				});

				// Canvas must match viewport exactly — mismatched sizes can yield blank paints.
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.ceil(viewport.width));
				canvas.height = Math.max(1, Math.ceil(viewport.height));

				const ctx = canvas.getContext("2d", { alpha: false });
				if (!ctx) return null;
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				const renderTask = page.render({
					canvas,
					viewport,
					annotationMode: pdfjsLib.AnnotationMode?.DISABLE ?? 0,
					intent: "display",
					background: "#ffffff",
				});
				void ctx;
				try {
					await renderTask.promise;
				} catch (err: unknown) {
					const name =
						err && typeof err === "object" && "name" in err
							? (err as { name?: string }).name
							: "";
					if (name === "RenderingCancelledException") return null;
					throw err;
				}

				return canvas.toDataURL("image/jpeg", THUMBNAIL_JPEG_QUALITY);
			} finally {
				cleanupPdfPage(page);
			}
		},
		() => !activeDoc.rawBytes || activeDoc.fileType !== "pdf",
	);

	return result;
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = (e) => reject(e);
		img.src = src;
	});
}

function paintImageToJpeg(
	img: HTMLImageElement,
	rotation: number,
): string | null {
	const is90 = rotation === 90 || rotation === 270;
	const srcW = img.naturalWidth || img.width;
	const srcH = img.naturalHeight || img.height;
	const plan = thumbnailScalePlanForBytes(
		activeDoc.rawBytes?.byteLength ?? srcW * srcH,
	);
	const edge = plan.maxEdgePx;
	const scale = Math.min(edge / Math.max(1, srcW), edge / Math.max(1, srcH), 1);
	const drawW = Math.max(1, Math.round(srcW * scale));
	const drawH = Math.max(1, Math.round(srcH * scale));

	const canvas = document.createElement("canvas");
	if (is90) {
		canvas.width = drawH;
		canvas.height = drawW;
	} else {
		canvas.width = drawW;
		canvas.height = drawH;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate((rotation * Math.PI) / 180);
	ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
	return canvas.toDataURL("image/jpeg", THUMBNAIL_JPEG_QUALITY);
}

/**
 * Ensure `pageThumbnailOverrides[pageNum-1]` exists.
 * Waits for main page readiness before generating (not before reading memory/IDB).
 */
export async function ensurePageThumbnail(
	pageNum: number,
	opts?: { force?: boolean; skipMainWait?: boolean },
): Promise<void> {
	if (pageNum < 1) return;
	if (activeDoc.fileType === "image") return;

	const overrides = activeDoc.pageThumbnailOverrides || {};
	const idx = pageNum - 1;
	if (!opts?.force && overrides[idx]) return;

	// Document closed mid-flight
	if (!activeDoc.rawBytes && activeDoc.fileType !== "tiff") return;

	// Let the main page win the render queue first
	if (!opts?.skipMainWait) {
		await waitMainViewReady();
	}

	// Re-check after wait (hydrate may have filled the slot)
	if (!opts?.force && (activeDoc.pageThumbnailOverrides || {})[idx]) return;
	if (!activeDoc.rawBytes && activeDoc.fileType !== "tiff") return;

	const key = jobKey(pageNum);
	const existing = thumbState.inflight.get(key);
	if (existing) {
		await existing;
		if ((activeDoc.pageThumbnailOverrides || {})[idx]) return;
	}

	const job = (async () => {
		try {
			const dataUrl = await generatePageThumbnailDataUrl(pageNum);
			if (!dataUrl) return;
			if (
				activeDoc.fileType !== "pdf" &&
				activeDoc.fileType !== "tiff"
			) {
				return;
			}
			setPageThumbnailOverride(idx, dataUrl);
			// Persist for next open (path-keyed)
			const ckey = currentContentKey();
			if (ckey && activeDoc.filePath) {
				void persistThumbnailPage(
					activeDoc.filePath,
					ckey,
					idx,
					dataUrl,
				);
			}
		} catch (err) {
			console.warn(`Thumbnail cache generate failed for page ${pageNum}:`, err);
		}
	})().finally(() => {
		if (thumbState.inflight.get(key) === job) thumbState.inflight.delete(key);
	});

	thumbState.inflight.set(key, job);
	await job;
}

/**
 * Ensure every page in the current pageOrder has a cached JPEG (idempotent).
 * Thumbs wait for main view; generation is low-priority in the paint queue.
 */
export function ensureAllPageThumbnails(): void {
	if (activeDoc.fileType === "image") return;
	if (!activeDoc.rawBytes && activeDoc.fileType !== "tiff") return;
	const order = activeDoc.pageOrder || [];
	const overrides = activeDoc.pageThumbnailOverrides || {};
	// Prefer current page first so the sidebar highlight fills early after main paint
	const current = activeDoc.currentPage || 1;
	const ordered = [
		current,
		...order.filter((p) => p !== current),
	];
	for (const pageNum of ordered) {
		if (pageNum < 1) continue;
		if (!overrides[pageNum - 1]) {
			void ensurePageThumbnail(pageNum);
		}
	}
}

/** Drop cached JPEG for a page and regenerate once (also refreshes IDB). */
export function invalidatePageThumbnail(pageNum: number): void {
	if (pageNum < 1) return;
	const overrides = { ...(activeDoc.pageThumbnailOverrides || {}) };
	delete overrides[pageNum - 1];
	activeDoc.pageThumbnailOverrides = overrides;
	void ensurePageThumbnail(pageNum, { force: true, skipMainWait: true });
}

/** Clear in-flight map for tests / document teardown. */
export function clearThumbnailInflight(): void {
	try {
		thumbState.inflight.clear();
		thumbState.activeContentKey = null;
	} catch {
		/* module may still be initialising under circular import */
	}
}

/**
 * Drop all caches for a recent document path (IDB page thumbs + layout meta).
 * Also clears in-memory overrides if that file is currently open.
 * Fire-and-forget safe — never throws to the UI.
 */
export async function removeDocumentThumbnailCaches(
	filePath: string | null | undefined,
): Promise<void> {
	if (!filePath) return;
	try {
		await clearPersistedThumbnails(filePath);
		clearLayoutMetaCache(filePath);

		// If open: clear session + doc overrides (no openDocuments reassignment)
		const lower = filePath.toLowerCase();
		for (const doc of activeDoc.openDocuments || []) {
			const p = doc.filePath;
			if (!p) continue;
			if (p === filePath || p.toLowerCase() === lower) {
				doc.pageThumbnailOverrides = {};
				clearSessionPageThumbs(documentKey(doc));
			}
		}
	} catch (err) {
		console.warn("removeDocumentThumbnailCaches failed:", err);
	}
}

/**
 * Background: remove IDB thumbs for paths not present in the recents list.
 * Also drops layout meta keys for those orphans when possible.
 */
export function scheduleOrphanThumbnailCleanup(
	recentPaths: string[],
): void {
	const run = () => {
		void pruneOrphanedPersistedThumbnails(recentPaths)
			.then(async (n) => {
				if (n > 0) {
					console.log(`⚡ Pruned ${n} orphaned thumbnail cache entries`);
				}
				// Best-effort: scan known layout meta is expensive; only clean
				// when we discover orphan paths from IDB (already deleted rows).
				// Layout meta for removed recents is cleared in removeDocumentThumbnailCaches.
			})
			.catch(() => {
				/* ignore */
			});
	};
	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(() => run(), { timeout: 4000 });
	} else {
		setTimeout(run, 0);
	}
}
