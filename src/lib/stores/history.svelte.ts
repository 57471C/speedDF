/**
 * Undo / redo history for document canvas mutations (shapes + page order).
 * Bound to the active document store after `activeDoc` is constructed
 * to avoid circular module initialization.
 */

import type { AnnotationShape } from "../../pdfStore.svelte";

export interface HistorySnapshot {
	shapes: Record<number, AnnotationShape[]>;
	pageOrder: number[];
}

/** Minimal document surface the history stack needs to read/write. */
export type HistoryDocument = {
	isDirty: boolean;
	shapes: Record<number, AnnotationShape[]>;
	pageOrder: number[];
	selectedShape: { pageNumber: number; index: number } | null;
};

let historyDoc: HistoryDocument | null = null;

/** Wire the history module to the live active document facade. Call once after `activeDoc` exists. */
export function bindHistoryDocument(doc: HistoryDocument) {
	historyDoc = doc;
}

function doc(): HistoryDocument {
	if (!historyDoc) {
		throw new Error(
			"History document not bound. Call bindHistoryDocument(activeDoc) first.",
		);
	}
	return historyDoc;
}

// Memory-tracked transaction arrays
export const undoStack = $state<HistorySnapshot[]>([]);
export const redoStack = $state<HistorySnapshot[]>([]);

/**
 * ⏳ Commits a deep-cloned historical snapshot of the current canvas layout state onto the undo stack.
 * Call this immediately BEFORE executing any document mutation (drawing, deleting, reordering).
 */
export function pushHistorySnapshot() {
	const activeDoc = doc();
	activeDoc.isDirty = true;
	const snapshot: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes || {})),
		pageOrder: [...(activeDoc.pageOrder || [])],
	};
	undoStack.push(snapshot);

	// A new user action always invalidates and clears the forward redo stack path
	if (redoStack.length > 0) {
		redoStack.length = 0;
	}
}

/**
 * 🔄 Pops the last committed snapshot out of the undo stack and restores it safely.
 */
export function executeUndoAction() {
	if (undoStack.length === 0) return;

	const activeDoc = doc();
	const currentStatus: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes || {})),
		pageOrder: [...(activeDoc.pageOrder || [])],
	};
	redoStack.push(currentStatus);

	const previousState = undoStack.pop();
	if (previousState) {
		activeDoc.shapes = previousState.shapes;
		activeDoc.pageOrder = previousState.pageOrder;
		activeDoc.selectedShape = null;
	}
}

/**
 * ➡️ Pops the last state out of the redo stack and shifts the application forward.
 */
export function executeRedoAction() {
	if (redoStack.length === 0) return;

	const activeDoc = doc();
	const currentStatus: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes || {})),
		pageOrder: [...(activeDoc.pageOrder || [])],
	};
	undoStack.push(currentStatus);

	const nextState = redoStack.pop();
	if (nextState) {
		activeDoc.shapes = nextState.shapes;
		activeDoc.pageOrder = nextState.pageOrder;
		activeDoc.selectedShape = null;
	}
}
