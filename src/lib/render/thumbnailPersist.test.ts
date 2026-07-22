import { describe, expect, it } from "vitest";
import {
	clearLayoutMetaCache,
	contentKeyForBytes,
	layoutMetaStorageKey,
} from "./thumbnailPersist";

describe("contentKeyForBytes", () => {
	it("is stable for the same bytes", () => {
		const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(contentKeyForBytes(a)).toBe(contentKeyForBytes(b));
	});

	it("changes when content changes", () => {
		const a = new Uint8Array([1, 2, 3, 4, 5]);
		const b = new Uint8Array([1, 2, 3, 4, 6]);
		expect(contentKeyForBytes(a)).not.toBe(contentKeyForBytes(b));
	});

	it("includes length in the key", () => {
		const a = new Uint8Array(10);
		const b = new Uint8Array(11);
		expect(contentKeyForBytes(a).startsWith("10:")).toBe(true);
		expect(contentKeyForBytes(b).startsWith("11:")).toBe(true);
	});

	it("handles empty buffer", () => {
		expect(contentKeyForBytes(new Uint8Array(0))).toBe("0:0");
	});
});

describe("layout meta cache keys", () => {
	it("clearLayoutMetaCache removes the matching localStorage entry", () => {
		const path = "C:\\docs\\sample.pdf";
		const key = layoutMetaStorageKey(path);
		localStorage.setItem(key, JSON.stringify({ totalPages: 2 }));
		expect(localStorage.getItem(key)).not.toBeNull();
		clearLayoutMetaCache(path);
		expect(localStorage.getItem(key)).toBeNull();
	});
});
