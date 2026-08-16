/**
 * Page /Rotate + session viewport rotation helpers.
 * pdf.js TextLayer positions glyphs in unrotated page space and relies on
 * `data-main-rotation` CSS to match the canvas viewport.
 */

/** Snap to 0 / 90 / 180 / 270. */
export function normalizePageRotate(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

/** Viewport rotation passed to pdf.js getViewport + TextLayer. */
export function combinedPageRotation(
	pageRotate: number,
	sessionRotate: number,
): number {
	return normalizePageRotate(pageRotate + sessionRotate);
}

/** True when displayed width/height are swapped vs the unrotated media box. */
export function isQuarterTurn(deg: number): boolean {
	const n = normalizePageRotate(deg);
	return n === 90 || n === 270;
}

/**
 * Bake a session rotation into an existing PDF /Rotate value.
 * No-op when the session offset is 0 so we never rewrite a page needlessly.
 */
export function nextPageRotateDegrees(
	existingAngle: number,
	sessionAngle: number,
): number | null {
	const extra = normalizePageRotate(sessionAngle);
	if (extra === 0) return null;
	return normalizePageRotate(existingAngle + extra);
}
