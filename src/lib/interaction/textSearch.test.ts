import { describe, expect, it } from "vitest";
import {
	buildSearchRegex,
	collectMatchesFromPageItems,
	countMatchesInString,
	escapeHtml,
	paintSearchHighlightsOnRoot,
} from "./textSearch";

describe("textSearch helpers", () => {
	it("counts overlapping-safe non-zero matches", () => {
		expect(countMatchesInString("aaa", "aa", false)).toBe(1);
		expect(countMatchesInString("hello hello", "hello", false)).toBe(2);
		expect(countMatchesInString("Hello", "hello", false)).toBe(1);
		expect(countMatchesInString("Hello", "hello", true)).toBe(0);
	});

	it("indexes per text item so DOM span order can map 1:1", () => {
		const items = [{ str: "foo" }, { str: "bar foo" }, { str: "baz" }];
		const matches = collectMatchesFromPageItems(3, items, "foo", false);
		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({
			pageNumber: 3,
			occurrenceOnPage: 0,
		});
		expect(matches[1]).toMatchObject({
			pageNumber: 3,
			occurrenceOnPage: 1,
		});
	});

	it("skips empty / non-string items", () => {
		const matches = collectMatchesFromPageItems(
			1,
			[null, undefined, { str: undefined }, "", { str: "x" }],
			"x",
			false,
		);
		expect(matches).toHaveLength(1);
	});

	it("escapes HTML in highlight parts", () => {
		expect(escapeHtml(`a<b>&"c`)).toBe("a&lt;b&gt;&amp;&quot;c");
	});

	it("buildSearchRegex captures the query for split painting", () => {
		const re = buildSearchRegex("hi", false);
		expect("say Hi there".split(re)).toEqual(["say ", "Hi", " there"]);
	});

	it("paints marks and returns the current mark for the target occurrence", () => {
		const root = document.createElement("div");
		root.innerHTML = `
      <div class="textLayer">
        <span>alpha foo beta</span>
        <span>foo gamma foo</span>
      </div>
    `;
		const map = new Map<HTMLElement, string>();
		const result = paintSearchHighlightsOnRoot(root, "foo", false, 1, map);
		expect(result.paintedCount).toBe(3);
		expect(result.currentMark).toBeTruthy();
		expect(
			result.currentMark?.classList.contains("sdf-search-hit-current"),
		).toBe(true);
		expect(result.currentMark?.textContent).toBe("foo");
		expect(root.querySelectorAll("mark.sdf-search-hit").length).toBe(3);
	});
});
