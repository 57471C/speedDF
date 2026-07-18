import { describe, expect, it } from "vitest";
import {
	createBoxShape,
	createFreehandShape,
	createSignatureOrInitialShape,
	createTextShape,
	hasEmptyTextDraft,
	withoutEmptyTextDrafts,
} from "./toolShapes";

describe("createSignatureOrInitialShape", () => {
	it("centers stamp on click", () => {
		const s = createSignatureOrInitialShape("signature", 50, 40, {
			ghostW: 18,
			ghostH: 8,
			dataUrl: "data:image/png;base64,xx",
		});
		expect(s.x).toBe(41);
		expect(s.y).toBe(36);
		expect(s.width).toBe(18);
		expect(s.height).toBe(8);
		expect(s.dataUrl).toBe("data:image/png;base64,xx");
	});
});

describe("createBoxShape", () => {
	it("normalizes min corner and positive size", () => {
		const s = createBoxShape(
			"rect",
			{ x: 40, y: 50 },
			{ x: 10, y: 20 },
			{ color: "#000", thickness: 3, lineStyle: "solid" },
		);
		expect(s).toMatchObject({
			x: 10,
			y: 20,
			width: 30,
			height: 30,
			type: "rect",
		});
	});
});

describe("createFreehandShape", () => {
	it("anchors x/y on first point", () => {
		const pts = [
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		];
		const s = createFreehandShape("pen", pts, {
			color: "#f00",
			thickness: 2,
		});
		expect(s.x).toBe(1);
		expect(s.y).toBe(2);
		expect(s.points).toEqual(pts);
		expect(s.points).not.toBe(pts);
	});
});

describe("createTextShape", () => {
	it("starts empty at click point", () => {
		const s = createTextShape(12, 34, {
			fontFamily: "Helvetica",
			size: 14,
			style: "Bold",
			color: "#111",
		});
		expect(s).toMatchObject({
			type: "text",
			x: 12,
			y: 34,
			text: "",
			size: 14,
			style: "Bold",
			color: "#111",
			textColor: "#111",
		});
	});
});

describe("empty text draft helpers", () => {
	it("detects and strips empty drafts", () => {
		const shapes = [
			{ type: "text" as const, x: 0, y: 0, text: "  " },
			{ type: "rect" as const, x: 1, y: 1, width: 2, height: 2 },
		];
		expect(hasEmptyTextDraft(shapes)).toBe(true);
		expect(withoutEmptyTextDrafts(shapes)).toHaveLength(1);
		expect(withoutEmptyTextDrafts(shapes)[0].type).toBe("rect");
	});
});
