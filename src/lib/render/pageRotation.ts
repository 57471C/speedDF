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

export type FlattenTextOptions = {
	shape: {
		x: number;
		y: number;
		width?: number;
		height?: number;
		alignment?: "left" | "center" | "right" | string;
	};
	pageWidth: number;
	pageHeight: number;
	rotationAngle: number;
	fontSize: number;
	ascent: number;
	textWidth: number;
};

export type FlattenedTextPlacement = {
	x: number;
	y: number;
	rotateDegrees: number;
};

/**
 * Transforms an overlay text annotation (stored as % of visible page box) into
 * PDF unrotated coordinate space (points from bottom-left) and angle for drawText.
 */
export function computeFlattenedTextPosition(
	opts: FlattenTextOptions,
): FlattenedTextPlacement {
	const {
		shape,
		pageWidth,
		pageHeight,
		rotationAngle,
		fontSize,
		ascent,
		textWidth,
	} = opts;

	const rotation = normalizePageRotate(rotationAngle);
	const isQuarter = isQuarterTurn(rotation);
	const visibleWidth = isQuarter ? pageHeight : pageWidth;
	const visibleHeight = isQuarter ? pageWidth : pageHeight;

	const u = (shape.x / 100) * visibleWidth;
	const v = (shape.y / 100) * visibleHeight;
	const boxW = ((shape.width ?? 0) / 100) * visibleWidth;

	// Inset: 1px border + 2px padding = 3pt
	const contentInset = 3;
	// Half-leading: CSS line-height 1.2 adds 10% of fontSize
	const halfLeading = fontSize * 0.1;

	let text_u = u + contentInset;
	if (shape.alignment === "center") {
		if (boxW > 0) {
			text_u = u + (boxW - textWidth) / 2;
		} else {
			text_u = u - textWidth / 2;
		}
	} else if (shape.alignment === "right") {
		if (boxW > 0) {
			text_u = u + boxW - contentInset - textWidth;
		} else {
			text_u = u - textWidth;
		}
	}

	const text_v_baseline = v + contentInset + halfLeading + ascent;

	let x: number;
	let y: number;

	if (rotation === 90) {
		x = text_v_baseline;
		y = text_u;
	} else if (rotation === 180) {
		x = pageWidth - text_u;
		y = text_v_baseline;
	} else if (rotation === 270) {
		x = pageWidth - text_v_baseline;
		y = pageHeight - text_u;
	} else {
		// 0 deg
		x = text_u;
		y = pageHeight - text_v_baseline;
	}

	return {
		x,
		y,
		rotateDegrees: rotation,
	};
}
