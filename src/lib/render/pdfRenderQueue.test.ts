import { describe, expect, it } from "vitest";
import {
	computeThumbnailScale,
	THUMBNAIL_LARGE_DOC_BYTES,
	THUMBNAIL_LARGE_MAX_EDGE_PX,
	THUMBNAIL_LARGE_MAX_SCALE,
	THUMBNAIL_MAX_EDGE_PX,
	THUMBNAIL_MAX_SCALE,
	THUMBNAIL_RETRY_MAX_EDGE_PX,
	THUMBNAIL_RETRY_MAX_SCALE,
	thumbnailScalePlanForBytes,
} from "./pdfRenderQueue";

describe("thumbnailScalePlanForBytes", () => {
	it("returns normal scale plan for undefined byteLength", () => {
		const plan = thumbnailScalePlanForBytes(undefined);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_MAX_EDGE_PX,
			maxScale: THUMBNAIL_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});

	it("returns normal scale plan for null byteLength", () => {
		const plan = thumbnailScalePlanForBytes(null);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_MAX_EDGE_PX,
			maxScale: THUMBNAIL_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});

	it("returns normal scale plan for small documents", () => {
		const plan = thumbnailScalePlanForBytes(1000);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_MAX_EDGE_PX,
			maxScale: THUMBNAIL_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});

	it("returns normal scale plan just below the large document threshold", () => {
		const plan = thumbnailScalePlanForBytes(THUMBNAIL_LARGE_DOC_BYTES - 1);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_MAX_EDGE_PX,
			maxScale: THUMBNAIL_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});

	it("returns large scale plan at exactly the large document threshold", () => {
		const plan = thumbnailScalePlanForBytes(THUMBNAIL_LARGE_DOC_BYTES);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_LARGE_MAX_EDGE_PX,
			maxScale: THUMBNAIL_LARGE_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});

	it("returns large scale plan above the large document threshold", () => {
		const plan = thumbnailScalePlanForBytes(
			THUMBNAIL_LARGE_DOC_BYTES + 5000000,
		);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_LARGE_MAX_EDGE_PX,
			maxScale: THUMBNAIL_LARGE_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});
});

describe("computeThumbnailScale", () => {
	it("returns calculated scale between 0.05 and maxScale", () => {
		expect(computeThumbnailScale(500, 100, 1.0)).toBe(0.2);
	});

	it("clamps to maxScale when calculated scale is larger", () => {
		expect(computeThumbnailScale(100, 200, 1.5)).toBe(1.5);
	});

	it("clamps to 0.05 when calculated scale is smaller", () => {
		expect(computeThumbnailScale(2000, 50, 1.0)).toBe(0.05);
	});

	it("handles pageWidthPts = 0 by clamping denominator to 0.1", () => {
		expect(computeThumbnailScale(0, 10, 50.0)).toBe(50.0);
		expect(computeThumbnailScale(0, 10, 200.0)).toBe(100.0);
	});

	it("handles negative pageWidthPts using absolute value", () => {
		expect(computeThumbnailScale(-500, 100, 1.0)).toBe(0.2);
	});
});
