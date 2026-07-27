/**
 * Reactive facade over form memory (localStorage-backed).
 * Session-global — shared across documents (intentional: memory is personal, not per-file).
 */

import {
	clearFormMemory as clearPure,
	type FormMemoryData,
	type FormMemoryRow,
	isRemembered as isRememberedPure,
	listAllMemoryValues as listAllPure,
	loadFormMemory,
	persistFormMemory,
	rememberValue as rememberPure,
	removeValue as removePure,
	replaceMemoryValue as replacePure,
	suggestionsFor as suggestionsPure,
} from "./formMemory";

let data = $state<FormMemoryData>(loadFormMemory());
/** Bump consumers that only need a dependency. */
let revision = $state(0);

function commit(next: FormMemoryData) {
	data = next;
	revision += 1;
	persistFormMemory(next);
}

export function getSuggestions(keys: string[], query = ""): string[] {
	// Touch revision so callers re-run when memory mutates
	void revision;
	return suggestionsPure(data, keys, query);
}

export function valueIsRemembered(value: string, keys: string[] = []): boolean {
	void revision;
	return isRememberedPure(data, value, keys);
}

export function rememberFormValue(value: string, keys: string[] = []): void {
	commit(rememberPure(data, value, keys));
}

export function removeFormValue(value: string, key?: string): void {
	commit(removePure(data, value, key));
}

export function clearAllFormMemory(): void {
	commit(clearPure());
}

/** All unique remembered values for the Settings table. */
export function listAllFormMemory(): FormMemoryRow[] {
	void revision;
	return listAllPure(data);
}

/** Rename a remembered value everywhere it appears. */
export function replaceFormMemoryValue(oldValue: string, newValue: string): void {
	commit(replacePure(data, oldValue, newValue));
}

/** Snapshot of the raw store (read-only use). */
export function getFormMemorySnapshot(): FormMemoryData {
	void revision;
	return data;
}
