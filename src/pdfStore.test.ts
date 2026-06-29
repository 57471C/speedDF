import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSavedSets } from './pdfStore.svelte.ts';

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
    localStorage.setItem('speeddf_signature_sets', 'invalid-json');
    expect(loadSavedSets()).toEqual([]);
  });

  it('should return parsed array if valid JSON is in localStorage', () => {
    const validData = [{ id: '1', signatureDataUrl: 'data:image/png;base64,...', initialDataUrl: '' }];
    localStorage.setItem('speeddf_signature_sets', JSON.stringify(validData));
    expect(loadSavedSets()).toEqual(validData);
  });
});
