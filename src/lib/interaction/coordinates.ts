/**
 * Pure coordinate transforms for page interaction (image rotation vs PDF).
 * No document store ownership — callers pass layout/rotation context in.
 */

export type PointPct = { x: number; y: number };

export type RectPct = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type NormalizeContext = {
	fileType: string | undefined | null;
	imageRotation: number;
	basePageWidth: number;
	basePageHeight: number;
	zoomScale: number;
	/** CSS pixel size of the page container (for non-image docs). */
	pageWidth: number;
	pageHeight: number;
};

/**
 * Convert raw page-local CSS pixels into annotation percentage coordinates.
 * For images, undoes display rotation so shape storage stays in natural image space.
 */
export function normalizeCoordinates(
	rawX: number,
	rawY: number,
	ctx: NormalizeContext,
): PointPct {
	if (ctx.fileType === "image") {
		const x_raw = rawX / (ctx.zoomScale / 100);
		const y_raw = rawY / (ctx.zoomScale / 100);

		let x_local = x_raw;
		let y_local = y_raw;
		const W = ctx.basePageWidth;
		const H = ctx.basePageHeight;

		const rotation = ctx.imageRotation || 0;
		if (rotation === 90) {
			x_local = y_raw;
			y_local = H - x_raw;
		} else if (rotation === 180) {
			x_local = W - x_raw;
			y_local = H - y_raw;
		} else if (rotation === 270) {
			x_local = W - y_raw;
			y_local = x_raw;
		}

		return {
			x: (x_local / Math.max(1, W)) * 100,
			y: (y_local / Math.max(1, H)) * 100,
		};
	}

	return {
		x: (rawX / Math.max(1, ctx.pageWidth)) * 100,
		y: (rawY / Math.max(1, ctx.pageHeight)) * 100,
	};
}

/**
 * Map stored shape percentages into display percentages under image rotation.
 */
export function getDisplayCoords(
	shape: { x: number; y: number; width?: number; height?: number },
	fileType: string | undefined | null,
	imageRotation: number,
): RectPct {
	const x = shape.x;
	const y = shape.y;
	const w = shape.width ?? 0;
	const h = shape.height ?? 0;

	if (fileType !== "image") {
		return { x, y, width: w, height: h };
	}

	const rotation = imageRotation || 0;
	if (rotation === 90) {
		return {
			x: 100 - (y + h),
			y: x,
			width: h,
			height: w,
		};
	}
	if (rotation === 180) {
		return {
			x: 100 - (x + w),
			y: 100 - (y + h),
			width: w,
			height: h,
		};
	}
	if (rotation === 270) {
		return {
			x: y,
			y: 100 - (x + w),
			width: h,
			height: w,
		};
	}

	return { x, y, width: w, height: h };
}

/**
 * Map freehand point percentages into display space under image rotation.
 */
export function getDisplayPoints(
	points: PointPct[] | undefined,
	fileType: string | undefined | null,
	imageRotation: number,
): PointPct[] {
	if (!points) return [];
	if (fileType !== "image") return points;
	const rotation = imageRotation || 0;
	return points.map((p) => {
		if (rotation === 90) {
			return { x: 100 - p.y, y: p.x };
		}
		if (rotation === 180) {
			return { x: 100 - p.x, y: 100 - p.y };
		}
		if (rotation === 270) {
			return { x: p.y, y: 100 - p.x };
		}
		return p;
	});
}
