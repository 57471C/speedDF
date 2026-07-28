import { describe, expect, it } from "vitest";
import {
	buildPageRemapAfterInsert,
	displayPagePosition,
	pruneItemsByPageOrder,
	prunePageBoundToOrder,
	remapBookmarksAfterInsert,
	remapCommentsAfterInsert,
	remapFormFieldsAfterInsert,
	remapHyperlinksAfterInsert,
	remapRotationsAfterInsert,
	remapSessionAfterPageInsert,
	remapShapesAfterInsert,
} from "./pageBoundData";

describe("displayPagePosition", () => {
	it("returns 1-based index in pageOrder", () => {
		expect(displayPagePosition([3, 1, 2], 1)).toBe(2);
		expect(displayPagePosition([3, 1, 2], 3)).toBe(1);
	});

	it("returns 0 when page is missing", () => {
		expect(displayPagePosition([1, 2], 9)).toBe(0);
	});
});

describe("prunePageBoundToOrder", () => {
	it("keeps only bookmarks and comments on surviving pages", () => {
		const { bookmarks, comments } = prunePageBoundToOrder(
			[1, 3],
			[
				{ pageNum: 1, name: "A" },
				{ pageNum: 2, name: "B" },
				{ pageNum: 3, name: "C" },
			],
			[
				{ pageNum: 2, id: "x" },
				{ pageNum: 3, id: "y" },
			],
		);
		expect(bookmarks).toEqual([
			{ pageNum: 1, name: "A" },
			{ pageNum: 3, name: "C" },
		]);
		expect(comments).toEqual([{ pageNum: 3, id: "y" }]);
	});

	it("prunes hyperlinks and form fields; drops formValues for removed fields", () => {
		const result = prunePageBoundToOrder(
			[1, 3],
			[{ pageNum: 1, name: "bm" }],
			[{ pageNum: 3, id: "c" }],
			[
				{ pageNum: 1, id: "l1", url: "https://a.test" },
				{ pageNum: 2, id: "l2", url: "https://b.test" },
				{ pageNum: 3, id: "l3", url: "https://c.test" },
			],
			[
				{ pageNum: 1, name: "field.a" },
				{ pageNum: 2, name: "field.b" },
				{ pageNum: 3, name: "field.c" },
			],
			{
				"field.a": "keep",
				"field.b": "drop",
				"field.c": true,
			},
		);
		expect(result.hyperlinks).toEqual([
			{ pageNum: 1, id: "l1", url: "https://a.test" },
			{ pageNum: 3, id: "l3", url: "https://c.test" },
		]);
		expect(result.formFields).toEqual([
			{ pageNum: 1, name: "field.a" },
			{ pageNum: 3, name: "field.c" },
		]);
		expect(result.formValues).toEqual({
			"field.a": "keep",
			"field.c": true,
		});
	});
});

describe("pruneItemsByPageOrder", () => {
	it("filters a generic pageNum list", () => {
		expect(
			pruneItemsByPageOrder([2], [
				{ pageNum: 1 },
				{ pageNum: 2 },
			]),
		).toEqual([{ pageNum: 2 }]);
	});
});

describe("buildPageRemapAfterInsert", () => {
	it("maps pre + post around inserted block", () => {
		// Insert 1 page after page 1 of [1,2,3] → pre=[1], extra=1, post=[2,3]
		// New: old1→1, blank→2, old2→3, old3→4
		const map = buildPageRemapAfterInsert([1], 1, [2, 3]);
		expect(map.get(1)).toBe(1);
		expect(map.get(2)).toBe(3);
		expect(map.get(3)).toBe(4);
		expect(map.has(99)).toBe(false);
	});
});

describe("remap after insert", () => {
	it("remaps bookmarks and comments to new page numbers", () => {
		const map = buildPageRemapAfterInsert([1], 1, [2, 3]);
		expect(
			remapBookmarksAfterInsert(
				[
					{ pageNum: 2, name: "Mid" },
					{ pageNum: 3, name: "End" },
				],
				map,
			),
		).toEqual([
			{ pageNum: 3, name: "Mid" },
			{ pageNum: 4, name: "End" },
		]);
		expect(
			remapCommentsAfterInsert([{ pageNum: 2, id: "c1", text: "hi" }], map),
		).toEqual([{ pageNum: 3, id: "c1", text: "hi" }]);
	});

	it("remaps hyperlinks so they stay on original content after blank insert", () => {
		// Blank insert after page 1: old page 2 content becomes page 3
		const map = buildPageRemapAfterInsert([1], 1, [2, 3]);
		const links = remapHyperlinksAfterInsert(
			[
				{
					id: "p2-l0",
					pageNum: 2,
					x: 10,
					y: 20,
					width: 30,
					height: 5,
					url: "https://example.com",
				},
				{
					id: "p1-l0",
					pageNum: 1,
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					url: "https://home.test",
				},
			],
			map,
		);
		expect(links).toEqual([
			{
				id: "p2-l0",
				pageNum: 3,
				x: 10,
				y: 20,
				width: 30,
				height: 5,
				url: "https://example.com",
			},
			{
				id: "p1-l0",
				pageNum: 1,
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				url: "https://home.test",
			},
		]);
		// Blank page (new page 2) has no hyperlinks
		expect(links.some((l) => l.pageNum === 2)).toBe(false);
	});

	it("remaps form fields so widgets stay on original content after blank insert", () => {
		const map = buildPageRemapAfterInsert([1], 1, [2]);
		const fields = remapFormFieldsAfterInsert(
			[
				{
					name: "Name",
					type: "text",
					pageNum: 2,
					x: 5,
					y: 10,
					width: 40,
					height: 4,
					widgetIndex: 0,
				},
				{
					name: "Agree",
					type: "checkbox",
					pageNum: 1,
					x: 1,
					y: 2,
					width: 3,
					height: 3,
					widgetIndex: 0,
				},
			],
			map,
		);
		// old page 2 → new page 3; old page 1 stays 1
		expect(fields.find((f) => f.name === "Name")?.pageNum).toBe(3);
		expect(fields.find((f) => f.name === "Agree")?.pageNum).toBe(1);
		expect(fields.some((f) => f.pageNum === 2)).toBe(false);
	});

	it("remaps shapes and rotations keys", () => {
		const map = buildPageRemapAfterInsert([1], 1, [2]);
		expect(
			remapShapesAfterInsert(
				{
					1: [{ type: "rect" } as never],
					2: [{ type: "text" } as never],
				},
				map,
			),
		).toEqual({
			1: [{ type: "rect" }],
			3: [{ type: "text" }],
		});
		expect(remapRotationsAfterInsert({ 2: 90 }, map)).toEqual({ 3: 90 });
	});

	it("session helper remaps links + form fields with everything else", () => {
		const result = remapSessionAfterPageInsert({
			prePagesOrder: [1],
			extraPageCount: 2,
			postPagesOrder: [2],
			bookmarks: [{ pageNum: 2, name: "B" }],
			comments: [{ pageNum: 2, id: "c" }],
			shapes: { 2: [{ type: "pen" } as never] },
			rotations: { 2: 180 },
			currentPage: 2,
			hyperlinks: [
				{ id: "p2-l0", pageNum: 2, url: "https://x.test" },
			],
			formFields: [{ name: "email", pageNum: 2 }],
			formValues: { email: "a@b.c" },
		});
		// pre=1 → page 1; extras at 2,3; old 2 → 4
		expect(result.bookmarks).toEqual([{ pageNum: 4, name: "B" }]);
		expect(result.comments).toEqual([{ pageNum: 4, id: "c" }]);
		expect(result.shapes).toEqual({ 4: [{ type: "pen" }] });
		expect(result.rotations).toEqual({ 4: 180 });
		expect(result.currentPage).toBe(4);
		expect(result.hyperlinks).toEqual([
			{ id: "p2-l0", pageNum: 4, url: "https://x.test" },
		]);
		expect(result.formFields).toEqual([{ name: "email", pageNum: 4 }]);
		// Values stay name-keyed (not page-remapped)
		expect(result.formValues).toEqual({ email: "a@b.c" });
	});
});
