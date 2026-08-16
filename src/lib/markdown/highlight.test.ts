import { describe, expect, it } from "vitest";
import { parseMarkdownToHtml } from "./parse";
import { markdownSourceToSafeHtml } from "./sanitize";
import {
	escapeHtml,
	highlightFenced,
	highlightMarkdownSource,
	resolveHighlightLang,
} from "./highlight";

function visibleText(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

describe("resolveHighlightLang", () => {
	it("maps common aliases onto registered languages", () => {
		expect(resolveHighlightLang("ts")).toBe("typescript");
		expect(resolveHighlightLang("JS")).toBe("javascript");
		expect(resolveHighlightLang("rust")).toBe("rust");
		expect(resolveHighlightLang("unknown-lang")).toBeNull();
	});
});

describe("highlightFenced", () => {
	it("colors javascript / typescript / rust tokens", () => {
		const js = highlightFenced("const x = 1;", "js");
		expect(js.language).toBe("javascript");
		expect(js.html).toContain("hljs-keyword");
		expect(visibleText(js.html)).toBe("const x = 1;");

		const ts = highlightFenced("const n: number = 1;", "ts");
		expect(ts.language).toBe("typescript");
		expect(ts.html).toMatch(/hljs-/);

		const rs = highlightFenced("fn main() {}", "rust");
		expect(rs.language).toBe("rust");
		expect(rs.html).toMatch(/hljs-/);
		expect(visibleText(rs.html)).toBe("fn main() {}");
	});

	it("escapes unknown languages without throwing", () => {
		const out = highlightFenced("a < b", "not-a-lang");
		expect(out.language).toBeNull();
		expect(out.html).toBe("a &lt; b");
	});
});

describe("highlightMarkdownSource", () => {
	it("preserves source characters so the overlay can line up", () => {
		const src = "# Title\n\n```ts\nconst a = 1;\n```\n\n- item\n";
		expect(visibleText(highlightMarkdownSource(src))).toBe(src);
	});

	it("highlights a fenced ts body inside markdown", () => {
		const html = highlightMarkdownSource("```ts\nconst a = 1;\n```\n");
		expect(html).toContain("hljs-keyword");
		expect(html).toContain("hljs-meta");
	});
});

describe("parseMarkdownToHtml fenced + existing constructs", () => {
	it("emits hljs classes for a js fence", () => {
		const html = parseMarkdownToHtml("```js\nconst x = 1;\n```\n");
		expect(html).toContain("hljs");
		expect(html).toContain("language-javascript");
		expect(html).toContain("hljs-keyword");
	});

	it("still renders tables, links, and images", () => {
		const src = [
			"[hi](https://example.com)",
			"",
			"![alt](https://example.com/x.png)",
			"",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"",
		].join("\n");
		const html = parseMarkdownToHtml(src);
		expect(html).toMatch(/<a[^>]+href="https:\/\/example.com"/);
		expect(html).toMatch(/<img[^>]+src="https:\/\/example.com\/x.png"/);
		expect(html).toMatch(/<table/i);
		expect(html).toMatch(/<td[^>]*>1<\/td>/);
	});

	it("sanitize keeps highlight classes", () => {
		const safe = markdownSourceToSafeHtml("```js\nconst x = 1;\n```\n");
		expect(safe).toContain("hljs-keyword");
		expect(escapeHtml("<x>")).toBe("&lt;x&gt;");
	});
});
