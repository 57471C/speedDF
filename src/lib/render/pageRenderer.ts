/**
 * PDF.js / image / TIFF canvas paint + text-layer pipeline for a single workspace page.
 * Owns render task handles; does not own document store state.
 *
 * Concurrent paints on the same canvas are prevented by:
 * - always cancelling the prior render task and awaiting its settle
 * - a generation counter so superseded async paths never touch the canvas
 */

import * as pdfjsLib from "pdfjs-dist";
import { activeDoc } from "../../pdfStore.svelte";
import { runWithPdfRenderSlot } from "./pdfRenderQueue";
import { markMainViewReady } from "./mainViewGate";
import {
	cleanupPdfPage,
	getSharedWorkspacePdf,
	notePdfActivity,
	type SharedPdfPage,
} from "./sharedPdfDocument";

export type PageRendererDeps = {
	getPageNumber: () => number;
	getZoomScale: () => number;
	getBasePageWidth: () => number;
	getBasePageHeight: () => number;
	getIsSystemPrinting: () => boolean;
	/** Set by the canvas action; cleared on destroy. */
	setCanvasElement: (el: HTMLCanvasElement | null) => void;
	getTextLayerElement: () => HTMLDivElement | null;
};

export type PageRenderer = ReturnType<typeof createPageRenderer>;

type RenderTaskLike = {
	cancel: () => void;
	promise: Promise<unknown>;
};

function isRenderCancelled(error: unknown): boolean {
	const err = error as { name?: string; message?: string };
	if (!err) return false;
	if (err.name === "RenderingCancelledException") return true;
	if (typeof err.message === "string" && /cancel/i.test(err.message))
		return true;
	return false;
}

export function createPageRenderer(deps: PageRendererDeps) {
	const {
		getPageNumber,
		getZoomScale,
		getBasePageWidth,
		getBasePageHeight,
		getIsSystemPrinting,
		setCanvasElement,
		getTextLayerElement,
	} = deps;

	let activeTextLayer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
	let activeRenderTask: RenderTaskLike | null = null;
	let activePdfPage: SharedPdfPage | null = null;
	/** Last canvas bound via canvasLifecycle / renderPageSheet. */
	let boundCanvas: HTMLCanvasElement | null = null;
	/** Bumped on every paint/cancel so in-flight async work can bail out. */
	let paintGeneration = 0;

	function releaseActivePdfPage() {
		cleanupPdfPage(activePdfPage);
		activePdfPage = null;
	}

	/** Drop GPU/bitmap backing store while keeping the canvas node. */
	function zeroCanvasBuffer(canvas: HTMLCanvasElement | null) {
		if (!canvas || getIsSystemPrinting()) return;
		try {
			canvas.width = 0;
			canvas.height = 0;
		} catch {
			/* ignore */
		}
	}

	function cancelTextLayerOnly() {
		if (activeTextLayer) {
			try {
				activeTextLayer.cancel();
			} catch {
				/* ignore */
			}
			activeTextLayer = null;
		}
	}

	/**
	 * Cancel the in-flight page.render() and wait until pdf.js releases the canvas.
	 * Must complete before starting another render on the same canvas element.
	 */
	async function cancelActiveRenderTask(): Promise<void> {
		const task = activeRenderTask;
		if (!task) return;
		activeRenderTask = null;
		try {
			task.cancel();
		} catch {
			/* ignore */
		}
		try {
			await task.promise;
		} catch {
			// Expected RenderingCancelledException (or equivalent) after cancel.
		}
	}

	/** Cancel paint + text layer without destroying page resources or DOM children. */
	async function cancelInFlight(): Promise<void> {
		paintGeneration += 1;
		cancelTextLayerOnly();
		await cancelActiveRenderTask();
	}

	/** Tear down PDF/text resources when the page leaves the paint viewport. */
	async function releaseWhenUnrendered(): Promise<void> {
		paintGeneration += 1;
		await cancelActiveRenderTask();
		const textLayerEl = getTextLayerElement();
		cancelTextLayerOnly();
		if (textLayerEl) {
			textLayerEl.replaceChildren();
		}
		releaseActivePdfPage();
		// Free canvas bitmap for off-screen pages (DOM node kept for reuse).
		zeroCanvasBuffer(boundCanvas);
	}

	function paintRotatedImage(
		canvas: HTMLCanvasElement,
		img: HTMLImageElement,
		rotation: number,
		mode: "scaled-base" | "native",
		baseW?: number,
		baseH?: number,
		scaleFactor?: number,
	) {
		const isRotated90 = rotation === 90 || rotation === 270;
		if (
			mode === "scaled-base" &&
			baseW != null &&
			baseH != null &&
			scaleFactor != null
		) {
			const currentWidth = isRotated90 ? baseH : baseW;
			const currentHeight = isRotated90 ? baseW : baseH;
			canvas.width = currentWidth * scaleFactor;
			canvas.height = currentHeight * scaleFactor;
			const ctx = canvas.getContext("2d");
			if (ctx) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.save();
				ctx.translate(canvas.width / 2, canvas.height / 2);
				ctx.rotate((rotation * Math.PI) / 180);
				ctx.scale(scaleFactor, scaleFactor);
				ctx.drawImage(img, -baseW / 2, -baseH / 2, baseW, baseH);
				ctx.restore();
			}
			return;
		}

		// native: TIFF-style (canvas size from image pixels)
		if (isRotated90) {
			canvas.width = img.height;
			canvas.height = img.width;
		} else {
			canvas.width = img.width;
			canvas.height = img.height;
		}
		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.save();
			ctx.translate(canvas.width / 2, canvas.height / 2);
			ctx.rotate((rotation * Math.PI) / 180);
			ctx.drawImage(img, -img.width / 2, -img.height / 2);
			ctx.restore();
		}
	}

	function canvasLifecycle(node: HTMLCanvasElement) {
		boundCanvas = node;
		setCanvasElement(node);
		const pageNumber = getPageNumber();
		const zoomScale = getZoomScale();
		const basePageWidth = getBasePageWidth();
		const basePageHeight = getBasePageHeight();

		if (activeDoc.fileType === "image") {
			const rotation = activeDoc.imageRotation ?? 0;
			if (activeDoc.imageUrl) {
				const img = new Image();
				img.onload = () => {
					paintRotatedImage(
						node,
						img,
						rotation,
						"scaled-base",
						basePageWidth,
						basePageHeight,
						zoomScale / 100,
					);
				};
				img.src = activeDoc.imageUrl;
			}
			return {
				destroy() {
					void cancelInFlight();
					releaseActivePdfPage();
					zeroCanvasBuffer(node);
					if (boundCanvas === node) boundCanvas = null;
					setCanvasElement(null);
				},
			};
		}

		if (activeDoc.fileType === "tiff") {
			const pageData = activeDoc.tiffPages[pageNumber - 1];
			const rotation = activeDoc.rotations[pageNumber] ?? 0;

			if (pageData) {
				const blob = new Blob([pageData as BlobPart], { type: "image/png" });
				const url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => {
					paintRotatedImage(node, img, rotation, "native");
					URL.revokeObjectURL(url);
				};
				img.src = url;
			}
			return {
				destroy() {
					void cancelInFlight();
					releaseActivePdfPage();
					zeroCanvasBuffer(node);
					if (boundCanvas === node) boundCanvas = null;
					setCanvasElement(null);
				},
			};
		}

		return {
			destroy() {
				void cancelInFlight();
				releaseActivePdfPage();
				zeroCanvasBuffer(node);
				if (boundCanvas === node) boundCanvas = null;
				setCanvasElement(null);
			},
		};
	}

	async function renderPageSheet(
		pdfBytes: Uint8Array,
		pageNum: number,
		scale: number,
		canvas: HTMLCanvasElement,
		rotationAngle: number,
		textLayerContainer: HTMLDivElement | null = null,
	) {
		const zoomScale = getZoomScale();
		const basePageWidth = getBasePageWidth();
		const basePageHeight = getBasePageHeight();

		// New paint generation — any prior in-flight work becomes stale.
		const generation = ++paintGeneration;
		// Always free the canvas before a new paint (pdf.js rejects concurrent use).
		await cancelActiveRenderTask();
		cancelTextLayerOnly();
		if (generation !== paintGeneration) return;

		if (activeDoc.fileType === "image") {
			if (textLayerContainer) {
				textLayerContainer.replaceChildren();
			}

			if (activeDoc.imageUrl) {
				const img = new Image();
				img.onload = () => {
					if (generation !== paintGeneration) return;
					const rot = activeDoc.imageRotation || 0;
					paintRotatedImage(
						canvas,
						img,
						rot,
						"scaled-base",
						basePageWidth,
						basePageHeight,
						zoomScale / 100,
					);
					markMainViewReady();
				};
				img.src = activeDoc.imageUrl;
			}
			return;
		}

		if (activeDoc.fileType === "tiff") {
			const pageData = activeDoc.tiffPages[pageNum - 1];
			const rotation = activeDoc.rotations[pageNum] ?? 0;

			// TIFF pages have no PDF text content — clear any leftover text layer
			if (textLayerContainer) {
				textLayerContainer.replaceChildren();
			}

			if (pageData) {
				const blob = new Blob([pageData as BlobPart], { type: "image/png" });
				const url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => {
					if (generation !== paintGeneration) return;
					paintRotatedImage(canvas, img, rotation, "native");
					URL.revokeObjectURL(url);
					markMainViewReady();
				};
				img.src = url;
			}
			return;
		}

		// Gate concurrent pdf.js/Wasm paints globally (main view = high priority).
		await runWithPdfRenderSlot(
			"high",
			async () => {
				if (generation !== paintGeneration) return;

				let page: SharedPdfPage | null = null;

				try {
					// One shared PDFDocumentProxy for the workspace — never getDocument per paint.
					const pdfDocument = await getSharedWorkspacePdf(pdfBytes);
					if (!pdfDocument || generation !== paintGeneration) return;

					notePdfActivity("main-paint");
					// PDFPageProxy — typed loosely so we don't couple to pdf.js internals.
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const nextPage: any = await pdfDocument.getPage(pageNum);
					if (generation !== paintGeneration) {
						cleanupPdfPage(nextPage);
						return;
					}
					// Drop prior page resources before adopting the new page proxy.
					releaseActivePdfPage();
					page = nextPage;
					activePdfPage = nextPage;
					boundCanvas = canvas;

					const dpr = window.devicePixelRatio || 1;
					const safeScale = Math.max(0.1, scale / 100);
					const rotation = (nextPage.rotate + rotationAngle) % 360;
					const adjustedViewport = nextPage.getViewport({
						scale: safeScale * dpr,
						rotation,
					});
					// CSS-pixel viewport for the text layer (matches on-screen canvas size)
					const textViewport = nextPage.getViewport({
						scale: safeScale,
						rotation,
					});

					const context = canvas.getContext("2d");
					if (context) {
						// Re-check after any await; another paint may have claimed the canvas.
						if (generation !== paintGeneration) return;

						// Always cancel any stale task one more time before bind.
						await cancelActiveRenderTask();
						if (generation !== paintGeneration) return;

						canvas.width = adjustedViewport.width;
						canvas.height = adjustedViewport.height;
						canvas.style.width = `${adjustedViewport.width / dpr}px`;
						canvas.style.height = `${adjustedViewport.height / dpr}px`;

						const renderTask = nextPage.render({
							canvas: canvas,
							viewport: adjustedViewport,
						});
						activeRenderTask = renderTask;
						try {
							await renderTask.promise;
							// First successful main paint → unlock background thumbnails
							if (generation === paintGeneration) {
								markMainViewReady();
							}
						} catch (error: unknown) {
							if (isRenderCancelled(error)) return;
							throw error;
						} finally {
							if (activeRenderTask === renderTask) {
								activeRenderTask = null;
							}
						}
					}

					if (generation !== paintGeneration) return;

					// Superimpose a selectable PDF.js text layer over the rendered canvas
					if (textLayerContainer) {
						cancelTextLayerOnly();
						// Always clear prior text runs before re-rendering (zoom / page change)
						textLayerContainer.replaceChildren();
						textLayerContainer.style.setProperty(
							"--total-scale-factor",
							String(safeScale),
						);
						textLayerContainer.style.setProperty("--scale-round-x", "1px");
						textLayerContainer.style.setProperty("--scale-round-y", "1px");

						const textContent = await nextPage.getTextContent();
						if (generation !== paintGeneration) return;

						const textLayer = new pdfjsLib.TextLayer({
							textContentSource: textContent,
							container: textLayerContainer,
							viewport: textViewport,
						});
						activeTextLayer = textLayer;
						try {
							await textLayer.render();
						} catch (error: unknown) {
							if (isRenderCancelled(error)) return;
							throw error;
						}
					}

					// Free operator lists / fonts for this page; canvas pixels remain.
					// Shared document stays alive for other pages / thumbs.
					if (generation === paintGeneration) {
						cleanupPdfPage(page);
						if (activePdfPage === page) activePdfPage = null;
					}
				} catch (error: unknown) {
					if (isRenderCancelled(error)) {
						return;
					}
					console.error(error);
				} finally {
					// If we were cancelled mid-flight after getPage, free the page proxy.
					if (generation !== paintGeneration && page) {
						cleanupPdfPage(page);
						if (activePdfPage === page) activePdfPage = null;
					}
				}
			},
			() => generation !== paintGeneration,
		);
	}

	return {
		canvasLifecycle,
		renderPageSheet,
		releaseWhenUnrendered,
		cancelInFlight,
	};
}
