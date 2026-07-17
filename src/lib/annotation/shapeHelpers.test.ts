import { describe, expect, it } from "vitest";
import {
	patchSelectedShapes,
	selectionNeedsPropertyUpdate,
} from "./shapeHelpers";

describe("selectionNeedsPropertyUpdate", () => {
	const shapes = {
		1: [{ color: "#000000", thickness: 3 }],
		2: [{ color: "#ff0000", thickness: 3 }],
	};

	it("returns false when all selected shapes already have the value", () => {
		expect(
			selectionNeedsPropertyUpdate(
				shapes,
				[{ pageNumber: 1, index: 0 }],
				"thickness",
				3,
			),
		).toBe(false);
	});

	it("returns true when any selected shape differs", () => {
		expect(
			selectionNeedsPropertyUpdate(
				shapes,
				[
					{ pageNumber: 1, index: 0 },
					{ pageNumber: 2, index: 0 },
				],
				"color",
				"#000000",
			),
		).toBe(true);
	});
});

describe("patchSelectedShapes", () => {
	it("patches multiple shapes including two on the same page", () => {
		const shapes = {
			1: [
				{ color: "#000", thickness: 1 },
				{ color: "#111", thickness: 2 },
			],
		};
		const next = patchSelectedShapes(
			shapes,
			[
				{ pageNumber: 1, index: 0 },
				{ pageNumber: 1, index: 1 },
			],
			{ thickness: 5 },
		);
		expect(next[1][0].thickness).toBe(5);
		expect(next[1][1].thickness).toBe(5);
		// original untouched
		expect(shapes[1][0].thickness).toBe(1);
	});
});
