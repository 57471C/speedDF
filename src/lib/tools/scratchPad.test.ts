import { afterEach, describe, expect, it } from "vitest";
import {
	clearScratchPadHtml,
	loadScratchPadHtml,
	saveScratchPadHtml,
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
});
