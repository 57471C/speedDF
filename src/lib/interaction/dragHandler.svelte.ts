/**
 * Page-level drag, selection, and pointer interaction for WorkspacePage.
 * Owns interaction session state; document mutations go through activeDoc.
 */

import {
	activeDoc,
	type AnnotationShape,
	pushHistorySnapshot,
} from "../../pdfStore.svelte";
import { cacheStampDimensions } from "../annotation/ghostDimensions";
import {
	createBoxShape,
	createFreehandShape,
	createSignatureOrInitialShape,
	createTextShape,
	createTickOrDashShape,
	hasEmptyTextDraft,
	withoutEmptyTextDrafts,
} from "../annotation/toolShapes";
import {
	getDisplayCoords as getDisplayCoordsPure,
	getDisplayPoints as getDisplayPointsPure,
	normalizeCoordinates as normalizeCoordinatesPure,
	type RectPct,
	type PointPct,
} from "./coordinates";
import { clampPct, computeResizedBounds } from "./resizeMath";
import { isBoxShapeTool, SHAPE_TYPES_LIST } from "./shapeTypes";

export { SHAPE_TYPES_LIST, isBoxShapeTool } from "./shapeTypes";

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

	let activelyEditingIndex = $state<number | null>(null);
	let draggingHandle = $state<string | null>(null);
	let initialShapeState = $state<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
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
	// Multi-select group drag cache
	let rawGroupInitialPositions: { index: number; x: number; y: number }[] =
		[];
	let groupDragElements: HTMLElement[] = [];

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

	function normalizeCoordinates(
		rawX: number,
		rawY: number,
	): PointPct {
		const pageContainer = getPageContainer();
		if (activeDoc.fileType === "image") {
			return normalizeCoordinatesPure(
				rawX,
				rawY,
				buildNormalizeCtx(1, 1),
			);
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

		const newTextShape = createTextShape(mousePctX, mousePctY, {
			fontFamily: activeDoc.activeFontFamily,
			size: activeDoc.defaultSize,
			style: activeDoc.defaultStyle,
			color: activeDoc.activeColor,
		});
		const newIndex = addShapeToPage(newTextShape);
		activelyEditingIndex = newIndex;
		activeDoc.selectedShape = { pageNumber, index: newIndex };
	}

	function handleMouseDown(e: MouseEvent) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (!pageContainer) return;
		const targetElement = e.target as HTMLElement;
		if (
			targetElement.closest("input") ||
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

		if (activeDoc.activeTool !== "text") {
			pushHistorySnapshot();
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
			isDrawing = true;
			startX = e.clientX - rect.left;
			startY = e.clientY - rect.top;
			currentX = startX;
			currentY = startY;

			dragActive = true;
			rawStartX = startX;
			rawStartY = startY;
			rawCurrentX = startX;
			rawCurrentY = startY;
		}
	}

	function initShapeMove(e: MouseEvent, index: number) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (activeDoc.activeTool !== "select" || activelyEditingIndex !== null)
			return;
		e.stopPropagation();

		const hasModifier = e.ctrlKey || e.metaKey;
		const isAlreadySelected = activeDoc.selectedShapes.some(
			(s) => s.pageNumber === pageNumber && s.index === index,
		);

		if (hasModifier) {
			// Toggle membership in the multi-select collection
			const existsIdx = activeDoc.selectedShapes.findIndex(
				(s) => s.pageNumber === pageNumber && s.index === index,
			);
			if (existsIdx > -1) {
				activeDoc.selectedShapes.splice(existsIdx, 1);
			} else {
				activeDoc.selectedShapes.push({ pageNumber, index });
			}
			activeDoc.selectedShape = activeDoc.selectedShapes[0] || null;
			return; // Toggling selection should not initiate a drag
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
						return { index: s.index, x: sh?.x || 0, y: sh?.y || 0 };
					});
				groupDragElements = rawGroupInitialPositions
					.map(
						(pos) =>
							pageContainer!.querySelector(
								`[data-shape-idx="${pos.index}"]`,
							) as HTMLElement,
					)
					.filter(Boolean);
				dragTargetElement = null;
			} else {
				// Single-shape drag
				rawGroupInitialPositions = [];
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

		activeDoc.selectedShape = { pageNumber, index };
		activeDoc.selectedShapes = [{ pageNumber, index }];

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
			window.removeEventListener(
				"mousemove",
				handleWindowMouseMove,
				true,
			);
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
			(activeDoc.activeTool === "highlight" ||
				activeDoc.activeTool === "pen")
		) {
			liveHighlightPoints = [...rawLiveHighlightPoints];
		}

		// Case 2: Shape moving
		else if (isMovingShape && activeDoc.selectedShape) {
			const deltaX = rawCurrentX - rawStartX;
			const deltaY = rawCurrentY - rawStartY;
			if (
				rawGroupInitialPositions.length > 1 &&
				groupDragElements.length > 0
			) {
				// Group drag: apply uniform displacement to all selected elements
				groupDragElements.forEach((el) => {
					if (el)
						el.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
				});
			} else if (dragTargetElement) {
				dragTargetElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
			}
		}

		// Case 3: Shape resizing
		else if (
			draggingHandle &&
			activeDoc.selectedShape &&
			initialShapeState &&
			dragTargetElement
		) {
			const rect =
				dragPageRect || pageContainer.getBoundingClientRect();
			const { x: mousePctX, y: mousePctY } = normalizeCoordinates(
				rawCurrentX - rect.left,
				rawCurrentY - rect.top,
			);
			const { x, y, width, height } = computeResizedBounds(
				draggingHandle,
				initialShapeState,
				mousePctX,
				mousePctY,
			);

			rawResizedShapeCoords = { x, y, width, height };

			dragTargetElement.style.left = `${x}%`;
			dragTargetElement.style.top = `${y}%`;
			dragTargetElement.style.width = `${width}%`;
			dragTargetElement.style.height = `${height}%`;
		}

		// Case 4: Shape drawing
		else if (isDrawing && isBoxShapeTool(activeDoc.activeTool)) {
			const rect =
				dragPageRect || pageContainer.getBoundingClientRect();
			currentX = rawCurrentX - rect.left;
			currentY = rawCurrentY - rect.top;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		const pageContainer = getPageContainer();
		if (!pageContainer) return;
		const rect = dragPageRect || pageContainer.getBoundingClientRect();
		const rawX = e.clientX - rect.left;
		const rawY = e.clientY - rect.top;
		const { x: mousePctX, y: mousePctY } = normalizeCoordinates(
			rawX,
			rawY,
		);
		hoverPctX = mousePctX;
		hoverPctY = mousePctY;

		if (dragActive) {
			e.preventDefault();
			rawCurrentX = e.clientX;
			rawCurrentY = e.clientY;

			if (
				isDrawing &&
				(activeDoc.activeTool === "highlight" ||
					activeDoc.activeTool === "pen")
			) {
				rawLiveHighlightPoints.push({ x: mousePctX, y: mousePctY });
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

	function handleMouseUp(e: MouseEvent) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();

		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		if (
			isDrawing &&
			(activeDoc.activeTool === "highlight" ||
				activeDoc.activeTool === "pen")
		) {
			const currentTool = activeDoc.activeTool;
			isDrawing = false;
			dragActive = false;
			dragPageRect = null;

			if (liveHighlightPoints.length > 1) {
				const newFreehand = createFreehandShape(
					currentTool as "highlight" | "pen",
					liveHighlightPoints,
					{
						color: activeDoc.activeColor,
						thickness: activeDoc.activeThickness,
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
			return;
		}

		if (isMovingShape && activeDoc.selectedShape) {
			isMovingShape = false;
			dragActive = false;
			dragPageRect = null;

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

			if (
				rawGroupInitialPositions.length > 1 &&
				groupDragElements.length > 0
			) {
				// Batch-write group coordinate updates in a single store commit
				rawGroupInitialPositions.forEach((pos) => {
					const shape = shapesList[pos.index];
					if (shape) {
						shape.x = clampPct(pos.x + deltaPctX);
						shape.y = clampPct(pos.y + deltaPctY);
					}
				});
				groupDragElements.forEach((el) => {
					if (el) el.style.transform = "";
				});
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: shapesList,
				};
			} else if (dragTargetElement && pageContainer) {
				dragTargetElement.style.transform = "";
				const index = activeDoc.selectedShape.index;
				const shape = shapesList[index];
				if (shape) {
					shape.x = clampPct(shape.x + deltaPctX);
					shape.y = clampPct(shape.y + deltaPctY);
					activeDoc.shapes = {
						...activeDoc.shapes,
						[pageNumber]: shapesList,
					};
				}
			}

			groupDragElements = [];
			rawGroupInitialPositions = [];
			dragTargetElement = null;
			return;
		}

		if (draggingHandle && activeDoc.selectedShape) {
			dragActive = false;
			dragPageRect = null;
			const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
			const index = activeDoc.selectedShape.index;
			const shape = shapesList[index];
			if (shape && initialShapeState) {
				const finalX =
					rawResizedShapeCoords.width > 0
						? rawResizedShapeCoords.x
						: initialShapeState.x;
				const finalY =
					rawResizedShapeCoords.height > 0
						? rawResizedShapeCoords.y
						: initialShapeState.y;
				const finalW =
					rawResizedShapeCoords.width > 0
						? rawResizedShapeCoords.width
						: initialShapeState.width;
				const finalH =
					rawResizedShapeCoords.height > 0
						? rawResizedShapeCoords.height
						: initialShapeState.height;

				shape.x = finalX;
				shape.y = finalY;
				shape.width = finalW;
				shape.height = finalH;

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
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: shapesList,
				};
			}
			draggingHandle = null;
			initialShapeState = null;
			dragTargetElement = null;
			rawResizedShapeCoords = { x: 0, y: 0, width: 0, height: 0 };
			return;
		}

		if (
			!isDrawing ||
			!pageContainer ||
			!isBoxShapeTool(activeDoc.activeTool)
		) {
			dragActive = false;
			dragPageRect = null;
			return;
		}

		isDrawing = false;
		dragActive = false;
		dragPageRect = null;

		const rect = pageContainer.getBoundingClientRect();
		const finalCurrentX = rawCurrentX - rect.left;
		const finalCurrentY = rawCurrentY - rect.top;
		const widthPixels = Math.abs(finalCurrentX - startX);
		const heightPixels = Math.abs(finalCurrentY - startY);

		if (widthPixels > 2 && heightPixels > 2) {
			const startNorm = normalizeCoordinates(startX, startY);
			const endNorm = normalizeCoordinates(
				finalCurrentX,
				finalCurrentY,
			);
			const newShape = createBoxShape(
				activeDoc.activeTool as AnnotationShape["type"],
				startNorm,
				endNorm,
				{
					color: activeDoc.activeColor,
					thickness: activeDoc.activeThickness,
					lineStyle: activeDoc.activeLineStyle,
				},
			);
			const existing = activeDoc.shapes[pageNumber] || [];
			activeDoc.shapes = {
				...activeDoc.shapes,
				[pageNumber]: [...existing, newShape],
			};
		}
	}

	function initHandleDrag(
		e: MouseEvent,
		index: number,
		handleType: string,
	) {
		const pageContainer = getPageContainer();
		const pageNumber = getPageNumber();
		if (!pageContainer) return;
		e.stopPropagation();
		e.preventDefault();
		draggingHandle = handleType;
		const shape = activeDoc.shapes[pageNumber]?.[index];
		if (shape) {
			initialShapeState = {
				x: shape.x,
				y: shape.y,
				width: shape.width || 0,
				height: shape.height || 0,
			};
			dragTargetElement = e.currentTarget
				? (e.currentTarget as HTMLElement).parentElement
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
				width: shape.width || 0,
				height: shape.height || 0,
			};
		}
	}

	function handleMouseLeave() {
		isMouseOverPage = false;
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

	function handleMouseEnter() {
		isMouseOverPage = true;
	}

	function finalizeTextEdit(
		index: number,
		element: HTMLInputElement | HTMLTextAreaElement,
	) {
		const pageNumber = getPageNumber();
		if (
			!element.isConnected ||
			(activelyEditingIndex !== null && activelyEditingIndex !== index)
		)
			return;
		const existing = activeDoc.shapes[pageNumber] || [];
		if (existing[index]) {
			const textInputString = element.value;
			if (textInputString.trim().length === 0) {
				// STEP A: Explicitly isolate and clear active tracking variables first so nothing points to the target index
				activeDoc.selectedShape = null;
				activelyEditingIndex = null;

				// STEP B: Perform the state array cleanup pass only after trackers are safe
				const updated = existing.filter((_, idx) => idx !== index);
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: updated,
				};
			} else {
				existing[index].text = textInputString.trim();
				activeDoc.shapes = {
					...activeDoc.shapes,
					[pageNumber]: [...existing],
				};
				activelyEditingIndex = null;
				pushHistorySnapshot();
			}
		} else {
			activelyEditingIndex = null;
		}
	}

	function beginTextEdit(index: number) {
		activelyEditingIndex = index;
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
	};
}

export type PageInteraction = ReturnType<typeof createPageInteraction>;
