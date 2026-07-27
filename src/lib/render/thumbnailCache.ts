/**
 * Static sidebar/grid page thumbnails.
 *
 * Generate once (lazy) into `pageThumbnailOverrides` as JPEG data URLs, then
 * serve as `<img>` — never re-run pdf.js on zoom/scroll/tab focus.
 * After the main page paints, a low-priority background job fills every
 * uncached page one-at-a-time (visible cards can still jump the queue via
 * IntersectionObserver / ensurePageThumbnail).
 * Persists to IndexedDB for instant thumbs on re-open.
 */

import * as pdfjsLib from "pdfjs-dist";
import {
	activeDoc,
	applyLiveThumbnail,
	clearSessionPageThumbs,
	documentKey,
	setPageThumbnailOverride,
} from "../../pdfStore.svelte";
import { waitMainViewReady } from "./mainViewGate";
import {
	computeThumbnailScale,
	type PdfRenderPriority,
	RECENT_THUMB_JPEG_QUALITY,
	RECENT_THUMB_MAX_EDGE_PX,
	RECENT_THUMB_MAX_SCALE,
	runWithPdfRenderSlot,
	setLowPriorityAllowed,
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
	/**
	 * Bumped on document close/switch to cancel the background fill loop.
	 * Each startBackgroundThumbnailGeneration captures the generation at kickoff.
	 */
	bgGeneration: 0,
	/** True while a background fill loop is scheduled or running. */
	bgRunning: false,
	/** Workspace id the running bg job was started for. */
	bgWorkspaceId: null as string | null,
};

/** Yield between thumbs so main paints / idle cleanup can run. */
function yieldToMain(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestIdleCallback === "function") {
			requestIdleCallback(() => resolve(), { timeout: 120 });
		} else {
			setTimeout(resolve, 24);
		}
	});
}

/** Two animation frames so sidebar cards can bind + layout after main paint. */
function waitTwoFrames(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame !== "function") {
			setTimeout(resolve, 32);
			return;
		}
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

/**
 * Page numbers whose sidebar/grid cards are currently visible (or within
 * rootMargin of the scroll container). Sorted top-to-bottom for natural fill.
 * Matches requestStaticThumb IntersectionObserver margin (~240px).
 */
export function collectVisibleSidebarPages(
	rootMarginPx = 240,
): number[] {
	if (typeof document === "undefined") return [];
	try {
		const cards = document.querySelectorAll<HTMLElement>("[data-sidebar-page]");
		if (cards.length === 0) return [];

		// Prefer the scroll container that actually hosts visible cards
		let rootRect: { top: number; bottom: number } | null = null;
		const scrolls = document.querySelectorAll<HTMLElement>(
			"[data-sidebar-thumb-scroll]",
		);
		for (const scroll of scrolls) {
			const r = scroll.getBoundingClientRect();
			// Pick a container that is on-screen and has height
			if (r.height > 8 && r.bottom > 0 && r.top < window.innerHeight) {
				rootRect = { top: r.top, bottom: r.bottom };
				break;
			}
		}
		if (!rootRect) {
			rootRect = { top: 0, bottom: window.innerHeight };
		}

		const bandTop = rootRect.top - rootMarginPx;
		const bandBottom = rootRect.bottom + rootMarginPx;
		const hits: { page: number; top: number }[] = [];
		const seen = new Set<number>();

		for (const el of cards) {
			const pageNum = Number(el.getAttribute("data-sidebar-page"));
			if (!Number.isFinite(pageNum) || pageNum < 1 || seen.has(pageNum)) {
				continue;
			}
			const r = el.getBoundingClientRect();
			// Skip fully collapsed / display:none nodes
			if (r.width < 1 && r.height < 1) continue;
			if (r.bottom >= bandTop && r.top <= bandBottom) {
				seen.add(pageNum);
				hits.push({ page: pageNum, top: r.top });
			}
		}

		hits.sort((a, b) => a.top - b.top || a.page - b.page);
		return hits.map((h) => h.page);
	} catch {
		return [];
	}
}

/**
 * Build generation order: currently visible (or near-visible) sidebar pages
 * first (top → bottom), then the rest of pageOrder document order.
 * Falls back to current page ±2 when the sidebar has not laid out yet.
 */
function buildThumbnailGenerationOrder(order: number[]): number[] {
	const validOrder = order.filter((p) => p >= 1);
	if (validOrder.length === 0) return [];

	const orderSet = new Set(validOrder);
	let visible = collectVisibleSidebarPages().filter((p) => orderSet.has(p));

	// Sidebar may not be laid out on the first tick after open
	if (visible.length === 0) {
		const current = activeDoc.currentPage || 1;
		const currentIdx = Math.max(0, validOrder.indexOf(current));
		const fallback: number[] = [];
		for (
			let i = Math.max(0, currentIdx - 2);
			i <= Math.min(validOrder.length - 1, currentIdx + 2);
			i++
		) {
			fallback.push(validOrder[i]);
		}
		visible = fallback;
	}

	const prioritySet = new Set(visible);
	const rest = validOrder.filter((p) => !prioritySet.has(p));
	// Preserve visual order for visible; document order for the remainder
	return [...visible, ...rest];
}

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

/** Optional overrides for one-off higher-quality renders (e.g. Recent p1). */
export type ThumbnailRenderQuality = {
	maxEdgePx?: number;
	maxScale?: number;
	jpegQuality?: number;
};

/**
 * Render one PDF page to a small JPEG data URL (offscreen canvas).
 * Uses the shared workspace PDFDocumentProxy + a render-queue slot.
 * Prefer priority "high" after merge so thumbs are not stuck behind a
 * low-priority gate that destroySharedWorkspacePdf may have closed.
 */
export async function generatePageThumbnailDataUrl(
	pageNum: number,
	quality?: ThumbnailRenderQuality,
	priority: PdfRenderPriority = "low",
): Promise<string | null> {
	if (activeDoc.fileType === "image") return null;

	// TIFF: encode from decoded PNG page buffer
	if (activeDoc.fileType === "tiff") {
		const pageData = activeDoc.tiffPages[pageNum - 1];
		if (!pageData) return null;
		const result = await runWithPdfRenderSlot(priority, async () => {
			const blob = new Blob([pageData as BlobPart], { type: "image/png" });
			const url = URL.createObjectURL(blob);
			try {
				const img = await loadImage(url);
				const rotation = activeDoc.rotations[pageNum] ?? 0;
				return paintImageToJpeg(img, rotation, quality);
			} finally {
				URL.revokeObjectURL(url);
			}
		});
		return result;
	}

	const bytes = activeDoc.rawBytes;
	if (!bytes || activeDoc.fileType !== "pdf") return null;

	const result = await runWithPdfRenderSlot(
		priority,
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
				// Offscreen canvas is discarded after toDataURL; free bitmap in finally.
				const plan = thumbnailScalePlanForBytes(liveBytes.byteLength);
				const maxEdge = quality?.maxEdgePx ?? plan.maxEdgePx;
				const maxScale = quality?.maxScale ?? plan.maxScale;
				const jpegQ = quality?.jpegQuality ?? THUMBNAIL_JPEG_QUALITY;
				const sessionRot = activeDoc.rotations[pageNum] ?? 0;
				const currentRotation = (page.rotate + sessionRot) % 360;
				const unrotated = page.getViewport({ scale: 1 });
				const isVertical = currentRotation % 180 === 0;
				const renderWidth = isVertical
					? unrotated.width
					: unrotated.height;
				const scale = computeThumbnailScale(
					renderWidth,
					maxEdge,
					maxScale,
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

				const dataUrl = canvas.toDataURL("image/jpeg", jpegQ);
				// Free GPU/bitmap backing store; only the JPEG string is retained.
				try {
					canvas.width = 0;
					canvas.height = 0;
				} catch {
					/* ignore */
				}
				return dataUrl;
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
	quality?: ThumbnailRenderQuality,
): string | null {
	const is90 = rotation === 90 || rotation === 270;
	const srcW = img.naturalWidth || img.width;
	const srcH = img.naturalHeight || img.height;
	const plan = thumbnailScalePlanForBytes(
		activeDoc.rawBytes?.byteLength ?? srcW * srcH,
	);
	const edge = quality?.maxEdgePx ?? plan.maxEdgePx;
	const jpegQ = quality?.jpegQuality ?? THUMBNAIL_JPEG_QUALITY;
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
	return canvas.toDataURL("image/jpeg", jpegQ);
}

/**
 * Ensure `pageThumbnailOverrides[pageNum-1]` exists.
 * Waits for main page readiness before generating (not before reading memory/IDB).
 */
export async function ensurePageThumbnail(
	pageNum: number,
	opts?: {
		force?: boolean;
		skipMainWait?: boolean;
		/** Render-queue priority (use "high" after merge). Default "low". */
		priority?: PdfRenderPriority;
	},
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
		// Non-force: skip if the other job filled the slot
		if (!opts?.force && (activeDoc.pageThumbnailOverrides || {})[idx]) {
			return;
		}
		// Force: always fall through and re-paint after the other job finishes
	}

	const priority = opts?.priority ?? "low";
	const job = (async () => {
		try {
			const dataUrl = await generatePageThumbnailDataUrl(
				pageNum,
				undefined,
				priority,
			);
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

/** True when the active doc can still receive page thumbnails. */
function canGenerateThumbsForActiveDoc(): boolean {
	const ft = activeDoc.fileType;
	if (ft === "pdf") return !!activeDoc.rawBytes;
	if (ft === "tiff") return true;
	return false;
}

/**
 * Cancel any in-flight background fill (document close / tab switch).
 * In-progress ensurePageThumbnail for a single page still finishes, but the
 * loop will not start the next page.
 * try/catch: circular import during module init (pdfStore ↔ thumbnailCache).
 */
export function stopBackgroundThumbnailGeneration(): void {
	try {
		thumbState.bgGeneration += 1;
		thumbState.bgRunning = false;
		thumbState.bgWorkspaceId = null;
	} catch {
		/* module may still be initialising under circular import */
	}
}

/**
 * After main page paint: low-priority sequential job that generates a JPEG for
 * every page missing from `pageThumbnailOverrides` / IDB hydrate.
 *
 * - One page at a time (low-priority render slot) — no main-thread floods
 * - Stores each result immediately via setPageThumbnailOverride + IDB
 * - Stops when generation token changes (close / switch) or bytes go away
 * - Safe to call repeatedly; same-workspace re-entry is a no-op while running
 */
export function startBackgroundThumbnailGeneration(): void {
	try {
		if (typeof window === "undefined") return;
		if (!canGenerateThumbsForActiveDoc()) return;

		const wsId = workspaceKey();
		// Already filling this workspace — leave the existing loop alone.
		// Callers that *must* re-walk after a structural rewrite should use
		// forceRestartBackgroundThumbnailGeneration() instead.
		if (thumbState.bgRunning && thumbState.bgWorkspaceId === wsId) {
			return;
		}

		// New run (or different workspace): cancel any prior loop first
		const gen = ++thumbState.bgGeneration;
		thumbState.bgRunning = true;
		thumbState.bgWorkspaceId = wsId;

		void (async () => {
			try {
				await waitMainViewReady();
				if (gen !== thumbState.bgGeneration) return;
				if (workspaceKey() !== wsId) return;
				if (!canGenerateThumbsForActiveDoc()) return;

				// Wait for PageSidebar cards to mount/layout so visibility is real
				await waitTwoFrames();
				await yieldToMain();
				if (gen !== thumbState.bgGeneration) return;
				if (workspaceKey() !== wsId) return;

				const order = activeDoc.pageOrder || [];
				if (order.length === 0) return;

				// 1) Currently visible / near-visible sidebar pages (top → bottom)
				// 2) Remainder of the document in pageOrder
				const pages = buildThumbnailGenerationOrder(order);
				const visibleFirst = collectVisibleSidebarPages();

				let filled = 0;
				let skipped = 0;
				for (const pageNum of pages) {
					if (gen !== thumbState.bgGeneration) return;
					if (workspaceKey() !== wsId) return;
					if (!canGenerateThumbsForActiveDoc()) return;

					const overrides = activeDoc.pageThumbnailOverrides || {};
					if (overrides[pageNum - 1]) {
						skipped += 1;
						continue;
					}

					// Sequential ensure — low-priority slot + shared PDF only.
					// skipMainWait: we already awaited main readiness once.
					await ensurePageThumbnail(pageNum, { skipMainWait: true });
					filled += 1;

					// Yield so scroll/zoom paints and idle cleanup can interleave.
					// Do not mark pdf activity (would delay idle cleanup forever).
					await yieldToMain();
				}

				if (gen === thumbState.bgGeneration) {
					console.log(
						`⚡ Background thumbnails: filled ${filled}, already cached ${skipped}, visible-first=${visibleFirst.length} (ws=${wsId})`,
					);
					// After the low-res fill, upgrade page 1 for Recent Documents cards
					await upgradePage1RecentThumbnail(gen, wsId);
				}
			} catch (err) {
				if (gen === thumbState.bgGeneration) {
					console.warn("Background thumbnail generation stopped:", err);
				}
			} finally {
				if (gen === thumbState.bgGeneration) {
					thumbState.bgRunning = false;
					// Keep bgWorkspaceId until next start/stop for diagnostics
				}
			}
		})();
	} catch {
		/* module may still be initialising under circular import */
	}
}

/**
 * Re-render page 1 at higher resolution once the background fill finishes.
 * Updates sidebar override + Recent Documents card (when a path is known).
 */
async function upgradePage1RecentThumbnail(
	gen: number,
	wsId: string,
): Promise<void> {
	try {
		if (gen !== thumbState.bgGeneration) return;
		if (workspaceKey() !== wsId) return;
		if (!canGenerateThumbsForActiveDoc()) return;

		// Only PDF/TIFF have multi-page thumbs; images already use full-res previews
		if (activeDoc.fileType !== "pdf" && activeDoc.fileType !== "tiff") {
			return;
		}

		await yieldToMain();
		if (gen !== thumbState.bgGeneration) return;
		if (workspaceKey() !== wsId) return;

		const dataUrl = await generatePageThumbnailDataUrl(1, {
			maxEdgePx: RECENT_THUMB_MAX_EDGE_PX,
			maxScale: RECENT_THUMB_MAX_SCALE,
			jpegQuality: RECENT_THUMB_JPEG_QUALITY,
		});
		if (!dataUrl) return;
		if (gen !== thumbState.bgGeneration) return;
		if (workspaceKey() !== wsId) return;
		if (!canGenerateThumbsForActiveDoc()) return;

		const path = activeDoc.filePath || null;
		if (path) {
			// Broadcast to recents + page-0 override + thumbnailVersion
			applyLiveThumbnail(dataUrl, path, 0);
		} else {
			// Unsaved tab: still upgrade the in-memory sidebar p1 thumb
			setPageThumbnailOverride(0, dataUrl);
		}
		console.log("⚡ Page 1 recent-thumbnail upgraded to higher resolution");
	} catch (err) {
		console.warn("Page 1 recent-thumbnail upgrade skipped:", err);
	}
}

/**
 * Kick the sequential full-document background fill (after main is ready).
 * Visible placeholders may still call ensurePageThumbnail via IntersectionObserver.
 */
export function ensureAllPageThumbnails(): void {
	startBackgroundThumbnailGeneration();
}

/** Drop cached JPEG for a page and regenerate once (also refreshes IDB). */
export function invalidatePageThumbnail(pageNum: number): void {
	if (pageNum < 1) return;
	const overrides = { ...(activeDoc.pageThumbnailOverrides || {}) };
	delete overrides[pageNum - 1];
	activeDoc.pageThumbnailOverrides = overrides;
	void ensurePageThumbnail(pageNum, { force: true, skipMainWait: true });
}

/**
 * Pure remap of 0-based thumbnail slots after a page insert/merge rewrite.
 * Pre and post slices keep their old JPEGs; inserted slots stay empty.
 */
export function remapThumbnailOverridesAfterInsert(
	oldOverrides: Record<number, string> | null | undefined,
	prePagesOrder: number[],
	extraPageCount: number,
	postPagesOrder: number[],
): Record<number, string> {
	const old = oldOverrides || {};
	const next: Record<number, string> = {};
	let idx = 0;
	for (const oldPage of prePagesOrder || []) {
		const thumb = old[oldPage - 1];
		if (thumb) next[idx] = thumb;
		idx += 1;
	}
	// Newly inserted pages: leave empty slots for background generation
	idx += Math.max(0, extraPageCount | 0);
	for (const oldPage of postPagesOrder || []) {
		const thumb = old[oldPage - 1];
		if (thumb) next[idx] = thumb;
		idx += 1;
	}
	return next;
}

/**
 * Force-generate thumbnails for specific 1-based page numbers immediately.
 * Does not wait for IntersectionObserver / scroll. Uses high-priority render
 * slots so work is not blocked by `lowPriorityAllowed === false` after a
 * shared-PDF destroy (merge path).
 */
export async function generateThumbnailsForPages(
	pageNums: number[],
	reason = "merge",
): Promise<void> {
	const pages = [
		...new Set(
			(pageNums || []).filter((p) => Number.isFinite(p) && p >= 1),
		),
	].sort((a, b) => a - b);

	if (pages.length === 0) {
		console.log(`${reason}: no pages need thumbnail generation`);
		return;
	}

	console.log(
		`${reason}: generating thumbnails for pages ${pages.join(", ")}`,
	);

	// destroySharedWorkspacePdf → clearPdfRenderQueue sets lowPriorityAllowed=false.
	// Re-open the gate before any low work; also use high priority for these jobs.
	setLowPriorityAllowed(true);

	// Warm the shared PDF for the *new* bytes before per-page paints
	const bytes = activeDoc.rawBytes;
	if (activeDoc.fileType === "pdf" && bytes) {
		try {
			const doc = await getSharedWorkspacePdf(bytes);
			if (!doc) {
				console.warn(
					`${reason}: shared PDF not available — thumbnail generation skipped`,
				);
				return;
			}
		} catch (err) {
			console.warn(`${reason}: failed to open shared PDF for thumbs:`, err);
			return;
		}
	}

	let ok = 0;
	let fail = 0;
	for (const pageNum of pages) {
		if (!canGenerateThumbsForActiveDoc()) break;
		try {
			await ensurePageThumbnail(pageNum, {
				force: true,
				skipMainWait: true,
				priority: "high",
			});
			const has = !!(activeDoc.pageThumbnailOverrides || {})[pageNum - 1];
			if (has) ok += 1;
			else fail += 1;
		} catch (err) {
			fail += 1;
			console.warn(
				`${reason}: thumbnail failed for page ${pageNum}:`,
				err,
			);
		}
		await yieldToMain();
	}

	console.log(
		`${reason}: thumbnail generation done — ok=${ok}, missing=${fail}, pages=[${pages.join(", ")}]`,
	);
}

/**
 * After merge / blank-page insert the PDF is rewritten as pages 1..N.
 * Keep thumbs for pages whose *content* survived (pre + post slices), leave
 * holes for newly inserted pages, then **await** force-generate for every
 * newly added page so the sidebar/grid update without scroll.
 *
 * @param prePagesOrder Old 1-based page numbers kept before the insert
 * @param extraPageCount Number of newly inserted pages (no thumbs yet)
 * @param postPagesOrder Old 1-based page numbers kept after the insert
 * @param newBytes Fresh document bytes (for content-key / IDB)
 */
export async function refreshThumbnailsAfterPageInsert(
	prePagesOrder: number[],
	extraPageCount: number,
	postPagesOrder: number[],
	newBytes: Uint8Array,
): Promise<void> {
	const next = remapThumbnailOverridesAfterInsert(
		activeDoc.pageThumbnailOverrides,
		prePagesOrder,
		extraPageCount,
		postPagesOrder,
	);

	setThumbnailContentKeyFromBytes(newBytes);
	activeDoc.pageThumbnailOverrides = next;
	// Layout dims are per-index and no longer match the rewritten PDF
	const doc = activeDoc.current;
	if (doc) {
		doc.cachedDimensions = undefined;
	}

	// 1-based page numbers of the newly inserted block (primary) + any other miss
	const newPageNums: number[] = [];
	const preLen = (prePagesOrder || []).length;
	const extra = Math.max(0, extraPageCount | 0);
	for (let i = 0; i < extra; i++) {
		newPageNums.push(preLen + i + 1);
	}
	const order = activeDoc.pageOrder || [];
	for (const p of order) {
		if (p >= 1 && !next[p - 1] && !newPageNums.includes(p)) {
			newPageNums.push(p);
		}
	}

	// Cancel any in-flight fill that was walking the old page set
	stopBackgroundThumbnailGeneration();
	thumbState.inflight.clear();

	// Critical: re-enable low-priority paints (destroy cleared the gate)
	setLowPriorityAllowed(true);

	// Force-generate every new page NOW (high priority, no IO dependency)
	await generateThumbnailsForPages(newPageNums, "Merge");

	// Then walk the rest of the document in the background for any other holes
	forceRestartBackgroundThumbnailGeneration();
}

/**
 * Always cancel the current fill loop and start a fresh one for this workspace.
 * Unlike {@link startBackgroundThumbnailGeneration}, never no-ops when a loop
 * is already marked running (needed after merge when we must re-walk pages).
 */
export function forceRestartBackgroundThumbnailGeneration(): void {
	try {
		if (typeof window === "undefined") return;
		// Bump generation so any in-flight loop exits its for-loop
		stopBackgroundThumbnailGeneration();
		// Clear bgRunning so start() does not early-return
		thumbState.bgRunning = false;
		thumbState.bgWorkspaceId = null;
		startBackgroundThumbnailGeneration();
	} catch {
		/* circular import / SSR */
	}
}

/** Clear in-flight map for tests / document teardown. Cancels background fill. */
export function clearThumbnailInflight(): void {
	try {
		stopBackgroundThumbnailGeneration();
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
