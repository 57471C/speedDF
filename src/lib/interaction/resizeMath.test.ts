import { describe, expect, it } from "vitest";
import { clampPct, computeResizedBounds } from "./resizeMath";

describe("computeResizedBounds", () => {
	const initial = { x: 10, y: 20, width: 30, height: 40 };

	it("grows from bottom-right", () => {
		expect(computeResizedBounds("br", initial, 50, 70)).toEqual({
			x: 10,
			y: 20,
			width: 40,
			height: 50,
		});
	});

	it("moves top-left while keeping bottom-right fixed", () => {
		const r = computeResizedBounds("tl", initial, 15, 25);
		expect(r.x).toBe(15);
		expect(r.y).toBe(25);
		expect(r.width).toBeCloseTo(25);
		expect(r.height).toBeCloseTo(35);
	});

	it("enforces minimum size on br", () => {
		const r = computeResizedBounds("br", initial, 10, 20);
		expect(r.width).toBe(0.1);
		expect(r.height).toBe(0.1);
	});
});

describe("clampPct", () => {
	it("clamps to 0–100", () => {
		expect(clampPct(-5)).toBe(0);
		expect(clampPct(50)).toBe(50);
		expect(clampPct(105)).toBe(100);
	});
});
