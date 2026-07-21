/**
 * Reactive facade over form memory (localStorage-backed).
 * Session-global — shared across documents (intentional: memory is personal, not per-file).
 */

import {
	clearFormMemory as clearPure,
	isRemembered as isRememberedPure,
	loadFormMemory,
	persistFormMemory,
	rememberValue as rememberPure,
	removeValue as removePure,
	suggestionsFor as suggestionsPure,
	type FormMemoryData,
} from "./formMemory";

let data = $state<FormMemoryData>(loadFormMemory());
/** Bump consumers that only need a dependency. */
let revision = $state(0);

function commit(next: FormMemoryData) {
	data = next;
	revision += 1;
	persistFormMemory(next);
}

export function getFormMemoryData(): FormMemoryData {
	return data;
}

export function getFormMemoryRevision(): number {
	return revision;
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
