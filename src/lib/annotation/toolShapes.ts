/**
 * Pure factories for tool-created annotation shapes.
 * No store ownership — callers commit shapes to activeDoc.
 */

import type { AnnotationShape } from "../../pdfStore.svelte";
import { getGhostDimensions } from "./ghostDimensions";

export function createSignatureOrInitialShape(
	toolType: "signature" | "initial",
	mousePctX: number,
	mousePctY: number,
	opts: {
		ghostW: number;
		ghostH: number;
		dataUrl: string | null | undefined;
	},
): AnnotationShape {
	return {
		type: toolType,
		x: mousePctX - opts.ghostW / 2,
		y: mousePctY - opts.ghostH / 2,
		width: opts.ghostW,
		height: opts.ghostH,
		dataUrl: opts.dataUrl ?? undefined,
	};
}

export function createTickOrDashShape(
	toolType: "tick" | "dash",
	mousePctX: number,
	mousePctY: number,
	color: string,
): AnnotationShape {
	const dims = getGhostDimensions(toolType);
	return {
		type: toolType,
		x: mousePctX - dims.w / 2,
		y: mousePctY - dims.h / 2,
		width: dims.w,
		height: dims.h,
		color,
	};
}

/** Default text box width (% of page) — top-left anchored; grow only via BR handle. */
export const DEFAULT_TEXT_BOX_W = 20;

/**
 * Fallback single-line height (% of page) when page metrics are unavailable.
 * Prefer {@link defaultTextBoxHeightPct} with live page height + font size.
 */
export const DEFAULT_TEXT_BOX_H = 1.6;

/**
 * One row of text as a % of page height.
 * Matches AnnotationLayer CSS: font-size = sizePx * (zoomScale/100).
 * Includes a small fixed pad for textarea p-0.5 (2px top + 2px bottom).
 */
export function defaultTextBoxHeightPct(
	fontSize: number | undefined,
	pageHeightPx: number,
	zoomScale: number,
): number {
	const size = Math.max(6, fontSize ?? 12);
	const scale = Math.max(0.1, Math.abs(zoomScale) / 100);
	// Exactly one em row at the rendered font size
	const linePx = size * scale;
	const padPx = 4; // p-0.5 top+bottom in CSS px
	const pct = ((linePx + padPx) / Math.max(1, pageHeightPx)) * 100;
	// Keep a usable minimum so the caret is still clickable
	return Math.max(0.4, pct);
}

export function createTextShape(
	mousePctX: number,
	mousePctY: number,
	opts: {
		fontFamily: AnnotationShape["fontFamily"] | string | undefined;
		size: number | undefined;
		style: AnnotationShape["style"] | string | undefined;
		color: string;
		/** Horizontal text alignment for the box (defaults to left). */
		alignment?: AnnotationShape["alignment"];
		/** Optional override; defaults keep a real BR-resizable box from first paint. */
		width?: number;
		height?: number;
	},
): AnnotationShape {
	return {
		type: "text",
		x: mousePctX,
		y: mousePctY,
		// Always size the box so the outline and BR handle share one geometry
		width: opts.width ?? DEFAULT_TEXT_BOX_W,
		height: opts.height ?? DEFAULT_TEXT_BOX_H,
		text: "",
		font: opts.fontFamily as AnnotationShape["font"],
		fontFamily: opts.fontFamily as AnnotationShape["fontFamily"],
		size: opts.size,
		style: (opts.style as AnnotationShape["style"]) || "Normal",
		color: opts.color,
		textColor: opts.color,
		alignment: opts.alignment || "left",
	};
}

export function createBoxShape(
	toolType: AnnotationShape["type"],
	startPct: { x: number; y: number },
	endPct: { x: number; y: number },
	opts: {
		color: string;
		thickness: number;
		lineStyle: AnnotationShape["lineStyle"];
	},
): AnnotationShape {
	return {
		type: toolType,
		x: Math.min(startPct.x, endPct.x),
		y: Math.min(startPct.y, endPct.y),
		width: Math.abs(endPct.x - startPct.x),
		height: Math.abs(endPct.y - startPct.y),
		color: opts.color,
		thickness: opts.thickness,
		lineStyle: opts.lineStyle,
	};
}

export function createFreehandShape(
	toolType: "highlight" | "pen",
	points: { x: number; y: number }[],
	opts: { color: string; thickness: number },
): AnnotationShape {
	return {
		type: toolType,
		x: points[0].x,
		y: points[0].y,
		points: [...points],
		color: opts.color,
		thickness: opts.thickness,
	};
}

/** True when page has an empty draft text box that should be cleared before placing another. */
export function hasEmptyTextDraft(
	shapes: AnnotationShape[] | undefined,
): boolean {
	return (shapes || []).some(
		(s) =>
			s && s.type === "text" && (!s.text || s.text.trim().length === 0),
	);
}

export function withoutEmptyTextDrafts(
	shapes: AnnotationShape[],
): AnnotationShape[] {
	return shapes.filter(
		(s) =>
			!(s && s.type === "text" && (!s.text || s.text.trim().length === 0)),
	);
}
