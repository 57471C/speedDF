/**
 * Page-level drag, selection, and pointer interaction for WorkspacePage.
 * Owns interaction session state; document mutations go through activeDoc.
 */

import {
	type AnnotationShape,
	activeDoc,
	pushHistorySnapshot,
} from "../../pdfStore.svelte";
import { cacheStampDimensions } from "../annotation/ghostDimensions";
import {
	createBoxShape,
	createFreehandShape,
	createLineShape,
	createSignatureOrInitialShape,
	createTextShape,
	createTickOrDashShape,
	defaultTextBoxHeightPct,
	hasEmptyTextDraft,
	lineBoundsFromPoints,
	withoutEmptyTextDrafts,
} from "../annotation/toolShapes";
import {
	getDisplayCoords as getDisplayCoordsPure,
	getDisplayPoints as getDisplayPointsPure,
	normalizeCoordinates as normalizeCoordinatesPure,
	type PointPct,
	type RectPct,
} from "./coordinates";
import { clampPct, computeResizedBounds } from "./resizeMath";
import { isBoxShapeTool, SHAPE_TYPES_LIST } from "./shapeTypes";

export { isBoxShapeTool, SHAPE_TYPES_LIST } from "./shapeTypes";

export type PageInteractionDeps = {
	getPageNumber: () => number;
	getPageContainer: () => HTMLDivElement | null;
	getBasePageWidth: () => number;
	getBasePageHeight: () => number;
	getZoomScale: () => number;
	getGhostDimensions: () => { w: number; h: number };
};

export function createPageInteraction(deps: PageInteractionDeps) {
	const {
		getPageNumber,
		getPageContainer,
		getBasePageWidth,
		getBasePageHeight,
		getZoomScale,
		getGhostDimensions,
	} = deps;

	let isDrawing = $state(false);
	let startX = $state(0);
	let startY = $state(0);
	let currentX = $state(0);
	let currentY = $state(0);

	let liveHighlightPoints = $state<{ x: number; y: number }[]>([]);
	/** Running pressure samples for pen strokes (0–1); mouse defaults to 0.5. */
	let strokePressureSum = 0;
	let strokePressureCount = 0;
	let activePointerId: number | null = null;

	/** Line tool: first click placed; rubber-band until second click. */
	let lineAwaitingEnd = $state(false);
	let lineStartPct = $state<PointPct | null>(null);
	let linePreviewPct = $state<PointPct | null>(null);

	let activelyEditingIndex = $state<number | null>(null);
	/** Snapshot of text when edit began — guards against accidental empty-delete on blur. */
	let textEditBaseline = "";
	let draggingHandle = $state<string | null>(null);
	let initialShapeState = $state<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
	/** Snapshot of line endpoints when dragging a line handle or body. */
	let initialLinePoints: { x: number; y: number }[] | null = null;
	let isMovingShape = $state(false);
	let dragStartMouseX = 0;
	let dragStartMouseY = 0;
	let dragTargetElement: HTMLElement | null = null;

	// Non-reactive caching layer for shape dragging/drawing coordinates
	let dragActive = false;
	let rawStartX = 0;
	let rawStartY = 0;
	let rawCurrentX = 0;
	let rawCurrentY = 0;
	let rawLiveHighlightPoints: { x: number; y: number }[] = [];
	let rawResizedShapeCoords = { x: 0, y: 0, width: 0, height: 0 };
	let animationFrameId: number | null = null;
	let dragPageRect: DOMRect | null = null;
	// Multi-select group drag cache (points for line shapes)
	let rawGroupInitialPositions: {
		index: number;
		x: number;
		y: number;
		points?: { x: number; y: number }[];
	}[] = [];
	let groupDragElements: HTMLElement[] = [];

	function clearLineDrawingState() {
		lineAwaitingEnd = false;
		lineStartPct = null;
		linePreviewPct = null;
	}

	function commitLineShape(start: PointPct, end: PointPct) {
		const pageNumber = getPageNumber();
		const dist = Math.hypot(end.x - start.x, end.y - start.y);
		if (dist < 0.15) {
			clearLineDrawingState();
			return;
		}
		const newShape = createLineShape(start, end, {
			color: activeDoc.activeColor,
			thickness: activeDoc.activeThickness,
			lineStyle: activeDoc.activeLineStyle,
			lineEnds: activeDoc.activeLineEnds,
		});
		const existing = activeDoc.shapes[pageNumber] || [];
		activeDoc.shapes = {
			...activeDoc.shapes,
			[pageNumber]: [...existing, newShape],
		};
		clearLineDrawingState();
	}

	let isMouseOverPage = $state(false);
	let hoverPctX = $state(0);
	let hoverPctY = $state(0);

	function buildNormalizeCtx(pageWidth: number, pageHeight: number) {
		return {
			fileType: activeDoc.fileType,
			imageRotation: activeDoc.imageRotation || 0,
			basePageWidth: getBasePageWidth(),
			basePageHeight: getBasePageHeight(),
			zoomScale: getZoomScale(),
			pageWidth,
			pageHeight,
		};
	}

	function normalizeCoordinates(rawX: number, rawY: number): PointPct {
		const pageContainer = getPageContainer();
		if (activeDoc.fileType === "image") {
			return normalizeCoordinatesPure(rawX, rawY, buildNormalizeCtx(1, 1));
		}
		if (!pageContainer) return { x: 0, y: 0 };
		const rect = dragPageRect || pageContainer.getBoundingClientRect();
		return normalizeCoordinatesPure(
			rawX,
			rawY,
			buildNormalizeCtx(rect.width, rect.height),
		);
	}

	function getDisplayCoords(shape: {
		x: number;
		y: number;
		width?: number;
		height?: number;
	}): RectPct {
		return getDisplayCoordsPure(
			shape,
			activeDoc.fileType,
			activeDoc.imageRotation || 0,
		);
	}

	function getDisplayPoints(
		points: { x: number; y: number }[] | undefined,
	): PointPct[] {
		return getDisplayPointsPure(
			points,
			activeDoc.fileType,
			activeDoc.imageRotation || 0,
		);
	}

	function addShapeToPage(shape: AnnotationShape) {
		const pageNumber = getPageNumber();
		const existing = activeDoc.shapes[pageNumber] || [];
		const newIndex = existing.length;
		activeDoc.shapes = {
			...activeDoc.shapes,
			[pageNumber]: [...existing, shape],
		};
		return newIndex;
	}

	function handleSignatureOrInitial(mousePctX: number, mousePctY: number) {
		const pageNumber = getPageNumber();
		const toolType = activeDoc.activeTool as "signature" | "initial";
		const dims = getGhostDimensions();
		const newSignatureStamp = createSignatureOrInitialShape(
			toolType,
			mousePctX,
			mousePctY,
			{
				ghostW: dims.w,
				ghostH: dims.h,
				dataUrl: activeDoc.activeStampDataUrl,
			},
		);
		const newIndex = addShapeToPage(newSignatureStamp);
		activeDoc.selectedShape = { pageNumber, index: newIndex };
	}

	function handleTickOrDash(mousePctX: number, mousePctY: number) {
		const pageNumber = getPageNumber();
		const toolType = activeDoc.activeTool as "tick" | "dash";
		const newStampShape = createTickOrDashShape(
			toolType,
			mousePctX,
			mousePctY,
			activeDoc.activeColor,
		);
		const newIndex = addShapeToPage(newStampShape);
		activeDoc.selectedShape = { pageNumber, index: newIndex };
	}

	function handleTextTool(mousePctX: number, mousePctY: number) {
		const pageNumber = getPageNumber();
		const currentShapes = activeDoc.shapes[pageNumber] || [];
		if (hasEmptyTextDraft(currentShapes)) {
			// STEP A: Explicitly isolate and clear active tracking variables first so nothing points to the target index
			activeDoc.selectedShape = null;
			activelyEditingIndex = null;

			// STEP B: Perform the state array cleanup pass only after trackers are safe
			activeDoc.shapes = {
				...activeDoc.shapes,
				[pageNumber]: withoutEmptyTextDrafts(currentShapes),
			};
		}

		const zoom = Math.max(5, Math.abs(getZoomScale()));
		const pageContainer = getPageContainer();
		let pageHeightPx = 0;
		if (activeDoc.fileType === "image") {
			const rot = activeDoc.imageRotation || 0;
			const baseH =
				rot === 90 || rot === 270 ? getBasePageWidth() : getBasePageHeight();
			pageHeightPx = Math.max(1, baseH) * (zoom / 100);
		} else if (pageContainer) {
			pageHeightPx = pageContainer.getBoundingClientRect().height;
		}
		if (pageHeightPx <= 0) {
			pageHeightPx = 792 * (zoom / 100);
		}
		const textHeight = defaultTextBoxHeightPct(
			activeDoc.defaultSize,
			pageHeightPx,
			zoom,
		);

		const newTextShape = createTextShape(mousePctX, mousePctY, {
			fontFamily: activeDoc.activeFontFamily,
			size: activeDoc.defaultSize,
			style: activeDoc.defaultStyle,
			color: activeDoc.activeColor,
			alignment: activeDoc.activeTextAlignment || "left",
			height: textHeight,
		});
		const newIndex = addShapeToPage(newTextShape);
		activelyEditingIndex = newIndex;
		textEditBaseline = "";
		// Keep single-select + selectedShapes in sync so toolbar alignment/font
		// setters patch this shape immediately while editing.
		const sel = { pageNumber, index: newIndex };
		activeDoc.selectedShape = sel;
		activeDoc.selectedShapes = [sel];
	}

	/** Primary tip only (mouse LMB / pen tip / single touch). Skip eraser & multi-touch. */
	function isPrimaryDrawPointer(e: PointerEvent): boolean {
		if (e.isPrimary === false) return false;
		// Pen eraser barrel often reports button 5 / buttons & 32
		if (e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0)) {
			return false;
		}
		// button 0 = primary; during move buttons may be non-zero
		if (e.type === "pointerdown" && e.button !== 0) return false;
		return true;
	}

	function samplePressure(e: PointerEvent): number {
		// Mouse / non-pressure devices report 0; treat as mid pressure
		if (e.pointerType === "mouse" || e.pressure === 0) return 0.5;
		return Math.min(1, Math.max(0.05, e.pressure));
	}

	function capturePagePointer(e: PointerEvent) {
		const pageContainer = getPageContainer();
		if (!pageContainer) return;
		try {
			pageContainer.setPointerCapture(e.pointerId);
			activePointerId = e.pointerId;
		} catch {
			/* ignore capture failures */
		}
	}

	function releasePagePointer(e?: PointerEvent) {
		const pageContainer = getPageContainer();
		const id = e?.pointerId ?? activePointerId;
		if (pageContainer && id !== null) {
			try {
				if (pageContainer.hasPointerCapture?.(id)) {
					pageContainer.releasePointerCapture(id);
				}
			} catch {
				/* ignore */
			}
		}
		activePointerId = null;
	}

	function handlePointerDown(e: PointerEvent) {
		const pageContainer = getPageContainer();
		const _pageNumber = getPageNumber();
		if (!pageContainer) return;
		if (!isPrimaryDrawPointer(e)) return;

		const targetElement = e.target as HTMLElement;
		if (
			targetElement.closest("input") ||
			targetElement.closest("textarea") ||
			targetElement.closest(".resize-handle-node")
		)
			return;

		// Let the browser handle native PDF text selection (no annotation side-effects)
		if (targetElement.closest(".textLayer")) {
			if (activeDoc.activeTool === "select") {
				activeDoc.selectedShape = null;
			}
			return;
		}

		// Switching away mid-line cancels an unfinished rubber-band
		if (activeDoc.activeTool !== "line" && lineAwaitingEnd) {
			clearLineDrawingState();
		}

		if (activeDoc.activeTool !== "text") {
			// Second line click finalizes; history already pushed on first click
			if (!(activeDoc.activeTool === "line" && lineAwaitingEnd)) {
				pushHistorySnapshot();
			}
		}

		dragPageRect = pageContainer.getBoundingClientRect();
		const rect = dragPageRect;
		const rawX = e.clientX - rect.left;
		const rawY = e.clientY - rect.top;
		const { x: mousePctX, y: mousePctY } = normalizeCoordinates(rawX, rawY);

		if (activeDoc.activeTool === "select") {
			activeDoc.selectedShape = null;
			activeDoc.selectedShapes = [];
			return;
		}

		// Line tool: click start → rubber band → click end
		if (activeDoc.activeTool === "line") {
			e.preventDefault();
			if (!lineAwaitingEnd || !lineStartPct) {
				lineAwaitingEnd = true;
				lineStartPct = { x: mousePctX, y: mousePctY };
				linePreviewPct = { x: mousePctX, y: mousePctY };
				isDrawing = true;
				dragActive = true;
				rawStartX = e.clientX;
				rawStartY = e.clientY;
				rawCurrentX = e.clientX;
				rawCurrentY = e.clientY;
				// No long-lived capture — second click + UI remain free
			} else {
				commitLineShape(lineStartPct, {
					x: mousePctX,
					y: mousePctY,
				});
				isDrawing = false;
				dragActive = false;
				dragPageRect = null;
			}
			return;
		}

		if (
			activeDoc.activeTool === "highlight" ||
			activeDoc.activeTool === "pen"
		) {
			e.preventDefault();
			isDrawing = true;
			liveHighlightPoints = [{ x: mousePctX, y: mousePctY }];

			dragActive = true;
			rawStartX = e.clientX;
			rawStartY = e.clientY;
			rawCurrentX = e.clientX;
			rawCurrentY = e.clientY;
			rawLiveHighlightPoints = [{ x: mousePctX, y: mousePctY }];
			const p = samplePressure(e);
			strokePressureSum = p;
			strokePressureCount = 1;
			capturePagePointer(e);
			return;
		}

		if (
			(activeDoc.activeTool === "signature" ||
				activeDoc.activeTool === "initial") &&
			activeDoc.activeStampDataUrl
		) {
			e.preventDefault();
			handleSignatureOrInitial(mousePctX, mousePctY);
			return;
		}

		if (activeDoc.activeTool === "tick" || activeDoc.activeTool === "dash") {
			e.preventDefault();
			handleTickOrDash(mousePctX, mousePctY);
			return;
		}

		if (activeDoc.activeTool === "text") {
			e.preventDefault();
			handleTextTool(mousePctX, mousePctY);
			return;
		}

		if (isBoxShapeTool(activeDoc.activeTool)) {
			e.preventDefault();
			isDrawing = true;
			startX = e.clientX - rect.left;
			startY = e.clientY - rect.top;
			currentX = startX;
			currentY = startY;

			dragActive = true;
			// Store absolute client coords (matches pointermove) so pen capture stays consistent
			rawStartX = e.clientX;
			rawStartY = e.clientY;
			rawCurrentX = e.clientX;
			rawCurrentY = e.clientY;
			capturePagePointer(e);
		}
	}

	function toggleMultiSelect(pageNumber: number, index: number) {
		const existsIdx = activeDoc.selectedShapes.findIndex(
			(s) => s.pageNumber === pageNumber && s.index === index,
		);
		if (existsIdx > -1) {
			activeDoc.selectedShapes = activeDoc.selectedShapes.filter(
				(_, i) => i !== existsIdx,
			);
		} else {
			activeDoc.selectedShapes = [
				...activeDoc.selectedShapes,
				{ pageNumber, index },
			];
		}
		activeDoc.selectedShape = activeDoc.selectedShapes[0] || null;
	}

	function initShapeMove(e: MouseEvent, index: number) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (activeDoc.activeTool !== "select" || activelyEditingIndex !== null)
			return;
		e.stopPropagation();

		// Shift (and Ctrl/Cmd) multi-select — toggle without starting a drag
		const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
		const isAlreadySelected = activeDoc.selectedShapes.some(
			(s) => s.pageNumber === pageNumber && s.index === index,
		);

		if (hasModifier) {
			toggleMultiSelect(pageNumber, index);
			return;
		} else {
			if (!isAlreadySelected) {
				activeDoc.selectedShapes = [{ pageNumber, index }];
				activeDoc.selectedShape = { pageNumber, index };
			}
		}

		pushHistorySnapshot();
		if (!pageContainer) return;
		const shape = activeDoc.shapes[pageNumber]?.[index];
		if (shape) {
			isMovingShape = true;
			dragStartMouseX = e.clientX;
			dragStartMouseY = e.clientY;

			if (activeDoc.selectedShapes.length > 1) {
				// Group drag: cache all selected shape positions and their DOM elements
				rawGroupInitialPositions = activeDoc.selectedShapes
					.filter((s) => s.pageNumber === pageNumber)
					.map((s) => {
						const sh = activeDoc.shapes[pageNumber]?.[s.index];
						return {
							index: s.index,
							x: sh?.x || 0,
							y: sh?.y || 0,
							points: sh?.points
								? sh.points.map((p) => ({ x: p.x, y: p.y }))
								: undefined,
						};
					});
				groupDragElements = rawGroupInitialPositions
					.map(
						(pos) =>
							pageContainer?.querySelector(
								`[data-shape-idx="${pos.index}"]`,
							) as HTMLElement,
					)
					.filter(Boolean);
				dragTargetElement = null;
			} else {
				// Single-shape drag
				rawGroupInitialPositions = [
					{
						index,
						x: shape.x || 0,
						y: shape.y || 0,
						points: shape.points
							? shape.points.map((p) => ({ x: p.x, y: p.y }))
							: undefined,
					},
				];
				groupDragElements = [];
				dragTargetElement = pageContainer.querySelector(
					`[data-shape-idx="${index}"]`,
				) as HTMLElement;
			}

			dragPageRect = pageContainer.getBoundingClientRect();
			dragActive = true;
			rawStartX = e.clientX;
			rawStartY = e.clientY;
			rawCurrentX = e.clientX;
			rawCurrentY = e.clientY;
		}
	}

	function startTextDrag(e: MouseEvent, index: number) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (activelyEditingIndex !== null) return;
		e.stopPropagation();
		e.preventDefault();

		// Shift/Ctrl/Cmd multi-select for text (same as shapes)
		const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
		if (activeDoc.activeTool === "select" && hasModifier) {
			toggleMultiSelect(pageNumber, index);
			return;
		}

		const isAlreadySelected = activeDoc.selectedShapes.some(
			(s) => s.pageNumber === pageNumber && s.index === index,
		);
		if (!isAlreadySelected || activeDoc.selectedShapes.length <= 1) {
			activeDoc.selectedShape = { pageNumber, index };
			activeDoc.selectedShapes = [{ pageNumber, index }];
		}

		pushHistorySnapshot();

		const shape = activeDoc.shapes[pageNumber]?.[index];
		if (!shape) return;

		const dragStartStartX = e.clientX;
		const dragStartStartY = e.clientY;
		const dragStartInitialX = shape.x;
		const dragStartInitialY = shape.y;

		const handleWindowMouseMove = (moveEvent: MouseEvent) => {
			moveEvent.stopPropagation();
			moveEvent.preventDefault();
			if (!pageContainer) return;
			const rect = pageContainer.getBoundingClientRect();
			const startNorm = normalizeCoordinates(
				dragStartStartX - rect.left,
				dragStartStartY - rect.top,
			);
			const endNorm = normalizeCoordinates(
				moveEvent.clientX - rect.left,
				moveEvent.clientY - rect.top,
			);
			const deltaPctX = endNorm.x - startNorm.x;
			const deltaPctY = endNorm.y - startNorm.y;

			shape.x = clampPct(dragStartInitialX + deltaPctX);
			shape.y = clampPct(dragStartInitialY + deltaPctY);
			activeDoc.shapes = { ...activeDoc.shapes };
		};

		const handleWindowMouseUp = (upEvent: MouseEvent) => {
			upEvent.stopPropagation();
			window.removeEventListener("mousemove", handleWindowMouseMove, true);
			window.removeEventListener("mouseup", handleWindowMouseUp, true);
		};

		window.addEventListener("mousemove", handleWindowMouseMove, true);
		window.addEventListener("mouseup", handleWindowMouseUp, true);
	}

	function redrawCanvas() {
		const pageContainer = getPageContainer();
		if (!pageContainer) return;

		// Case 1: Pen / Highlight drawing
		if (
			isDrawing &&
			(activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")
		) {
			liveHighlightPoints = [...rawLiveHighlightPoints];
		}

		// Case 1b: Line rubber-band preview (percentage space)
		else if (isDrawing && lineAwaitingEnd && activeDoc.activeTool === "line") {
			const rect = dragPageRect || pageContainer.getBoundingClientRect();
			const { x, y } = normalizeCoordinates(
				rawCurrentX - rect.left,
				rawCurrentY - rect.top,
			);
			linePreviewPct = { x, y };
		}

		// Case 2: Shape moving
		else if (isMovingShape && activeDoc.selectedShape) {
			const rect = dragPageRect || pageContainer.getBoundingClientRect();
			const startNorm = normalizeCoordinates(
				rawStartX - rect.left,
				rawStartY - rect.top,
			);
			const endNorm = normalizeCoordinates(
				rawCurrentX - rect.left,
				rawCurrentY - rect.top,
			);
			const deltaPctX = endNorm.x - startNorm.x;
			const deltaPctY = endNorm.y - startNorm.y;
			const deltaX = rawCurrentX - rawStartX;
			const deltaY = rawCurrentY - rawStartY;
			const pageNumber = getPageNumber();
			const shapesList = activeDoc.shapes[pageNumber] || [];

			// Point-based shapes (lines) must move in data space; boxes use CSS transform
			let touchedPoints = false;
			if (rawGroupInitialPositions.length > 0) {
				for (const pos of rawGroupInitialPositions) {
					const shape = shapesList[pos.index];
					if (!shape?.points?.length || !pos.points?.length) continue;
					shape.points = pos.points.map((p) => ({
						x: clampPct(p.x + deltaPctX),
						y: clampPct(p.y + deltaPctY),
					}));
					if (shape.type === "line" && shape.points.length >= 2) {
						const b = lineBoundsFromPoints(shape.points[0], shape.points[1]);
						shape.x = b.x;
						shape.y = b.y;
						shape.width = b.width;
						shape.height = b.height;
					} else {
						shape.x = clampPct(pos.x + deltaPctX);
						shape.y = clampPct(pos.y + deltaPctY);
					}
					touchedPoints = true;
				}
			}

			if (touchedPoints) {
				activeDoc.shapes = { ...activeDoc.shapes };
			}

			if (rawGroupInitialPositions.length > 1 && groupDragElements.length > 0) {
				groupDragElements.forEach((el) => {
					if (el)
						el.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
				});
			} else if (dragTargetElement) {
				dragTargetElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
			}
		}

		// Case 3: Shape resizing / line endpoint drag
		else if (draggingHandle && activeDoc.selectedShape && initialShapeState) {
			const rect = dragPageRect || pageContainer.getBoundingClientRect();
			const { x: mousePctX, y: mousePctY } = normalizeCoordinates(
				rawCurrentX - rect.left,
				rawCurrentY - rect.top,
			);
			const pageNumber = getPageNumber();
			const resizeShape =
				activeDoc.shapes[pageNumber]?.[activeDoc.selectedShape.index];

			// Line endpoints: drag start or end handle
			if (
				resizeShape?.type === "line" &&
				initialLinePoints &&
				initialLinePoints.length >= 2 &&
				(draggingHandle === "line-start" || draggingHandle === "line-end")
			) {
				const next = initialLinePoints.map((p) => ({
					x: p.x,
					y: p.y,
				}));
				const idx = draggingHandle === "line-start" ? 0 : 1;
				next[idx] = {
					x: clampPct(mousePctX),
					y: clampPct(mousePctY),
				};
				resizeShape.points = next;
				const b = lineBoundsFromPoints(next[0], next[1]);
				resizeShape.x = b.x;
				resizeShape.y = b.y;
				resizeShape.width = b.width;
				resizeShape.height = b.height;
				rawResizedShapeCoords = b;
				activeDoc.shapes = { ...activeDoc.shapes };
			} else if (dragTargetElement) {
				// Text boxes: top-left anchor only — force BR geometry (never move x/y)
				const handle = resizeShape?.type === "text" ? "br" : draggingHandle;
				const { x, y, width, height } = computeResizedBounds(
					handle,
					initialShapeState,
					mousePctX,
					mousePctY,
				);

				if (resizeShape?.type === "text") {
					// Lock top-left; only grow width/height so handle stays on the outline
					rawResizedShapeCoords = {
						x: initialShapeState.x,
						y: initialShapeState.y,
						width,
						height,
					};
					dragTargetElement.style.left = `${initialShapeState.x}%`;
					dragTargetElement.style.top = `${initialShapeState.y}%`;
					dragTargetElement.style.width = `${width}%`;
					dragTargetElement.style.height = `${height}%`;
				} else {
					rawResizedShapeCoords = { x, y, width, height };
					dragTargetElement.style.left = `${x}%`;
					dragTargetElement.style.top = `${y}%`;
					dragTargetElement.style.width = `${width}%`;
					dragTargetElement.style.height = `${height}%`;
				}
			}
		}

		// Case 4: Shape drawing
		else if (isDrawing && isBoxShapeTool(activeDoc.activeTool)) {
			const rect = dragPageRect || pageContainer.getBoundingClientRect();
			currentX = rawCurrentX - rect.left;
			currentY = rawCurrentY - rect.top;
		}
	}

	function handlePointerMove(e: PointerEvent) {
		const pageContainer = getPageContainer();
		if (!pageContainer) return;

		// Ignore non-tracked multi-pointer noise while a stroke is captured
		if (
			activePointerId !== null &&
			e.pointerId !== activePointerId &&
			(dragActive || isDrawing)
		) {
			return;
		}

		// Drop unfinished rubber-band if the user switched tools
		if (lineAwaitingEnd && activeDoc.activeTool !== "line") {
			clearLineDrawingState();
			isDrawing = false;
			dragActive = false;
			releasePagePointer(e);
		}

		const rect = dragPageRect || pageContainer.getBoundingClientRect();
		const rawX = e.clientX - rect.left;
		const rawY = e.clientY - rect.top;
		const { x: mousePctX, y: mousePctY } = normalizeCoordinates(rawX, rawY);
		hoverPctX = mousePctX;
		hoverPctY = mousePctY;

		if (dragActive || lineAwaitingEnd) {
			e.preventDefault();
			rawCurrentX = e.clientX;
			rawCurrentY = e.clientY;

			if (
				isDrawing &&
				(activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")
			) {
				rawLiveHighlightPoints.push({ x: mousePctX, y: mousePctY });
				const p = samplePressure(e);
				strokePressureSum += p;
				strokePressureCount += 1;
			}

			// Keep line rubber-band tracking even when dragActive was cleared on leave/re-enter
			if (lineAwaitingEnd && activeDoc.activeTool === "line") {
				linePreviewPct = { x: mousePctX, y: mousePctY };
			}

			if (!animationFrameId) {
				animationFrameId = requestAnimationFrame(() => {
					redrawCanvas();
					animationFrameId = null;
				});
			}
			return;
		}
	}

	function handlePointerUp(e: PointerEvent) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();

		if (
			activePointerId !== null &&
			e.pointerId !== activePointerId &&
			(dragActive || isDrawing)
		) {
			return;
		}

		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		// Line tool uses click-click (not drag-release). Release capture after each click
		// so the rest of the UI stays interactive; rubber-band continues via pointermove.
		if (activeDoc.activeTool === "line" && lineAwaitingEnd) {
			releasePagePointer(e);
			return;
		}

		if (
			isDrawing &&
			(activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")
		) {
			const currentTool = activeDoc.activeTool;
			isDrawing = false;
			dragActive = false;
			dragPageRect = null;
			releasePagePointer(e);

			// Flush any points still only in the raw buffer (last rAF may not have run)
			const points =
				rawLiveHighlightPoints.length > liveHighlightPoints.length
					? [...rawLiveHighlightPoints]
					: liveHighlightPoints;

			if (points.length > 1) {
				// Highlighter ignores toolbar color/thickness (factory forces yellow).
				// Pen optionally scales thickness with stylus pressure.
				let thickness = activeDoc.activeThickness || 3;
				if (currentTool === "pen") {
					const avgPressure =
						strokePressureCount > 0
							? strokePressureSum / strokePressureCount
							: 0.5;
					const pressureScale = 0.55 + avgPressure * 0.9;
					thickness = Math.max(
						1,
						Math.round(thickness * pressureScale * 10) / 10,
					);
				}
				const newFreehand = createFreehandShape(
					currentTool as "highlight" | "pen",
					points,
					{
						color: activeDoc.activeColor,
						thickness,
					},
				);
				const existing = activeDoc.shapes[pageNumber] || [];
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: [...existing, newFreehand],
				};
			}
			liveHighlightPoints = [];
			rawLiveHighlightPoints = [];
			strokePressureSum = 0;
			strokePressureCount = 0;
			return;
		}

		if (isMovingShape && activeDoc.selectedShape) {
			isMovingShape = false;
			dragActive = false;
			dragPageRect = null;
			releasePagePointer(e);

			const rect = pageContainer
				? pageContainer.getBoundingClientRect()
				: { left: 0, top: 0, width: 1, height: 1 };
			const startNorm = normalizeCoordinates(
				dragStartMouseX - rect.left,
				dragStartMouseY - rect.top,
			);
			const endNorm = normalizeCoordinates(
				e.clientX - rect.left,
				e.clientY - rect.top,
			);
			const deltaPctX = endNorm.x - startNorm.x;
			const deltaPctY = endNorm.y - startNorm.y;
			const shapesList = [...(activeDoc.shapes[pageNumber] || [])];

			if (rawGroupInitialPositions.length > 0) {
				// Batch-write coordinate updates (incl. line points) from snapshot
				rawGroupInitialPositions.forEach((pos) => {
					const shape = shapesList[pos.index];
					if (!shape) return;
					if (pos.points?.length) {
						shape.points = pos.points.map((p) => ({
							x: clampPct(p.x + deltaPctX),
							y: clampPct(p.y + deltaPctY),
						}));
						if (shape.type === "line" && shape.points.length >= 2) {
							const b = lineBoundsFromPoints(shape.points[0], shape.points[1]);
							shape.x = b.x;
							shape.y = b.y;
							shape.width = b.width;
							shape.height = b.height;
						} else {
							shape.x = clampPct(pos.x + deltaPctX);
							shape.y = clampPct(pos.y + deltaPctY);
						}
					} else {
						shape.x = clampPct(pos.x + deltaPctX);
						shape.y = clampPct(pos.y + deltaPctY);
					}
				});
				groupDragElements.forEach((el) => {
					if (el) el.style.transform = "";
				});
				if (dragTargetElement) dragTargetElement.style.transform = "";
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: shapesList,
				};
			}

			groupDragElements = [];
			rawGroupInitialPositions = [];
			dragTargetElement = null;
			return;
		}

		if (draggingHandle && activeDoc.selectedShape) {
			dragActive = false;
			dragPageRect = null;
			releasePagePointer(e);
			const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
			const index = activeDoc.selectedShape.index;
			const shape = shapesList[index];
			if (shape && initialShapeState) {
				// Line endpoints already updated live during drag
				if (
					shape.type === "line" &&
					(draggingHandle === "line-start" || draggingHandle === "line-end")
				) {
					// ensure bounds match final points
					if (shape.points && shape.points.length >= 2) {
						const b = lineBoundsFromPoints(shape.points[0], shape.points[1]);
						shape.x = b.x;
						shape.y = b.y;
						shape.width = b.width;
						shape.height = b.height;
					}
				} else {
					const finalW =
						rawResizedShapeCoords.width > 0
							? rawResizedShapeCoords.width
							: initialShapeState.width;
					const finalH =
						rawResizedShapeCoords.height > 0
							? rawResizedShapeCoords.height
							: initialShapeState.height;

					if (shape.type === "text") {
						// Top-left fixed; only BR size changes
						shape.x = initialShapeState.x;
						shape.y = initialShapeState.y;
						shape.width = Math.max(0.5, finalW);
						shape.height = Math.max(0.5, finalH);
					} else {
						const finalX =
							rawResizedShapeCoords.width > 0
								? rawResizedShapeCoords.x
								: initialShapeState.x;
						const finalY =
							rawResizedShapeCoords.height > 0
								? rawResizedShapeCoords.y
								: initialShapeState.y;
						shape.x = finalX;
						shape.y = finalY;
						shape.width = finalW;
						shape.height = finalH;
					}

					if (
						[
							"tick",
							"dash",
							"signature",
							"initial",
							...SHAPE_TYPES_LIST,
						].includes(shape.type) &&
						shape.width &&
						shape.height
					) {
						cacheStampDimensions(shape.type, shape.width, shape.height);
					}
				}
				// Clear live inline overrides so Svelte styles take over cleanly
				if (dragTargetElement) {
					dragTargetElement.style.left = "";
					dragTargetElement.style.top = "";
					dragTargetElement.style.width = "";
					dragTargetElement.style.height = "";
				}
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: shapesList,
				};
			}
			draggingHandle = null;
			initialShapeState = null;
			initialLinePoints = null;
			dragTargetElement = null;
			rawResizedShapeCoords = { x: 0, y: 0, width: 0, height: 0 };
			return;
		}

		if (!isDrawing || !pageContainer || !isBoxShapeTool(activeDoc.activeTool)) {
			dragActive = false;
			dragPageRect = null;
			releasePagePointer(e);
			return;
		}

		isDrawing = false;
		dragActive = false;
		dragPageRect = null;
		releasePagePointer(e);

		const rect = pageContainer.getBoundingClientRect();
		const finalCurrentX = rawCurrentX - rect.left;
		const finalCurrentY = rawCurrentY - rect.top;
		const widthPixels = Math.abs(finalCurrentX - startX);
		const heightPixels = Math.abs(finalCurrentY - startY);

		const boxOpts = {
			color: activeDoc.activeColor,
			thickness: activeDoc.activeThickness,
			lineStyle: activeDoc.activeLineStyle,
		};
		const toolType = activeDoc.activeTool as AnnotationShape["type"];

		let newShape: AnnotationShape;
		if (widthPixels > 2 && heightPixels > 2) {
			// Drag-to-size
			const startNorm = normalizeCoordinates(startX, startY);
			const endNorm = normalizeCoordinates(finalCurrentX, finalCurrentY);
			newShape = createBoxShape(toolType, startNorm, endNorm, boxOpts);
		} else {
			// Click-to-drop: default size = 1.5× zoom level (100% → 150×150px).
			// Pointer is the top-right corner; shape extends left and down.
			const zoom = Math.max(5, Math.abs(getZoomScale()));
			const defaultSizePx = zoom * 1.5;
			const startNorm = normalizeCoordinates(startX - defaultSizePx, startY);
			const endNorm = normalizeCoordinates(startX, startY + defaultSizePx);
			newShape = createBoxShape(toolType, startNorm, endNorm, boxOpts);
		}

		const existing = activeDoc.shapes[pageNumber] || [];
		activeDoc.shapes = {
			...activeDoc.shapes,
			[pageNumber]: [...existing, newShape],
		};
	}

	function initHandleDrag(e: MouseEvent, index: number, handleType: string) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (!pageContainer) return;
		e.stopPropagation();
		e.preventDefault();
		const shape = activeDoc.shapes[pageNumber]?.[index];
		if (!shape) return;

		pushHistorySnapshot();

		// Text boxes only support bottom-right growth (top-left anchor)
		const resolvedHandle = shape.type === "text" ? "br" : handleType;
		draggingHandle = resolvedHandle;

		const box = e.currentTarget
			? (e.currentTarget as HTMLElement).parentElement
			: null;
		dragTargetElement = box;

		let w = shape.width || 0;
		let h = shape.height || 0;
		// If dimensions are missing, seed from the live box so resize doesn't jump from 0
		if (box && (w <= 0 || h <= 0) && shape.type !== "line") {
			const pageRect = pageContainer.getBoundingClientRect();
			const boxRect = box.getBoundingClientRect();
			if (pageRect.width > 0 && pageRect.height > 0) {
				w = Math.max(0.5, (boxRect.width / pageRect.width) * 100);
				h = Math.max(0.5, (boxRect.height / pageRect.height) * 100);
			}
		}

		initialShapeState = {
			x: shape.x,
			y: shape.y,
			width: w,
			height: h,
		};
		initialLinePoints =
			shape.type === "line" && shape.points
				? shape.points.map((p) => ({ x: p.x, y: p.y }))
				: null;

		dragPageRect = pageContainer.getBoundingClientRect();
		dragActive = true;
		rawStartX = e.clientX;
		rawStartY = e.clientY;
		rawCurrentX = e.clientX;
		rawCurrentY = e.clientY;
		rawResizedShapeCoords = {
			x: shape.x,
			y: shape.y,
			width: w,
			height: h,
		};

		// Ensure the box has explicit size from the first drag frame (handle sticks to BR)
		if (box && shape.type !== "line") {
			box.style.left = `${shape.x}%`;
			box.style.top = `${shape.y}%`;
			box.style.width = `${w}%`;
			box.style.height = `${h}%`;
		}
	}

	function handlePointerLeave() {
		isMouseOverPage = false;
		// With pointer capture, leave is non-fatal for in-progress strokes.
		// Keep line rubber-band alive; freehand continues via capture until up.
		if (lineAwaitingEnd || activePointerId !== null) {
			return;
		}
		dragPageRect = null;
		if (isDrawing) {
			isDrawing = false;
			dragActive = false;
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
		}
	}

	function handlePointerEnter() {
		isMouseOverPage = true;
	}

	/** @deprecated Prefer handlePointer* — kept as aliases for any residual callers */
	const handleMouseDown = handlePointerDown as unknown as (
		e: MouseEvent,
	) => void;
	const handleMouseMove = handlePointerMove as unknown as (
		e: MouseEvent,
	) => void;
	const handleMouseUp = handlePointerUp as unknown as (e: MouseEvent) => void;
	const handleMouseLeave = handlePointerLeave;
	const handleMouseEnter = handlePointerEnter;

	function finalizeTextEdit(
		index: number,
		element: HTMLInputElement | HTMLTextAreaElement,
	) {
		const pageNumber = getPageNumber();
		// Strict session match: only the currently editing index may finalize.
		// Stale blurs (memory pick remount, recycled each-nodes, second rAF) used
		// to slip through when activelyEditingIndex was already null and then
		// delete/overwrite a *different* text field whose value happened to match.
		if (activelyEditingIndex !== index) return;

		const existing = activeDoc.shapes[pageNumber] || [];
		const shape = existing[index];
		if (shape?.type !== "text") {
			activelyEditingIndex = null;
			textEditBaseline = "";
			return;
		}

		// Trust the live editor while it is still mounted. If blur unmounted it first
		// (focus race / select-tool click), fall back to bound text then edit baseline
		// so an existing annotation is never accidentally deleted as "empty".
		const finalText = (
			element.isConnected ? element.value : shape.text || textEditBaseline || ""
		).trim();

		// End the session first so any concurrent/stale finalize calls no-op.
		activelyEditingIndex = null;
		const baseline = textEditBaseline;
		textEditBaseline = "";

		// Keep the text object even when empty (user may clear via Backspace).
		// Empty drafts are cleaned when placing a new text box (withoutEmptyTextDrafts).
		const next = existing.slice();
		next[index] = { ...shape, text: finalText };
		activeDoc.shapes = {
			...activeDoc.shapes,
			[pageNumber]: next,
		};
		// Avoid noisy history when nothing changed vs baseline
		if (finalText !== baseline.trim()) {
			pushHistorySnapshot();
		}
	}

	function beginTextEdit(index: number) {
		const pageNumber = getPageNumber();
		const shape = activeDoc.shapes[pageNumber]?.[index];
		textEditBaseline = shape?.text ?? "";
		activelyEditingIndex = index;
		const sel = { pageNumber, index };
		activeDoc.selectedShape = sel;
		activeDoc.selectedShapes = [sel];
	}

	function cancelAnimation() {
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	return {
		get isDrawing() {
			return isDrawing;
		},
		get startX() {
			return startX;
		},
		get startY() {
			return startY;
		},
		get currentX() {
			return currentX;
		},
		get currentY() {
			return currentY;
		},
		get liveHighlightPoints() {
			return liveHighlightPoints;
		},
		get lineAwaitingEnd() {
			return lineAwaitingEnd;
		},
		get lineStartPct() {
			return lineStartPct;
		},
		get linePreviewPct() {
			return linePreviewPct;
		},
		get activelyEditingIndex() {
			return activelyEditingIndex;
		},
		set activelyEditingIndex(v: number | null) {
			activelyEditingIndex = v;
		},
		get isMouseOverPage() {
			return isMouseOverPage;
		},
		get hoverPctX() {
			return hoverPctX;
		},
		get hoverPctY() {
			return hoverPctY;
		},
		get animationFrameId() {
			return animationFrameId;
		},
		normalizeCoordinates,
		getDisplayCoords,
		getDisplayPoints,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		handlePointerLeave,
		handlePointerEnter,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		handleMouseLeave,
		handleMouseEnter,
		initShapeMove,
		startTextDrag,
		initHandleDrag,
		finalizeTextEdit,
		beginTextEdit,
		cancelAnimation,
		clearLineDrawingState,
	};
}

export type PageInteraction = ReturnType<typeof createPageInteraction>;
