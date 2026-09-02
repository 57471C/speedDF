import { describe, expect, it } from "vitest";
import {
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
		const plan = thumbnailScalePlanForBytes(THUMBNAIL_LARGE_DOC_BYTES + 5000000);
		expect(plan).toEqual({
			maxEdgePx: THUMBNAIL_LARGE_MAX_EDGE_PX,
			maxScale: THUMBNAIL_LARGE_MAX_SCALE,
			retryMaxEdgePx: THUMBNAIL_RETRY_MAX_EDGE_PX,
			retryMaxScale: THUMBNAIL_RETRY_MAX_SCALE,
		});
	});
});
