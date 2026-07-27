import { describe, expect, it } from "vitest";
import { selectionAnchorPct, type TextSelectionSnapshot } from "./textSelection";

describe("textSelection helpers", () => {
	it("anchors comment pin to center of first rect", () => {
		const snap: TextSelectionSnapshot = {
			text: "hello",
			pageNum: 1,
			rects: [{ x: 10, y: 20, width: 30, height: 10 }],
		};
		expect(selectionAnchorPct(snap)).toEqual({ x: 25, y: 25 });
	});
});
