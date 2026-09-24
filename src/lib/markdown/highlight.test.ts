import { describe, expect, it } from "vitest";
import { parseMarkdownToHtml } from "./parse";
import { markdownSourceToSafeHtml } from "./sanitize";
import {
	escapeHtml,
	highlightFenced,
	highlightMarkdownSource,
	renderFencedBlock,
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
		expect(resolveHighlightLang("yml")).toBe("yaml");
		expect(resolveHighlightLang("toml")).toBe("ini");
		expect(resolveHighlightLang("golang")).toBe("go");
		expect(resolveHighlightLang("jsp")).toBe("java");
		expect(resolveHighlightLang("h")).toBe("c");
		expect(resolveHighlightLang("mysql")).toBe("sql");
		expect(resolveHighlightLang("postgres")).toBe("sql");
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

	it("colors yaml, sql, toml, go, java, c, and ini", () => {
		expect(highlightFenced("name: app\n", "yaml").language).toBe("yaml");
		expect(highlightFenced("name: app\n", "yml").html).toMatch(/hljs-/);

		const sql = highlightFenced("SELECT id FROM t;\n", "sql");
		expect(sql.language).toBe("sql");
		expect(sql.html).toContain("hljs-keyword");

		expect(highlightFenced("key = 1\n", "toml").language).toBe("ini");
		expect(highlightFenced("[section]\nkey = 1\n", "ini").html).toMatch(/hljs-/);

		const go = highlightFenced("func main() {}\n", "go");
		expect(go.language).toBe("go");
		expect(go.html).toContain("hljs-keyword");

		const java = highlightFenced("public class A {}\n", "java");
		expect(java.language).toBe("java");
		expect(java.html).toContain("hljs-keyword");

		const c = highlightFenced("int main() { return 0; }\n", "c");
		expect(c.language).toBe("c");
		expect(c.html).toMatch(/hljs-keyword|hljs-type|hljs-number/);
	});
});

describe("renderFencedBlock", () => {
	it("puts an optional data-lang label on pre", () => {
		const html = renderFencedBlock("name: app\n", "yml");
		expect(html).toMatch(/^<pre data-lang="yml">/);
		expect(html).not.toMatch(/<code[^>]*data-lang/);
		expect(html).toContain("language-yaml");
	});

	it("omits data-lang when the fence has no language", () => {
		expect(renderFencedBlock("plain\n", null)).not.toContain("data-lang");
		expect(renderFencedBlock("plain\n", "   ")).not.toContain("data-lang");
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
		expect(safe).toContain('data-lang="js"');
		expect(safe).toMatch(/<pre[^>]*data-md-line="1"[^>]*data-lang="js"/);
		expect(escapeHtml("<x>")).toBe("&lt;x&gt;");
	});
});
