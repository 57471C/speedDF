import { describe, expect, it } from "vitest";
import {
	type HyperlinkDef,
	isSafeHyperlinkUrl,
	linksForPage,
	normalizeHyperlinkUrl,
} from "./hyperlinks";

describe("isSafeHyperlinkUrl", () => {
	it("allows http and https", () => {
		expect(isSafeHyperlinkUrl("https://example.com/path")).toBe(true);
		expect(isSafeHyperlinkUrl("http://example.com")).toBe(true);
	});

	it("allows mailto with a simple address", () => {
		expect(isSafeHyperlinkUrl("mailto:user@example.com")).toBe(true);
		expect(isSafeHyperlinkUrl("mailto:user@example.com?subject=Hi")).toBe(true);
	});

	it("rejects dangerous schemes", () => {
		expect(isSafeHyperlinkUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeHyperlinkUrl("JAVASCRIPT:void(0)")).toBe(false);
		expect(isSafeHyperlinkUrl("data:text/html,hi")).toBe(false);
		expect(isSafeHyperlinkUrl("file:///etc/passwd")).toBe(false);
		expect(isSafeHyperlinkUrl("vbscript:msgbox")).toBe(false);
		expect(isSafeHyperlinkUrl("blob:https://x")).toBe(false);
	});

	it("rejects empty, relative, and malformed values", () => {
		expect(isSafeHyperlinkUrl("")).toBe(false);
		expect(isSafeHyperlinkUrl("   ")).toBe(false);
		expect(isSafeHyperlinkUrl(null)).toBe(false);
		expect(isSafeHyperlinkUrl(undefined)).toBe(false);
		expect(isSafeHyperlinkUrl("/relative/path")).toBe(false);
		expect(isSafeHyperlinkUrl("example.com")).toBe(false);
		expect(isSafeHyperlinkUrl("mailto:")).toBe(false);
		expect(isSafeHyperlinkUrl("mailto: bad address")).toBe(false);
	});
});

describe("normalizeHyperlinkUrl", () => {
	it("trims safe urls and nulls unsafe ones", () => {
		expect(normalizeHyperlinkUrl("  https://a.test  ")).toBe("https://a.test");
		expect(normalizeHyperlinkUrl("javascript:x")).toBeNull();
	});
});

describe("linksForPage", () => {
	it("filters by page number", () => {
		const links: HyperlinkDef[] = [
			{
				id: "a",
				pageNum: 1,
				x: 0,
				y: 0,
				width: 1,
				height: 1,
				url: "https://a",
			},
			{
				id: "b",
				pageNum: 2,
				x: 0,
				y: 0,
				width: 1,
				height: 1,
				url: "https://b",
			},
		];
		expect(linksForPage(links, 2)).toHaveLength(1);
		expect(linksForPage(links, 2)[0].id).toBe("b");
		expect(linksForPage(null, 1)).toEqual([]);
	});
});
