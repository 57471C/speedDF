/**
 * Pure resize-handle geometry for annotation bounding boxes (percentage space).
 */

export type ShapeBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Compute new bounds while dragging a corner handle toward mousePct.
 * Matches prior WorkspacePage resize behaviour (min size 0.1%).
 */
export function computeResizedBounds(
	handle: string,
	initial: ShapeBounds,
	mousePctX: number,
	mousePctY: number,
): ShapeBounds {
	let x = initial.x;
	let y = initial.y;
	let width = initial.width;
	let height = initial.height;

	if (handle === "br") {
		width = Math.max(0.1, mousePctX - initial.x);
		height = Math.max(0.1, mousePctY - initial.y);
	} else if (handle === "tl") {
		const r = initial.x + initial.width;
		const b = initial.y + initial.height;
		x = Math.min(r - 0.1, Math.max(0, mousePctX));
		y = Math.min(b - 0.1, Math.max(0, mousePctY));
		width = r - x;
		height = b - y;
	} else if (handle === "tr") {
		const b = initial.y + initial.height;
		y = Math.min(b - 0.1, Math.max(0, mousePctY));
		width = Math.max(0.1, mousePctX - initial.x);
		height = b - y;
	} else if (handle === "bl") {
		const r = initial.x + initial.width;
		x = Math.min(r - 0.1, Math.max(0, mousePctX));
		width = r - x;
		height = Math.max(0.1, mousePctY - initial.y);
	}

	return { x, y, width, height };
}

/** Clamp a percentage coordinate to [0, 100]. */
export function clampPct(value: number): number {
	return Math.max(0, Math.min(100, value));
}
