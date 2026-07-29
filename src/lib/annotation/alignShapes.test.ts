import { describe, expect, it } from "vitest";
import {
	alignShapes,
	distributeShapes,
	selectionUnionBounds,
	translateShape,
} from "./alignShapes";

describe("translateShape", () => {
	it("moves box fields", () => {
		const s = translateShape(
			{ type: "rect", x: 10, y: 20, width: 5, height: 5 },
			3,
			-4,
		);
		expect(s).toEqual({ type: "rect", x: 13, y: 16, width: 5, height: 5 });
	});

	it("moves line points and refreshes bounds", () => {
		const s = translateShape(
			{
				type: "line",
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 10 },
				],
			},
			5,
			5,
		);
		expect(s.points).toEqual([
			{ x: 5, y: 5 },
			{ x: 15, y: 15 },
		]);
		expect(s.x).toBe(5);
		expect(s.y).toBe(5);
		expect(s.width).toBe(10);
		expect(s.height).toBe(10);
	});
});

describe("alignShapes", () => {
	const shapes = [
		{ type: "rect" as const, x: 10, y: 10, width: 10, height: 20 },
		{ type: "rect" as const, x: 40, y: 30, width: 20, height: 10 },
		{ type: "rect" as const, x: 70, y: 50, width: 10, height: 10 },
	];

	it("aligns left to the leftmost edge", () => {
		const next = alignShapes(shapes, [0, 1, 2], "left");
		expect(next[0].x).toBe(10);
		expect(next[1].x).toBe(10);
		expect(next[2].x).toBe(10);
	});

	it("aligns right to the rightmost edge", () => {
		const next = alignShapes(shapes, [0, 1, 2], "right");
		// union right = 80
		expect(next[0].x + (next[0].width ?? 0)).toBeCloseTo(80);
		expect(next[1].x + (next[1].width ?? 0)).toBeCloseTo(80);
		expect(next[2].x + (next[2].width ?? 0)).toBeCloseTo(80);
	});

	it("aligns top", () => {
		const next = alignShapes(shapes, [0, 1, 2], "top");
		expect(next[0].y).toBe(10);
		expect(next[1].y).toBe(10);
		expect(next[2].y).toBe(10);
	});

	it("aligns horizontal centers", () => {
		const next = alignShapes(shapes, [0, 1], "center");
		const c0 = next[0].x + (next[0].width ?? 0) / 2;
		const c1 = next[1].x + (next[1].width ?? 0) / 2;
		expect(c0).toBeCloseTo(c1);
	});

	it("no-ops for fewer than 2 indices", () => {
		expect(alignShapes(shapes, [0], "left")).toBe(shapes);
	});
});

describe("distributeShapes", () => {
	it("spaces centers evenly horizontally", () => {
		const shapes = [
			{ type: "rect" as const, x: 0, y: 0, width: 10, height: 10 },
			{ type: "rect" as const, x: 15, y: 0, width: 10, height: 10 },
			{ type: "rect" as const, x: 80, y: 0, width: 10, height: 10 },
		];
		const next = distributeShapes(shapes, [0, 1, 2], "horizontal");
		const c0 = next[0].x + 5;
		const c1 = next[1].x + 5;
		const c2 = next[2].x + 5;
		expect(c0).toBeCloseTo(5);
		expect(c2).toBeCloseTo(85);
		expect(c1).toBeCloseTo(45);
	});

	it("no-ops for fewer than 3", () => {
		const shapes = [
			{ type: "rect" as const, x: 0, y: 0, width: 10, height: 10 },
			{ type: "rect" as const, x: 50, y: 0, width: 10, height: 10 },
		];
		expect(distributeShapes(shapes, [0, 1], "horizontal")).toBe(shapes);
	});
});

describe("selectionUnionBounds", () => {
	it("covers selected boxes", () => {
		const shapes = [
			{ type: "rect", x: 0, y: 0, width: 10, height: 10 },
			{ type: "rect", x: 20, y: 5, width: 10, height: 10 },
		];
		expect(selectionUnionBounds(shapes, [0, 1])).toEqual({
			x: 0,
			y: 0,
			width: 30,
			height: 15,
		});
	});
});
