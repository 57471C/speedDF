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

/** Fixed highlighter look — never inherits line/pen color or thickness. */
export const HIGHLIGHT_COLOR = "#fff200";
/** ViewBox-% stroke width for highlighter ink (thick translucent marker). */
export const HIGHLIGHT_STROKE_WIDTH = 2.0;
export const HIGHLIGHT_OPACITY = 0.42;

export function createFreehandShape(
	toolType: "highlight" | "pen",
	points: { x: number; y: number }[],
	opts: { color: string; thickness: number },
): AnnotationShape {
	// Highlighter always neon yellow; color/thickness from the toolbar are ignored
	if (toolType === "highlight") {
		return {
			type: "highlight",
			x: points[0].x,
			y: points[0].y,
			points: [...points],
			color: HIGHLIGHT_COLOR,
			thickness: HIGHLIGHT_STROKE_WIDTH,
		};
	}
	return {
		type: toolType,
		x: points[0].x,
		y: points[0].y,
		points: [...points],
		color: opts.color,
		thickness: opts.thickness,
	};
}

export type LineEnds = "plain" | "end" | "both";

/** Axis-aligned bounds from two percentage endpoints. */
export function lineBoundsFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
	return {
		x: Math.min(start.x, end.x),
		y: Math.min(start.y, end.y),
		width: Math.abs(end.x - start.x),
		height: Math.abs(end.y - start.y),
	};
}

/**
 * Straight vector line from start → end (percentage page space).
 * `points[0]` is the start; `points[1]` is the end (arrow tip when ends ≠ plain).
 */
export function createLineShape(
	start: { x: number; y: number },
	end: { x: number; y: number },
	opts: {
		color: string;
		thickness: number;
		lineStyle: AnnotationShape["lineStyle"];
		lineEnds?: LineEnds;
	},
): AnnotationShape {
	const bounds = lineBoundsFromPoints(start, end);
	return {
		type: "line",
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		points: [
			{ x: start.x, y: start.y },
			{ x: end.x, y: end.y },
		],
		color: opts.color,
		thickness: opts.thickness,
		lineStyle: opts.lineStyle,
		lineEnds: opts.lineEnds || "plain",
	};
}

/**
 * Arrowhead length in page-% space, scaled with stroke thickness.
 * Slightly longer so slender heads still read past the stroke cap.
 */
export function arrowHeadSizePct(thickness: number | undefined): number {
	return Math.max(1.55, (thickness || 3) * 0.5);
}

/**
 * Filled arrowhead polygon (percentage space) pointing toward `tip` from `from`.
 * Returns three vertices for SVG polygon / canvas path.
 * Narrow wing angle (slender chevron) rather than a wide triangle.
 */
export function arrowHeadVertices(
	from: { x: number; y: number },
	tip: { x: number; y: number },
	sizePct = 1.6,
): [
	{ x: number; y: number },
	{ x: number; y: number },
	{ x: number; y: number },
] {
	const dx = tip.x - from.x;
	const dy = tip.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const px = -uy;
	const py = ux;
	// Base sits behind the tip; narrow wings = more acute / slender angle
	const baseX = tip.x - ux * sizePct;
	const baseY = tip.y - uy * sizePct;
	const wing = sizePct * 0.32;
	return [
		{ x: tip.x, y: tip.y },
		{ x: baseX + px * wing, y: baseY + py * wing },
		{ x: baseX - px * wing, y: baseY - py * wing },
	];
}

/**
 * Stroke endpoints shortened to the arrow-head base(s) so the line does not
 * protrude past the tip. Geometry points (handles/export tips) stay unchanged.
 */
export function lineStrokeEndpoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
	lineEnds: LineEnds | string | undefined,
	sizePct: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
	const ends = lineEnds || "plain";
	if (ends === "plain" || sizePct <= 0) {
		return { start, end };
	}
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const len = Math.hypot(dx, dy) || 1;
	// Never shorten more than ~45% of the segment so tiny lines still draw.
	const maxTrim = len * 0.45;
	const trim = Math.min(sizePct, maxTrim);
	const ux = dx / len;
	const uy = dy / len;
	let s = start;
	let e = end;
	if (ends === "end" || ends === "both") {
		e = { x: end.x - ux * trim, y: end.y - uy * trim };
	}
	if (ends === "both") {
		s = { x: start.x + ux * trim, y: start.y + uy * trim };
	}
	return { start: s, end: e };
}

/** True when page has an empty draft text box that should be cleared before placing another. */
export function hasEmptyTextDraft(
	shapes: AnnotationShape[] | undefined,
): boolean {
	return (shapes || []).some(
		(s) => s && s.type === "text" && (!s.text || s.text.trim().length === 0),
	);
}

export function withoutEmptyTextDrafts(
	shapes: AnnotationShape[],
): AnnotationShape[] {
	return shapes.filter(
		(s) => !(s && s.type === "text" && (!s.text || s.text.trim().length === 0)),
	);
}
