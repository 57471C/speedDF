import { describe, expect, it } from "vitest";
import { parseMarkdownToHtml } from "./parse";

describe("parseMarkdownToHtml", () => {
	it("renders ==highlight== as mark", () => {
		const html = parseMarkdownToHtml("Note ==important== bit");
		expect(html).toContain("<mark>important</mark>");
	});

	it("renders ordered lists as ol", () => {
		const html = parseMarkdownToHtml("1. first\n2. second");
		expect(html).toContain("<ol>");
		expect(html).toContain("<li>");
	});
});
