import { describe, expect, it } from "vitest";
import { remapThumbnailOverridesAfterInsert } from "./thumbnailCache";

describe("remapThumbnailOverridesAfterInsert", () => {
	it("keeps pre/post thumbs and leaves holes for inserted pages", () => {
		// Old doc pages 1,2,3 with thumbs at 0,1,2
		const old = {
			0: "data:thumb-p1",
			1: "data:thumb-p2",
			2: "data:thumb-p3",
		};
		// Insert 2 pages after page 1 → pre=[1], extra=2, post=[2,3]
		const next = remapThumbnailOverridesAfterInsert(old, [1], 2, [2, 3]);
		expect(next[0]).toBe("data:thumb-p1");
		// slots 1 and 2 are new pages — no thumbs
		expect(next[1]).toBeUndefined();
		expect(next[2]).toBeUndefined();
		// post pages shift to indices 3 and 4
		expect(next[3]).toBe("data:thumb-p2");
		expect(next[4]).toBe("data:thumb-p3");
	});

	it("handles empty old overrides", () => {
		const next = remapThumbnailOverridesAfterInsert({}, [1, 2], 1, []);
		expect(next).toEqual({});
	});

	it("appends at end when insert after last page", () => {
		const old = { 0: "a", 1: "b" };
		const next = remapThumbnailOverridesAfterInsert(old, [1, 2], 1, []);
		expect(next[0]).toBe("a");
		expect(next[1]).toBe("b");
		expect(next[2]).toBeUndefined();
	});
});
