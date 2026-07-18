import { describe, expect, it } from "vitest";
import {
	getDisplayCoords,
	getDisplayPoints,
	normalizeCoordinates,
} from "./coordinates";

describe("normalizeCoordinates", () => {
	it("maps raw CSS pixels to percent for non-image pages", () => {
		const p = normalizeCoordinates(50, 25, {
			fileType: "pdf",
			imageRotation: 0,
			basePageWidth: 612,
			basePageHeight: 792,
			zoomScale: 100,
			pageWidth: 100,
			pageHeight: 100,
		});
		expect(p).toEqual({ x: 50, y: 25 });
	});

	it("undoes 90° image rotation into natural image space", () => {
		// At 100% zoom, raw (0, 0) display top-left maps depending on rotation
		const p = normalizeCoordinates(0, 0, {
			fileType: "image",
			imageRotation: 90,
			basePageWidth: 100,
			basePageHeight: 200,
			zoomScale: 100,
			pageWidth: 200,
			pageHeight: 100,
		});
		// x_local = y_raw = 0; y_local = H - x_raw = 200
		expect(p.x).toBe(0);
		expect(p.y).toBe(100);
	});
});

describe("getDisplayCoords", () => {
	it("passthrough for PDF", () => {
		expect(
			getDisplayCoords({ x: 10, y: 20, width: 30, height: 40 }, "pdf", 0),
		).toEqual({ x: 10, y: 20, width: 30, height: 40 });
	});

	it("rotates bounds for 180° image", () => {
		expect(
			getDisplayCoords(
				{ x: 10, y: 20, width: 30, height: 40 },
				"image",
				180,
			),
		).toEqual({ x: 60, y: 40, width: 30, height: 40 });
	});
});

describe("getDisplayPoints", () => {
	it("returns empty for undefined", () => {
		expect(getDisplayPoints(undefined, "pdf", 0)).toEqual([]);
	});

	it("rotates points for 270° image", () => {
		expect(getDisplayPoints([{ x: 10, y: 20 }], "image", 270)).toEqual([
			{ x: 20, y: 90 },
		]);
	});
});
