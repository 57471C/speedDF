/**
 * Align / distribute selected annotation shapes (page-% space).
 * Pure helpers — callers clone shape arrays and push history.
 */

import { lineBoundsFromPoints } from "./toolShapes";
import {
	getShapeBounds,
	unionBounds,
	type RectPct,
	type ShapeBoundsInput,
} from "./shapeBounds";

export type AlignMode =
	| "left"
	| "center"
	| "right"
	| "top"
	| "middle"
	| "bottom";

export type DistributeMode = "horizontal" | "vertical";

export type AlignableShape = ShapeBoundsInput & {
	points?: { x: number; y: number }[];
	type?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
};

/** Translate a shape by (dx, dy) in page-%, updating points + box fields. */
export function translateShape<T extends AlignableShape>(
	shape: T,
	dx: number,
	dy: number,
): T {
	const next = { ...shape } as T;
	if (next.points?.length) {
		next.points = next.points.map((p) => ({
			x: p.x + dx,
			y: p.y + dy,
		}));
		if (next.type === "line" && next.points.length >= 2) {
			const b = lineBoundsFromPoints(next.points[0], next.points[1]);
			next.x = b.x;
			next.y = b.y;
			next.width = b.width;
			next.height = b.height;
		} else {
			next.x = (shape.x ?? 0) + dx;
			next.y = (shape.y ?? 0) + dy;
		}
	} else {
		next.x = (shape.x ?? 0) + dx;
		next.y = (shape.y ?? 0) + dy;
	}
	return next;
}

/**
 * Align shapes at the given indices to the selection union bounds.
 * Returns a new array (unselected entries are shared references).
 */
export function alignShapes<T extends AlignableShape>(
	shapes: T[],
	indices: number[],
	mode: AlignMode,
): T[] {
	if (indices.length < 2) return shapes;
	const boundsList: RectPct[] = [];
	const pairs: { index: number; bounds: RectPct }[] = [];
	for (const index of indices) {
		const shape = shapes[index];
		if (!shape) continue;
		const bounds = getShapeBounds(shape);
		boundsList.push(bounds);
		pairs.push({ index, bounds });
	}
	if (pairs.length < 2) return shapes;

	const union = unionBounds(boundsList);
	const next = shapes.slice();

	for (const { index, bounds } of pairs) {
		const shape = next[index];
		if (!shape) continue;
		let dx = 0;
		let dy = 0;
		switch (mode) {
			case "left":
				dx = union.x - bounds.x;
				break;
			case "center":
				dx = union.x + union.width / 2 - (bounds.x + bounds.width / 2);
				break;
			case "right":
				dx = union.x + union.width - (bounds.x + bounds.width);
				break;
			case "top":
				dy = union.y - bounds.y;
				break;
			case "middle":
				dy = union.y + union.height / 2 - (bounds.y + bounds.height / 2);
				break;
			case "bottom":
				dy = union.y + union.height - (bounds.y + bounds.height);
				break;
		}
		if (dx !== 0 || dy !== 0) {
			next[index] = translateShape(shape, dx, dy);
		}
	}
	return next;
}

/**
 * Distribute shapes evenly along an axis between the extreme pair.
 * Extremes stay fixed; intermediate centers are spaced evenly.
 * Requires 3+ shapes (with 2 there is nothing to redistribute).
 */
export function distributeShapes<T extends AlignableShape>(
	shapes: T[],
	indices: number[],
	mode: DistributeMode,
): T[] {
	if (indices.length < 3) return shapes;

	const pairs: { index: number; bounds: RectPct; center: number }[] = [];
	for (const index of indices) {
		const shape = shapes[index];
		if (!shape) continue;
		const bounds = getShapeBounds(shape);
		const center =
			mode === "horizontal"
				? bounds.x + bounds.width / 2
				: bounds.y + bounds.height / 2;
		pairs.push({ index, bounds, center });
	}
	if (pairs.length < 3) return shapes;

	pairs.sort((a, b) => a.center - b.center);
	const first = pairs[0];
	const last = pairs[pairs.length - 1];
	const span = last.center - first.center;
	if (Math.abs(span) < 1e-9) return shapes;

	const step = span / (pairs.length - 1);
	const next = shapes.slice();

	for (let i = 1; i < pairs.length - 1; i++) {
		const { index, bounds, center } = pairs[i];
		const shape = next[index];
		if (!shape) continue;
		const target = first.center + step * i;
		const delta = target - center;
		if (mode === "horizontal") {
			next[index] = translateShape(shape, delta, 0);
		} else {
			next[index] = translateShape(shape, 0, delta);
		}
		// silence unused bounds
		void bounds;
	}
	return next;
}

/** Union bounds for selected indices (storage page-% space). */
export function selectionUnionBounds(
	shapes: ShapeBoundsInput[],
	indices: number[],
): RectPct {
	const rects: RectPct[] = [];
	for (const index of indices) {
		const shape = shapes[index];
		if (shape) rects.push(getShapeBounds(shape));
	}
	return unionBounds(rects);
}
