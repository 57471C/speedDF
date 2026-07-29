/**
 * Axis-aligned bounds and hit-testing for annotation shapes (page-% space).
 * Pure helpers — no document store ownership.
 */

import { lineBoundsFromPoints } from "./toolShapes";

export type RectPct = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ShapeBoundsInput = {
	type?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	points?: { x: number; y: number }[];
};

/** True when two axis-aligned rects intersect (edge-touch counts). */
export function rectsIntersect(a: RectPct, b: RectPct): boolean {
	return !(
		a.x + a.width < b.x ||
		b.x + b.width < a.x ||
		a.y + a.height < b.y ||
		b.y + b.height < a.y
	);
}

/**
 * Bounding box of a freehand/polyline point list in page-%.
 * Degenerate (0–1 pts) falls back to a tiny box at the first point or origin.
 */
export function boundsFromPoints(
	points: { x: number; y: number }[] | undefined,
): RectPct {
	if (!points || points.length === 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}
	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = points[0].x;
	let maxY = points[0].y;
	for (let i = 1; i < points.length; i++) {
		const p = points[i];
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
}

/**
 * Axis-aligned bounds for any annotation shape in storage (page-%) space.
 * Lines use endpoint bounds; freehand uses point hull; boxes use x/y/w/h.
 */
export function getShapeBounds(shape: ShapeBoundsInput): RectPct {
	if (shape.type === "line" && shape.points && shape.points.length >= 2) {
		return lineBoundsFromPoints(shape.points[0], shape.points[1]);
	}
	if (
		(shape.type === "pen" || shape.type === "highlight") &&
		shape.points &&
		shape.points.length > 0
	) {
		return boundsFromPoints(shape.points);
	}
	return {
		x: shape.x,
		y: shape.y,
		width: Math.max(0, shape.width ?? 0),
		height: Math.max(0, shape.height ?? 0),
	};
}

/** Union of one or more rects. Empty list → zero rect. */
export function unionBounds(rects: RectPct[]): RectPct {
	if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let minX = rects[0].x;
	let minY = rects[0].y;
	let maxX = rects[0].x + rects[0].width;
	let maxY = rects[0].y + rects[0].height;
	for (let i = 1; i < rects.length; i++) {
		const r = rects[i];
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
}

/**
 * Indices of shapes whose bounds intersect `marquee` (page-% storage space).
 */
export function indicesIntersectingMarquee(
	shapes: ShapeBoundsInput[],
	marquee: RectPct,
): number[] {
	const out: number[] = [];
	// Normalize marquee so width/height are non-negative
	const m: RectPct = {
		x: marquee.width < 0 ? marquee.x + marquee.width : marquee.x,
		y: marquee.height < 0 ? marquee.y + marquee.height : marquee.y,
		width: Math.abs(marquee.width),
		height: Math.abs(marquee.height),
	};
	if (m.width < 0.05 && m.height < 0.05) return out;
	for (let i = 0; i < shapes.length; i++) {
		const shape = shapes[i];
		if (!shape) continue;
		if (rectsIntersect(getShapeBounds(shape), m)) {
			out.push(i);
		}
	}
	return out;
}
