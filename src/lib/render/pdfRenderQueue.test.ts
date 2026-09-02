import { describe, expect, it } from "vitest";
import { computeThumbnailScale } from "./pdfRenderQueue";

describe("computeThumbnailScale", () => {
	it("returns calculated scale between 0.05 and maxScale", () => {
		// raw = 100 / 500 = 0.2
		expect(computeThumbnailScale(500, 100, 1.0)).toBe(0.2);
	});

	it("clamps to maxScale when calculated scale is larger", () => {
		// raw = 200 / 100 = 2.0
		expect(computeThumbnailScale(100, 200, 1.5)).toBe(1.5);
	});

	it("clamps to 0.05 when calculated scale is smaller", () => {
		// raw = 50 / 2000 = 0.025
		expect(computeThumbnailScale(2000, 50, 1.0)).toBe(0.05);
	});

	it("handles pageWidthPts = 0 by clamping denominator to 0.1", () => {
		// Math.max(0.1, 0) = 0.1
		// raw = 10 / 0.1 = 100
		expect(computeThumbnailScale(0, 10, 50.0)).toBe(50.0); // limited by maxScale
		expect(computeThumbnailScale(0, 10, 200.0)).toBe(100.0);
	});

	it("handles negative pageWidthPts using absolute value", () => {
		// raw = 100 / |-500| = 0.2
		expect(computeThumbnailScale(-500, 100, 1.0)).toBe(0.2);
	});
});
