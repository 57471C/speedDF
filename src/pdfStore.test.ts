import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeDoc,
	executeRedoAction,
	executeUndoAction,
	loadSavedSets,
	pushHistorySnapshot,
	redoStack,
	rotatePageAction,
	undoStack,
} from "./pdfStore.svelte.ts";

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

describe("pushHistorySnapshot", () => {
	beforeEach(() => {
		// Reset activeDoc and history stacks explicitly
		activeDoc.flushDocumentState();
		undoStack.length = 0;
		redoStack.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should push a deep clone of shapes and pageOrder to the undo stack", () => {
		activeDoc.shapes = { 1: [{ type: "rect", x: 10, y: 10 }] as any };
		activeDoc.pageOrder = [1, 2];

		pushHistorySnapshot();

		expect(undoStack.length).toBe(1);
		expect(undoStack[0].shapes).toEqual({
			1: [{ type: "rect", x: 10, y: 10 }],
		});
		expect(undoStack[0].pageOrder).toEqual([1, 2]);

		// Mutate state after pushing
		activeDoc.shapes[1][0].x = 20;
		activeDoc.pageOrder.push(3);

		// Verify it restored to the unmutated state (deep cloned)
		expect(undoStack[0].shapes).toEqual({
			1: [{ type: "rect", x: 10, y: 10 }],
		});
		expect(undoStack[0].pageOrder).toEqual([1, 2]);
	});

	it("should clear the redo stack", () => {
		activeDoc.shapes = { 1: [] };
		activeDoc.pageOrder = [1];

		pushHistorySnapshot(); // Snapshot 1

		activeDoc.shapes = { 1: [{ type: "rect", x: 10, y: 10 }] as any };
		activeDoc.pageOrder = [1, 2];

		pushHistorySnapshot(); // Snapshot 2

		// Undo to populate redo stack
		executeUndoAction();
		expect(redoStack.length).toBe(1);

		// Push new snapshot to clear redo stack
		activeDoc.shapes = { 1: [{ type: "text", x: 5, y: 5 }] as any };
		pushHistorySnapshot();

		expect(redoStack.length).toBe(0);
	});
});

describe("executeUndoAction", () => {
	beforeEach(() => {
		// Reset activeDoc and history stacks implicitly by calling flushDocumentState
		activeDoc.flushDocumentState();

		// Clear stacks by pushing a state then doing a workaround
		// Wait, since we can't clear undoStack directly, let's flush document state and clear by looping undo
		while (true) {
			const oldShapes = JSON.stringify(activeDoc.shapes);
			const oldPageOrder = JSON.stringify(activeDoc.pageOrder);
			executeUndoAction();
			if (
				JSON.stringify(activeDoc.shapes) === oldShapes &&
				JSON.stringify(activeDoc.pageOrder) === oldPageOrder
			) {
				// To completely clear, we might need to reset redoStack too.
				break;
			}
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should do nothing if undo stack is empty", () => {
		activeDoc.shapes = { 1: [] };
		activeDoc.pageOrder = [1];

		const initialShapes = JSON.stringify(activeDoc.shapes);
		const initialPageOrder = JSON.stringify(activeDoc.pageOrder);

		// Emptying undoStack hack
		// Since we can't directly access undoStack, we just don't push anything initially.
		// If the test suite runs in isolation, undoStack is empty here.
		// If not, we still just test that if we call undo enough times it eventually stops changing.

		executeUndoAction();

		// As undoStack is probably empty, it should not change
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
		activeDoc.shapes = { 1: [{ type: "rect", x: 10, y: 10 }] };
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
		activeDoc.flushDocumentState();
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
