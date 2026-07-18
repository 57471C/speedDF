/**
 * PDF.js / image / TIFF canvas paint + text-layer pipeline for a single workspace page.
 * Owns render task handles; does not own document store state.
 */

import * as pdfjsLib from "pdfjs-dist";
import { activeDoc } from "../../pdfStore.svelte";

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
	let rendering = false;
	let activeRenderTask: { cancel: () => void; promise: Promise<unknown> } | null =
		null;
	let activePdfPage: { cleanup: () => void } | null = null;

	function clearTextLayer(container: HTMLDivElement | null) {
		if (activeTextLayer) {
			try {
				activeTextLayer.cancel();
			} catch {
				/* ignore */
			}
			activeTextLayer = null;
		}
		if (container) {
			container.replaceChildren();
		}
	}

	function cancelActiveRenderTask() {
		if (activeRenderTask) {
			try {
				activeRenderTask.cancel();
			} catch {
				/* ignore */
			}
			activeRenderTask = null;
		}
	}

	/** Tear down PDF/text resources when the page leaves the paint viewport. */
	function releaseWhenUnrendered() {
		cancelActiveRenderTask();
		clearTextLayer(getTextLayerElement());
		if (activePdfPage) {
			try {
				activePdfPage.cleanup();
			} catch {
				/* ignore */
			}
			activePdfPage = null;
		}
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
		if (mode === "scaled-base" && baseW != null && baseH != null && scaleFactor != null) {
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
					if (!getIsSystemPrinting()) {
						node.width = 0;
						node.height = 0;
						setCanvasElement(null);
					}
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
					if (!getIsSystemPrinting()) {
						node.width = 0;
						node.height = 0;
						setCanvasElement(null);
					}
				},
			};
		}

		return {
			destroy() {
				if (!getIsSystemPrinting()) {
					node.width = 0;
					node.height = 0;
					setCanvasElement(null);
				}
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

		if (activeDoc.fileType === "image") {
			const rotation = activeDoc.imageRotation ?? 0;
			clearTextLayer(textLayerContainer);

			if (activeDoc.imageUrl) {
				const img = new Image();
				img.onload = () => {
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
				};
				img.src = activeDoc.imageUrl;
			}
			return;
		}

		if (activeDoc.fileType === "tiff") {
			const pageData = activeDoc.tiffPages[pageNum - 1];
			const rotation = activeDoc.rotations[pageNum] ?? 0;

			// TIFF pages have no PDF text content — clear any leftover text layer
			clearTextLayer(textLayerContainer);

			if (pageData) {
				const blob = new Blob([pageData as BlobPart], { type: "image/png" });
				const url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => {
					paintRotatedImage(canvas, img, rotation, "native");
					URL.revokeObjectURL(url);
				};
				img.src = url;
			}
			return;
		}

		if (rendering) {
			// Cancel in-flight paint + text layer (do not wipe container children here —
			// matches prior WorkspacePage re-entry behaviour).
			cancelActiveRenderTask();
			if (activeTextLayer) {
				try {
					activeTextLayer.cancel();
				} catch {
					/* ignore */
				}
				activeTextLayer = null;
			}
		}
		rendering = true;
		try {
			const loadingTask = pdfjsLib.getDocument({
				data: pdfBytes.slice(0),
				cMapUrl: window.location.origin + "/cmaps/",
				cMapPacked: true,
				standardFontDataUrl: window.location.origin + "/standard_fonts/",
				wasmUrl: window.location.origin + "/",
			});
			const pdfDocument = await loadingTask.promise;
			const page = await pdfDocument.getPage(pageNum);
			activePdfPage = page;

			const dpr = window.devicePixelRatio || 1;
			const safeScale = Math.max(0.1, scale / 100);
			const rotation = (page.rotate + rotationAngle) % 360;
			const adjustedViewport = page.getViewport({
				scale: safeScale * dpr,
				rotation,
			});
			// CSS-pixel viewport for the text layer (matches on-screen canvas size)
			const textViewport = page.getViewport({
				scale: safeScale,
				rotation,
			});

			const context = canvas.getContext("2d");
			if (context) {
				canvas.width = adjustedViewport.width;
				canvas.height = adjustedViewport.height;
				canvas.style.width = `${adjustedViewport.width / dpr}px`;
				canvas.style.height = `${adjustedViewport.height / dpr}px`;
				activeRenderTask = page.render({
					canvas: canvas,
					viewport: adjustedViewport,
				});
				await activeRenderTask.promise;
			}

			// Superimpose a selectable PDF.js text layer over the rendered canvas
			if (textLayerContainer) {
				if (activeTextLayer) {
					try {
						activeTextLayer.cancel();
					} catch {
						/* ignore */
					}
					activeTextLayer = null;
				}
				// Always clear prior text runs before re-rendering (zoom / page change)
				textLayerContainer.replaceChildren();
				textLayerContainer.style.setProperty(
					"--total-scale-factor",
					String(safeScale),
				);
				textLayerContainer.style.setProperty("--scale-round-x", "1px");
				textLayerContainer.style.setProperty("--scale-round-y", "1px");

				const textContent = await page.getTextContent();
				const textLayer = new pdfjsLib.TextLayer({
					textContentSource: textContent,
					container: textLayerContainer,
					viewport: textViewport,
				});
				activeTextLayer = textLayer;
				await textLayer.render();
			}
		} catch (error: unknown) {
			const err = error as { name?: string };
			if (err && err.name === "RenderingCancelledException") {
				return;
			}
			console.error(error);
		} finally {
			rendering = false;
			activeRenderTask = null;
		}
	}

	return {
		canvasLifecycle,
		renderPageSheet,
		releaseWhenUnrendered,
	};
}
