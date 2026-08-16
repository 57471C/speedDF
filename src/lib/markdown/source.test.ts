import { describe, expect, it } from "vitest";
import {
	decodeMarkdownBytes,
	encodeMarkdownSource,
	MARKDOWN_PREVIEW_DEBOUNCE_MS,
} from "./source";

describe("encodeMarkdownSource / decodeMarkdownBytes", () => {
	it("round-trips ASCII and Unicode source", () => {
		const source = "# Hello\n\nCafé — 日本語\n\n- item\n";
		const bytes = encodeMarkdownSource(source);
		expect(ArrayBuffer.isView(bytes)).toBe(true);
		expect(bytes.byteLength).toBeGreaterThan(0);
		expect(decodeMarkdownBytes(bytes)).toBe(source);
	});

	it("encodes an empty string to empty bytes", () => {
		const bytes = encodeMarkdownSource("");
		expect(bytes.byteLength).toBe(0);
		expect(decodeMarkdownBytes(bytes)).toBe("");
	});

	it("treats nullish source as empty", () => {
		expect(decodeMarkdownBytes(encodeMarkdownSource(null as unknown as string))).toBe(
			"",
		);
	});
});

describe("preview debounce constant", () => {
	it("is a short positive delay", () => {
		expect(MARKDOWN_PREVIEW_DEBOUNCE_MS).toBeGreaterThan(0);
		expect(MARKDOWN_PREVIEW_DEBOUNCE_MS).toBeLessThan(500);
	});
});
