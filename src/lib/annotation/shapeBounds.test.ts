import { describe, expect, it } from "vitest";
import {
	boundsFromPoints,
	getShapeBounds,
	indicesIntersectingMarquee,
	rectsIntersect,
	unionBounds,
} from "./shapeBounds";

describe("rectsIntersect", () => {
	it("detects overlap and edge touch", () => {
		expect(
			rectsIntersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 5, y: 5, width: 10, height: 10 },
			),
		).toBe(true);
		expect(
			rectsIntersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 10, y: 0, width: 5, height: 5 },
			),
		).toBe(true);
		expect(
			rectsIntersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 11, y: 0, width: 5, height: 5 },
			),
		).toBe(false);
	});
});

describe("getShapeBounds", () => {
	it("uses box fields for rects", () => {
		expect(
			getShapeBounds({ type: "rect", x: 10, y: 20, width: 30, height: 40 }),
		).toEqual({ x: 10, y: 20, width: 30, height: 40 });
	});

	it("uses line endpoints", () => {
		expect(
			getShapeBounds({
				type: "line",
				x: 0,
				y: 0,
				points: [
					{ x: 80, y: 10 },
					{ x: 20, y: 90 },
				],
			}),
		).toEqual({ x: 20, y: 10, width: 60, height: 80 });
	});

	it("hulls freehand points", () => {
		expect(
			getShapeBounds({
				type: "pen",
				x: 0,
				y: 0,
				points: [
					{ x: 5, y: 5 },
					{ x: 15, y: 3 },
					{ x: 10, y: 20 },
				],
			}),
		).toEqual({ x: 5, y: 3, width: 10, height: 17 });
	});
});

describe("unionBounds / marquee", () => {
	it("unions rects", () => {
		expect(
			unionBounds([
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 20, y: 5, width: 5, height: 5 },
			]),
		).toEqual({ x: 0, y: 0, width: 25, height: 10 });
	});

	it("selects intersecting indices including inverted marquee", () => {
		const shapes = [
			{ type: "rect", x: 10, y: 10, width: 10, height: 10 },
			{ type: "rect", x: 50, y: 50, width: 10, height: 10 },
			{ type: "rect", x: 80, y: 80, width: 5, height: 5 },
		];
		expect(
			indicesIntersectingMarquee(shapes, {
				x: 40,
				y: 40,
				width: 25,
				height: 25,
			}),
		).toEqual([1]);
		// Dragged inverted (negative width/height)
		expect(
			indicesIntersectingMarquee(shapes, {
				x: 25,
				y: 25,
				width: -20,
				height: -20,
			}),
		).toEqual([0]);
	});
});

describe("boundsFromPoints", () => {
	it("handles empty", () => {
		expect(boundsFromPoints([])).toEqual({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		});
	});
});
