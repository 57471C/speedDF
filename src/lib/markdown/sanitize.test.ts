import { describe, expect, it } from "vitest";
import { markdownSourceToSafeHtml } from "./sanitize";

describe("markdownSourceToSafeHtml", () => {
	it("re-projects edited source so the live preview can update", () => {
		const first = markdownSourceToSafeHtml("# Hello");
		const second = markdownSourceToSafeHtml("# Edited");
		expect(first).toMatch(/<h1[^>]*>Hello<\/h1>/);
		expect(second).toMatch(/<h1[^>]*>Edited<\/h1>/);
		expect(second).not.toContain("Hello");
	});

	it("renders an empty source as empty html", () => {
		expect(markdownSourceToSafeHtml("")).toBe("");
	});
});
