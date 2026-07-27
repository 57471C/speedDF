/**
 * Zoom-to-pointer scroll math for a scroll container whose content
 * reflows (page shells scale) and may re-center via mx-auto.
 */

export type ZoomPointerCapture = {
	/** Cursor X/Y inside the scroller viewport (client − container rect). */
	viewX: number;
	viewY: number;
	/** Cursor position in content-local CSS pixels *before* zoom. */
	localX: number;
	localY: number;
	/** Content element size before zoom (for scale ratio). */
	oldContentW: number;
	oldContentH: number;
};

/**
 * Given post-layout content placement (in the scroller's viewport), compute
 * scrollLeft/scrollTop so the pre-zoom content point stays under the cursor.
 */
export function scrollAfterZoomToPointer(
	capture: ZoomPointerCapture,
	layout: {
		/** contentRect.left − nodeRect.left after zoom (with current scroll). */
		contentLeftInView: number;
		contentTopInView: number;
		/** content size after zoom. */
		newContentW: number;
		newContentH: number;
		scrollLeft: number;
		scrollTop: number;
		/** Max scroll extents (scrollWidth − clientWidth, etc.). */
		maxScrollLeft: number;
		maxScrollTop: number;
	},
): { scrollLeft: number; scrollTop: number } {
	const scaleX =
		capture.oldContentW > 0 ? layout.newContentW / capture.oldContentW : 1;
	const scaleY =
		capture.oldContentH > 0 ? layout.newContentH / capture.oldContentH : 1;

	// Where the captured content point sits in the viewport after reflow
	const visualX = layout.contentLeftInView + capture.localX * scaleX;
	const visualY = layout.contentTopInView + capture.localY * scaleY;

	const nextLeft = layout.scrollLeft + (visualX - capture.viewX);
	const nextTop = layout.scrollTop + (visualY - capture.viewY);

	return {
		scrollLeft: clamp(
			nextLeft,
			0,
			Math.max(0, layout.maxScrollLeft),
		),
		scrollTop: clamp(nextTop, 0, Math.max(0, layout.maxScrollTop)),
	};
}

function clamp(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}
