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

	it("renders bare [ ] [x] [X] lines as disabled checkboxes", () => {
		const html = parseMarkdownToHtml(
			"[ ] Add signature\n[x] Add text\n[X] View-mode first.\n",
		);
		const boxes = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
		expect(boxes).toHaveLength(3);
		for (const box of boxes) {
			expect(box).toContain('type="checkbox"');
			expect(box).toContain("disabled");
		}
		expect(boxes[0]).not.toContain("checked");
		expect(boxes[1]).toContain("checked");
		expect(boxes[2]).toContain("checked");
		expect(html).toContain("Add signature");
		expect(html).toContain("Add text");
		expect(html).toContain("View-mode first.");
		expect(html).toMatch(/<ul data-md-line="1"/);
		expect(html).toMatch(/<li data-md-line="3"/);
	});

	it("keeps real GFM task lists", () => {
		const html = parseMarkdownToHtml("- [ ] open\n- [x] done\n* [X] star\n");
		const boxes = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
		expect(boxes).toHaveLength(3);
		expect(boxes[0]).toContain("disabled");
		expect(boxes[0]).not.toContain("checked");
		expect(boxes[1]).toContain("checked");
		expect(boxes[2]).toContain("checked");
	});

	it("leaves fences, quotes, and non-task brackets alone", () => {
		const html = parseMarkdownToHtml(
			[
				"[ ] Task line",
				" _still a note_",
				"> _quoted note_",
				"",
				"```",
				"[ ] not a box",
				"```",
				"",
				"[ ]glued",
				"",
				"See [ ] this",
				"",
				"  [x] indented",
			].join("\n"),
		);
		expect(html).toContain("<em>still a note</em>");
		expect(html).toMatch(/<blockquote\b/);
		expect(html).toContain("<em>quoted note</em>");
		const fenced = html.match(/<pre\b[^>]*>[\s\S]*?<\/pre>/);
		expect(fenced?.[0]).toContain("[ ] not a box");
		expect(fenced?.[0]).not.toContain("<input");
		expect(html).toContain("[ ]glued");
		expect(html).toContain("See [ ] this");
		expect(html).toContain("indented");
		const boxes = [...html.matchAll(/<input\b[^>]*>/g)];
		expect(boxes).toHaveLength(2);
		expect(boxes[1][0]).toContain("checked");
	});
});
