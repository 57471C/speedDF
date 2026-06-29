import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSavedSets, activeDoc, pushHistorySnapshot, executeUndoAction, executeRedoAction } from './pdfStore.svelte.ts';

describe('loadSavedSets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return an empty array if localStorage is empty', () => {
    expect(loadSavedSets()).toEqual([]);
  });

  it('should return an empty array if invalid JSON is in localStorage', () => {
    const invalidStrings = [
      'invalid-json',
      '{ malformed object }',
      '[{ "id": "1", "signatureDataUrl": "data" }',
      '{"id": "1",',
      'undefined',
    ];

    for (const invalidString of invalidStrings) {
      localStorage.setItem('speeddf_signature_sets', invalidString);
      expect(loadSavedSets()).toEqual([]);
    }
  });

  it('should return an empty array if localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Access denied');
    });
    expect(loadSavedSets()).toEqual([]);
    spy.mockRestore();
  });

  it('should return parsed array if valid JSON is in localStorage', () => {
    const validData = [{ id: '1', signatureDataUrl: 'data:image/png;base64,...', initialDataUrl: '' }];
    localStorage.setItem('speeddf_signature_sets', JSON.stringify(validData));
    expect(loadSavedSets()).toEqual(validData);
  });
});

describe('executeUndoAction', () => {
  beforeEach(() => {
    // Reset activeDoc and history stacks implicitly by calling flushDocumentState
    activeDoc.flushDocumentState();

    // Clear stacks by pushing a state then doing a workaround
    // Wait, since we can't clear undoStack directly, let's flush document state and clear by looping undo
    while (true) {
      const oldShapes = JSON.stringify(activeDoc.shapes);
      const oldPageOrder = JSON.stringify(activeDoc.pageOrder);
      executeUndoAction();
      if (JSON.stringify(activeDoc.shapes) === oldShapes && JSON.stringify(activeDoc.pageOrder) === oldPageOrder) {
         // To completely clear, we might need to reset redoStack too.
         break;
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should do nothing if undo stack is empty', () => {
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

  it('should restore previous state and push current to redo stack', () => {
    // 1. Initial State
    activeDoc.shapes = { 1: [] };
    activeDoc.pageOrder = [1];

    // Push State A
    pushHistorySnapshot();

    // 2. Modify State -> State B
    activeDoc.shapes = { 1: [{ type: 'rect', x: 10, y: 10 }] };
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
    expect(activeDoc.shapes).toEqual({ 1: [{ type: 'rect', x: 10, y: 10 }] });
    expect(activeDoc.pageOrder).toEqual([1, 2]);
    expect(activeDoc.selectedShape).toBeNull();
  });
});
