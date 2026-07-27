import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AnnotationShape,
	activeDoc,
	addBookmarkAction,
	addOrToggleBookmarkAction,
	cleanupWorkspace,
	deleteBookmarkAction,
	documentKey,
	executeRedoAction,
	executeUndoAction,
	initializeNewDocument,
	loadSavedSets,
	purgeDocumentResources,
	pushHistorySnapshot,
	redoStack,
	rotatePageAction,
	saveSignatureSetAction,
	setFormFieldValueAction,
	undoStack,
	updateBookmarkNameAction,
} from "./pdfStore.svelte.ts";

/** Minimal shape fixture for history tests. */
function shapeStub(
	type: AnnotationShape["type"],
	x: number,
	y: number,
): AnnotationShape {
	return { type, x, y };
}

/** Ensure multi-document facade has a current workspace (setters no-op without one). */
function openTestDocument(name = "test.pdf") {
	activeDoc.flushDocumentState();
	initializeNewDocument(name, null);
}

describe("loadSavedSets", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return an empty array if localStorage is empty", () => {
		expect(loadSavedSets()).toEqual([]);
	});

	it("should return an empty array if invalid JSON is in localStorage", () => {
		const invalidStrings = [
			"invalid-json",
			"{ malformed object }",
			'[{ "id": "1", "signatureDataUrl": "data" }',
			'{"id": "1",',
			"undefined",
		];

		for (const invalidString of invalidStrings) {
			localStorage.setItem("speeddf_signature_sets", invalidString);
			expect(loadSavedSets()).toEqual([]);
		}
	});

	it("should return an empty array if localStorage.getItem throws", () => {
		const spy = vi
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new Error("Access denied");
			});
		expect(loadSavedSets()).toEqual([]);
		spy.mockRestore();
	});

	it("should return parsed array if valid JSON is in localStorage", () => {
		const validData = [
			{
				id: "1",
				signatureDataUrl: "data:image/png;base64,...",
				initialDataUrl: "",
			},
		];
		localStorage.setItem("speeddf_signature_sets", JSON.stringify(validData));
		expect(loadSavedSets()).toEqual(validData);
	});
});

describe("setFormFieldValueAction", () => {
	beforeEach(() => {
		openTestDocument();
		activeDoc.isDirty = false;
		activeDoc.formValues = {};
	});

	it("should do nothing if name is empty", () => {
		setFormFieldValueAction("", "some-value");
		expect(activeDoc.formValues).toEqual({});
		expect(activeDoc.isDirty).toBe(false);
	});

	it("should add a new form value and set isDirty to true", () => {
		setFormFieldValueAction("field1", "value1");
		expect(activeDoc.formValues).toEqual({ field1: "value1" });
		expect(activeDoc.isDirty).toBe(true);
	});

	it("should update an existing value correctly without losing other keys", () => {
		activeDoc.formValues = { field1: "oldValue1", field2: "value2" };
		setFormFieldValueAction("field1", "newValue1");
		expect(activeDoc.formValues).toEqual({
			field1: "newValue1",
			field2: "value2",
		});
		expect(activeDoc.isDirty).toBe(true);
	});

	it("should do nothing if the existing value is exactly the same as the new one", () => {
		activeDoc.formValues = { field1: "value1" };
		setFormFieldValueAction("field1", "value1");
		expect(activeDoc.formValues).toEqual({ field1: "value1" });
		expect(activeDoc.isDirty).toBe(false);
	});
});

describe("saveSignatureSetAction", () => {
	beforeEach(() => {
		activeDoc.flushDocumentState();
		activeDoc.savedSignatureSets = [];
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should append a new signature set to activeDoc.savedSignatureSets", () => {
		const newSet = {
			id: "1",
			signatureDataUrl: "data:image/png;base64,sig1",
			initialDataUrl: "data:image/png;base64,ini1",
		};
		saveSignatureSetAction(newSet);
		expect(activeDoc.savedSignatureSets).toEqual([newSet]);
	});

	it("should correctly update localStorage with the updated array", () => {
		const newSet = {
			id: "1",
			signatureDataUrl: "data:image/png;base64,sig1",
			initialDataUrl: "data:image/png;base64,ini1",
		};
		const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
		saveSignatureSetAction(newSet);
		expect(setItemSpy).toHaveBeenCalledWith(
			"speeddf_signature_sets",
			JSON.stringify([newSet]),
		);
		expect(localStorage.getItem("speeddf_signature_sets")).toEqual(
			JSON.stringify([newSet]),
		);
	});

	it("should sequentially add multiple signature sets", () => {
		const set1 = {
			id: "1",
			signatureDataUrl: "data:image/png;base64,sig1",
			initialDataUrl: "data:image/png;base64,ini1",
		};
		const set2 = {
			id: "2",
			signatureDataUrl: "data:image/png;base64,sig2",
			initialDataUrl: "data:image/png;base64,ini2",
		};

		saveSignatureSetAction(set1);
		saveSignatureSetAction(set2);

		expect(activeDoc.savedSignatureSets).toEqual([set1, set2]);
		expect(localStorage.getItem("speeddf_signature_sets")).toEqual(
			JSON.stringify([set1, set2]),
		);
	});
});

describe("pushHistorySnapshot", () => {
	beforeEach(() => {
		// Reset activeDoc and history stacks explicitly
		openTestDocument();
		undoStack.length = 0;
		redoStack.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should push a deep clone of shapes and pageOrder to the undo stack", () => {
		activeDoc.shapes = { 1: [shapeStub("rect", 10, 10)] };
		activeDoc.pageOrder = [1, 2];

		pushHistorySnapshot();

		expect(undoStack.length).toBe(1);
		expect(undoStack[0].shapes).toEqual({
			1: [shapeStub("rect", 10, 10)],
		});
		expect(undoStack[0].pageOrder).toEqual([1, 2]);

		// Mutate state after pushing
		activeDoc.shapes[1][0].x = 20;
		activeDoc.pageOrder.push(3);

		// Verify it restored to the unmutated state (deep cloned)
		expect(undoStack[0].shapes).toEqual({
			1: [shapeStub("rect", 10, 10)],
		});
		expect(undoStack[0].pageOrder).toEqual([1, 2]);
	});

	it("should clear the redo stack", () => {
		activeDoc.shapes = { 1: [] };
		activeDoc.pageOrder = [1];

		pushHistorySnapshot(); // Snapshot 1

		activeDoc.shapes = { 1: [shapeStub("rect", 10, 10)] };
		activeDoc.pageOrder = [1, 2];

		pushHistorySnapshot(); // Snapshot 2

		// Undo to populate redo stack
		executeUndoAction();
		expect(redoStack.length).toBe(1);

		// Push new snapshot to clear redo stack
		activeDoc.shapes = { 1: [shapeStub("text", 5, 5)] };
		pushHistorySnapshot();

		expect(redoStack.length).toBe(0);
	});
});

describe("executeUndoAction", () => {
	beforeEach(() => {
		// Reset activeDoc and history stacks explicitly
		openTestDocument();
		undoStack.length = 0;
		redoStack.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should do nothing if undo stack is empty", () => {
		activeDoc.shapes = { 1: [] };
		activeDoc.pageOrder = [1];

		const initialShapes = JSON.stringify(activeDoc.shapes);
		const initialPageOrder = JSON.stringify(activeDoc.pageOrder);

		executeUndoAction();

		// As undoStack is empty, it should not change
		expect(JSON.stringify(activeDoc.shapes)).toEqual(initialShapes);
		expect(JSON.stringify(activeDoc.pageOrder)).toEqual(initialPageOrder);
	});

	it("should restore previous state and push current to redo stack", () => {
		// 1. Initial State
		activeDoc.shapes = { 1: [] };
		activeDoc.pageOrder = [1];

		// Push State A
		pushHistorySnapshot();

		// 2. Modify State -> State B
		activeDoc.shapes = { 1: [shapeStub("rect", 10, 10)] };
		activeDoc.pageOrder = [1, 2];
		activeDoc.selectedShape = { pageNumber: 1, index: 0 };

		// 3. Undo
		executeUndoAction();

		// Verify it restored State A
		expect(activeDoc.shapes).toEqual({ 1: [] });
		expect(activeDoc.pageOrder).toEqual([1]);
		expect(activeDoc.selectedShape).toBeNull();

		// 4. Redo (to verify it was pushed to redo stack)
		executeRedoAction();

		// Verify it restored State B
		expect(activeDoc.shapes).toEqual({ 1: [{ type: "rect", x: 10, y: 10 }] });
		expect(activeDoc.pageOrder).toEqual([1, 2]);
		expect(activeDoc.selectedShape).toBeNull();
	});
});

describe("rotatePageAction", () => {
	beforeEach(() => {
		openTestDocument();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should rotate page 90 degrees clockwise from default", () => {
		rotatePageAction(1, "clockwise");
		expect(activeDoc.rotations[1]).toBe(90);
	});

	it("should wrap around to 0 degrees when rotating clockwise past 270", () => {
		activeDoc.rotations[1] = 270;
		rotatePageAction(1, "clockwise");
		expect(activeDoc.rotations[1]).toBe(0);
	});

	it("should rotate page 90 degrees counter-clockwise from default (wraps to 270)", () => {
		rotatePageAction(2, "counter");
		expect(activeDoc.rotations[2]).toBe(270);
	});

	it("should rotate page counter-clockwise correctly from an existing rotation", () => {
		activeDoc.rotations[2] = 180;
		rotatePageAction(2, "counter");
		expect(activeDoc.rotations[2]).toBe(90);
	});
});

describe("deleteBookmarkAction", () => {
	beforeEach(() => {
		openTestDocument();
	});

	it("should do nothing if no bookmarks exist", () => {
		expect(activeDoc.bookmarks).toEqual([]);
		deleteBookmarkAction(1);
		expect(activeDoc.bookmarks).toEqual([]);
	});

	it("should remove the specified bookmark", () => {
		activeDoc.bookmarks = [{ pageNum: 1, name: "Test" }];
		deleteBookmarkAction(1);
		expect(activeDoc.bookmarks).toEqual([]);
	});

	it("should only remove the bookmark with the specified page number when multiple bookmarks exist", () => {
		activeDoc.bookmarks = [
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 2, name: "Test 2" },
			{ pageNum: 3, name: "Test 3" },
		];
		deleteBookmarkAction(2);
		expect(activeDoc.bookmarks).toEqual([
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 3, name: "Test 3" },
		]);
	});

	it("should do nothing if a bookmark with the specified page number does not exist", () => {
		activeDoc.bookmarks = [
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 3, name: "Test 3" },
		];
		deleteBookmarkAction(2);
		expect(activeDoc.bookmarks).toEqual([
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 3, name: "Test 3" },
		]);
	});
});

describe("updateBookmarkNameAction", () => {
	beforeEach(() => {
		openTestDocument();
	});

	it("should update the name of an existing bookmark", () => {
		activeDoc.bookmarks = [{ pageNum: 1, name: "Test" }];
		updateBookmarkNameAction(1, "New Name");
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 1, name: "New Name" }]);
	});

	it("should do nothing if the bookmark does not exist", () => {
		activeDoc.bookmarks = [{ pageNum: 1, name: "Test" }];
		updateBookmarkNameAction(2, "New Name");
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 1, name: "Test" }]);
	});

	it("should only update the name of the specified bookmark when multiple bookmarks exist", () => {
		activeDoc.bookmarks = [
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 2, name: "Test 2" },
			{ pageNum: 3, name: "Test 3" },
		];
		updateBookmarkNameAction(2, "New Name 2");
		expect(activeDoc.bookmarks).toEqual([
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 2, name: "New Name 2" },
			{ pageNum: 3, name: "Test 3" },
		]);
	});
});

describe("addOrToggleBookmarkAction", () => {
	beforeEach(() => {
		openTestDocument();
	});

	it("should add a new bookmark when none exists for the page", () => {
		expect(activeDoc.bookmarks).toEqual([]);
		addOrToggleBookmarkAction(1);
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 1, name: "" }]);
	});

	it("should remove an existing bookmark when one exists for the page", () => {
		activeDoc.bookmarks = [{ pageNum: 1, name: "Test" }];
		addOrToggleBookmarkAction(1);
		expect(activeDoc.bookmarks).toEqual([]);
	});

	it("should add a bookmark when other bookmarks exist", () => {
		activeDoc.bookmarks = [{ pageNum: 1, name: "Test 1" }];
		addOrToggleBookmarkAction(2);
		expect(activeDoc.bookmarks).toEqual([
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 2, name: "" },
		]);
	});

	it("should remove the correct bookmark when multiple exist", () => {
		activeDoc.bookmarks = [
			{ pageNum: 1, name: "Test 1" },
			{ pageNum: 2, name: "Test 2" },
		];
		addOrToggleBookmarkAction(1);
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 2, name: "Test 2" }]);
	});
});

describe("addBookmarkAction", () => {
	beforeEach(() => {
		openTestDocument();
	});

	it("adds a named bookmark without toggling off", () => {
		addBookmarkAction(1, "Intro");
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 1, name: "Intro" }]);
		// Second call updates name, does not remove
		addBookmarkAction(1, "Introduction");
		expect(activeDoc.bookmarks).toEqual([
			{ pageNum: 1, name: "Introduction" },
		]);
	});

	it("allows an empty title (user can fill later)", () => {
		addBookmarkAction(2, "");
		expect(activeDoc.bookmarks).toEqual([{ pageNum: 2, name: "" }]);
	});

	it("ignores invalid page numbers", () => {
		addBookmarkAction(0, "Nope");
		expect(activeDoc.bookmarks).toEqual([]);
	});
});

describe("purgeDocumentResources / cleanupWorkspace", () => {
	beforeEach(() => {
		activeDoc.flushDocumentState();
	});

	it("purgeDocumentResources clears heavy fields in place", () => {
		const doc = initializeNewDocument("big.pdf", "C:/tmp/big.pdf");
		doc.fileType = "pdf";
		doc.rawBytes = new Uint8Array([1, 2, 3, 4]);
		doc.shapes = { 1: [shapeStub("rect", 1, 2)] };
		doc.pageThumbnailOverrides = { 0: "data:image/jpeg;base64,xx" };
		doc.cachedDimensions = [{ width: 612, height: 792 }];
		doc.tiffPages = [new Uint8Array([9])];
		doc.formFields = [{ name: "f", type: "text" } as never];
		doc.formValues = { f: "v" };
		doc.hyperlinks = [{ url: "https://x.test" } as never];
		doc.bookmarks = [{ pageNum: 1, name: "B" }];
		doc.comments = [{ id: "c1", pageNum: 1, text: "hi" } as never];
		doc.rotations = { 1: 90 };
		doc.pageOrder = [1, 2];
		doc.pageCount = 2;
		doc.isDirty = true;

		purgeDocumentResources(doc);

		expect(doc.rawBytes).toBeNull();
		expect(doc.shapes).toEqual({});
		expect(doc.pageThumbnailOverrides).toEqual({});
		expect(doc.cachedDimensions).toBeUndefined();
		expect(doc.tiffPages).toEqual([]);
		expect(doc.formFields).toEqual([]);
		expect(doc.formValues).toEqual({});
		expect(doc.hyperlinks).toEqual([]);
		expect(doc.bookmarks).toEqual([]);
		expect(doc.comments).toEqual([]);
		expect(doc.rotations).toEqual({});
		expect(doc.pageOrder).toEqual([]);
		expect(doc.pageCount).toBe(0);
		expect(doc.isDirty).toBe(false);
		expect(doc.fileType).toBeNull();
	});

	it("cleanupWorkspace removes the tab and clears heavy data", async () => {
		const doc = initializeNewDocument("close-me.pdf", "C:/tmp/close-me.pdf");
		const id = documentKey(doc);
		// Mutate via activeDoc facade so we hit the live $state proxy entry
		activeDoc.rawBytes = new Uint8Array(1024);
		activeDoc.shapes = { 1: [shapeStub("text", 0, 0)] };
		activeDoc.pageThumbnailOverrides = { 0: "data:image/png;base64,aa" };
		activeDoc.pageOrder = [1];
		activeDoc.pageCount = 1;
		activeDoc.fileType = "pdf";
		activeDoc.isDirty = true;

		expect(activeDoc.openDocuments.some((d) => documentKey(d) === id)).toBe(
			true,
		);
		expect(activeDoc.rawBytes?.byteLength).toBe(1024);

		await cleanupWorkspace(id);

		expect(activeDoc.openDocuments.some((d) => documentKey(d) === id)).toBe(
			false,
		);
		// Live store no longer exposes the closed document's payloads
		expect(activeDoc.rawBytes).toBeNull();
		expect(activeDoc.shapes).toEqual({});
		expect(activeDoc.pageThumbnailOverrides).toEqual({});
		expect(activeDoc.activeDocumentId).toBeNull();
		// Original handle (may be $state proxy) should also have been purged
		expect(doc.rawBytes).toBeNull();
		expect(doc.shapes).toEqual({});
	});

	it("cleanupWorkspace is safe to call twice", async () => {
		const doc = initializeNewDocument("once.pdf", null);
		const id = documentKey(doc);
		await cleanupWorkspace(id);
		await expect(cleanupWorkspace(id)).resolves.toBeUndefined();
	});
});
