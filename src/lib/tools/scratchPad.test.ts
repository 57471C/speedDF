import { afterEach, describe, expect, it } from "vitest";
import {
	clearScratchPadHtml,
	loadScratchPadHtml,
	saveScratchPadHtml,
	stripFontStylesFromHtml,
	SCRATCH_PAD_STORAGE_KEY,
} from "./scratchPad";

describe("scratchPad persistence", () => {
	afterEach(() => {
		localStorage.removeItem(SCRATCH_PAD_STORAGE_KEY);
	});

	it("returns empty string when unset", () => {
		expect(loadScratchPadHtml()).toBe("");
	});

	it("round-trips HTML", () => {
		saveScratchPadHtml("<b>Hello</b> world");
		expect(loadScratchPadHtml()).toBe("<b>Hello</b> world");
	});

	it("clears stored content", () => {
		saveScratchPadHtml("note");
		clearScratchPadHtml();
		expect(loadScratchPadHtml()).toBe("");
	});

	it("strips font styles, sizes, and colors while keeping bold/italic/lists", () => {
		const dirty = '<p style="font-family: Arial; font-size: 24px; color: red;">Hello <font face="Courier" size="5" color="#00ff00"><b>World</b></font></p>';
		const clean = stripFontStylesFromHtml(dirty);
		expect(clean).not.toContain("font-family");
		expect(clean).not.toContain("font-size");
		expect(clean).not.toContain("color");
		expect(clean).not.toContain("face");
		expect(clean).toContain("<b>World</b>");
	});
});

