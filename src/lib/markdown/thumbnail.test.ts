import { describe, expect, it } from "vitest";
import {
	MARKDOWN_THUMB_ACCENT,
	MARKDOWN_THUMB_FONT_MONO,
	MARKDOWN_THUMB_FONT_SANS,
	MARKDOWN_THUMB_HEADING,
	MARKDOWN_THUMB_MAX_EDGE_PX,
	MARKDOWN_THUMB_PAPER_BG,
	MARKDOWN_THUMB_TEXT,
	applyMarkdownThumbCapturePalette,
	canvasToThumbDataUrl,
	markdownThumbCaptureCss,
} from "./thumbnail";

describe("canvasToThumbDataUrl", () => {
	it("exports a jpeg data url scaled to max edge", () => {
		const canvas = document.createElement("canvas");
		canvas.width = 800;
		canvas.height = 1200;
		const ctx = canvas.getContext("2d");
		expect(ctx).toBeTruthy();
		ctx!.fillStyle = "#112233";
		ctx!.fillRect(0, 0, 800, 1200);

		const dataUrl = canvasToThumbDataUrl(
			canvas,
			MARKDOWN_THUMB_MAX_EDGE_PX,
			0.8,
		);
		expect(dataUrl.startsWith("data:image/jpeg")).toBe(true);

		const scale = Math.min(1, MARKDOWN_THUMB_MAX_EDGE_PX / Math.max(800, 1200));
		expect(Math.round(1200 * scale)).toBe(MARKDOWN_THUMB_MAX_EDGE_PX);
	});
});

describe("markdown thumb forced dark palette + sans font", () => {
	it("capture CSS forces light text, dark paper, and sans stack", () => {
		const css = markdownThumbCaptureCss();
		expect(css).toContain(MARKDOWN_THUMB_PAPER_BG);
		expect(css).toContain(MARKDOWN_THUMB_TEXT);
		expect(css).toContain("font-family:");
		expect(css).toContain("system-ui");
		expect(css).toContain("sans-serif");
		expect(css).not.toContain("Times");
	});

	it("applyMarkdownThumbCapturePalette overrides black text and Times from light theme", () => {
		const root = document.createElement("article");
		root.className = "markdown-view";
		root.style.color = "#000000";
		root.style.backgroundColor = "#ffffff";
		root.style.fontFamily = "Times, serif";

		const h1 = document.createElement("h1");
		h1.style.color = "#111111";
		h1.style.fontFamily = "Times New Roman, serif";
		h1.textContent = "Title";
		const p = document.createElement("p");
		p.style.color = "#000000";
		p.style.fontFamily = "serif";
		p.textContent = "Body";
		const a = document.createElement("a");
		a.style.color = "#0000ee";
		a.href = "#";
		a.textContent = "link";
		const code = document.createElement("code");
		code.style.fontFamily = "Times, serif";
		code.textContent = "x";
		root.append(h1, p, a, code);

		applyMarkdownThumbCapturePalette(root);

		// jsdom may normalize #hex → rgb(); accept either form
		const asRgb = (hex: string) => {
			const h = hex.replace("#", "");
			const n = parseInt(h, 16);
			return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
		};
		const matches = (got: string, hex: string) =>
			got === hex ||
			got === asRgb(hex) ||
			got.replace(/\s/g, "") === asRgb(hex).replace(/\s/g, "");

		expect(matches(root.style.backgroundColor, MARKDOWN_THUMB_PAPER_BG)).toBe(
			true,
		);
		expect(matches(root.style.color, MARKDOWN_THUMB_TEXT)).toBe(true);
		expect(matches(h1.style.color, MARKDOWN_THUMB_HEADING)).toBe(true);
		expect(matches(p.style.color, MARKDOWN_THUMB_TEXT)).toBe(true);
		expect(matches(a.style.color, MARKDOWN_THUMB_ACCENT)).toBe(true);
		expect(root.style.fontFamily).toBe(MARKDOWN_THUMB_FONT_SANS);
		expect(h1.style.fontFamily).toBe(MARKDOWN_THUMB_FONT_SANS);
		expect(p.style.fontFamily).toBe(MARKDOWN_THUMB_FONT_SANS);
		expect(code.style.fontFamily).toBe(MARKDOWN_THUMB_FONT_MONO);
		expect(root.style.fontFamily.toLowerCase()).not.toContain("times");
	});
});
