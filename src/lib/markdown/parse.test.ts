import { describe, expect, it } from "vitest";
import { parseMarkdownToHtml } from "./parse";

describe("parseMarkdownToHtml", () => {
	it("renders ==highlight== as mark", () => {
		const html = parseMarkdownToHtml("Note ==important== bit");
		expect(html).toContain("<mark>important</mark>");
	});

	it("renders ordered lists as ol", () => {
		const html = parseMarkdownToHtml("1. first\n2. second");
		expect(html).toMatch(/<ol[\s>]/);
		expect(html).toContain("<li");
	});

	it("stamps block tags with the source line they start on", () => {
		const html = parseMarkdownToHtml(
			"# Title\n\nPara\n\n```js\nconst x = 1;\n```\n\n- a\n- b\n",
		);
		expect(html).toMatch(/<h1 data-md-line="1"/);
		expect(html).toMatch(/<p data-md-line="3"/);
		expect(html).toMatch(/<pre data-md-line="5" data-lang="js"/);
		expect(html).toMatch(/<ul data-md-line="9"/);
		expect(html).toMatch(/<li data-md-line="9"/);
		expect(html).toMatch(/<li data-md-line="10"/);
	});

	it("stamps an image paragraph, not the img", () => {
		const html = parseMarkdownToHtml("![x](https://example.com/a.png)\n");
		expect(html).toMatch(/<p data-md-line="1">/);
		expect(html).toMatch(/<img /);
		expect(html).not.toMatch(/<img[^>]*data-md-line/);
	});
});
