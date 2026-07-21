import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AnnotationShape,
	activeDoc,
	addOrToggleBookmarkAction,
	deleteBookmarkAction,
	executeRedoAction,
	executeUndoAction,
	initializeNewDocument,
	loadSavedSets,
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
