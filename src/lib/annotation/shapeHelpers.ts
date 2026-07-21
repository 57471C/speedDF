/**
 * Pure helpers for annotation shapes and multi-selection patches.
 * No document store ownership — callers pass shapes maps in/out.
 */

export type ShapeSelection = { pageNumber: number; index: number };

/** Minimal shape fields these helpers read/write. */
export type ShapeLike = {
	color?: string;
	textColor?: string;
	thickness?: number;
	lineStyle?: string;
	lineEnds?: string;
	fontFamily?: string;
	font?: string;
	alignment?: string;
};

/**
 * True if any selected shape has a different value for the given property.
 */
export function selectionNeedsPropertyUpdate<T extends ShapeLike>(
	shapes: Record<number, T[]>,
	selected: ShapeSelection[],
	property: keyof T,
	value: unknown,
): boolean {
	return selected.some((s) => {
		const shape = shapes[s.pageNumber]?.[s.index];
		return shape != null && shape[property] !== value;
	});
}

/**
 * Returns a new shapes map with `patch` applied to every selected index.
 * Matches prior activeDoc setter behaviour (page lists cloned; multi-select on
 * the same page applied sequentially).
 */
export function patchSelectedShapes<T extends ShapeLike>(
	shapes: Record<number, T[]>,
	selected: ShapeSelection[],
	patch: Partial<T>,
): Record<number, T[]> {
	let next: Record<number, T[]> = { ...shapes };
	for (const s of selected) {
		const list = [...(next[s.pageNumber] || [])];
		if (list[s.index]) {
			list[s.index] = {
				...list[s.index],
				...patch,
			};
			next = {
				...next,
				[s.pageNumber]: list,
			};
		}
	}
	return next;
}
