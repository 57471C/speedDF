/**
 * Lightweight remembered values for form fields and text annotations.
 * Persisted in localStorage under speeddf_form_memory.
 *
 * Structure:
 * - global: values available to every text-like field
 * - byKey: per field-type / field-name lists (MRU)
 */

export const FORM_MEMORY_KEY = "speeddf_form_memory";

export const ANNOTATION_TEXT_KEY = "annotation:text";
export const FORM_TEXT_TYPE_KEY = "form:text";

const MAX_GLOBAL = 50;
const MAX_PER_KEY = 25;
const MAX_VALUE_LEN = 500;
const MAX_SUGGESTIONS = 12;
/** Min characters before autocomplete suggestions appear. */
export const MIN_SUGGESTION_QUERY_LEN = 2;

export type FormMemoryData = {
	version: 1;
	/** Most-recently-used global values (front = newest). */
	global: string[];
	/** Per field-type / field-name MRU lists. */
	byKey: Record<string, string[]>;
};

export function emptyFormMemory(): FormMemoryData {
	return { version: 1, global: [], byKey: {} };
}

/** Stable key for a specific AcroForm field name. */
export function formFieldMemoryKey(fieldName: string): string {
	return `form:field:${fieldName.trim()}`;
}

function normalizeValue(raw: string): string | null {
	const v = raw.replace(/\s+/g, " ").trim();
	if (!v || v.length > MAX_VALUE_LEN) return null;
	return v;
}

function pushMru(list: string[], value: string, max: number): string[] {
	const next = [value, ...list.filter((x) => x !== value)];
	return next.slice(0, max);
}

export function loadFormMemory(): FormMemoryData {
	try {
		const raw = localStorage.getItem(FORM_MEMORY_KEY);
		if (!raw) return emptyFormMemory();
		const parsed = JSON.parse(raw) as Partial<FormMemoryData>;
		if (!parsed || typeof parsed !== "object") return emptyFormMemory();
		const global = Array.isArray(parsed.global)
			? parsed.global.filter((x): x is string => typeof x === "string")
			: [];
		const byKey: Record<string, string[]> = {};
		if (parsed.byKey && typeof parsed.byKey === "object") {
			for (const [k, v] of Object.entries(parsed.byKey)) {
				if (Array.isArray(v)) {
					byKey[k] = v.filter((x): x is string => typeof x === "string");
				}
			}
		}
		return { version: 1, global, byKey };
	} catch {
		return emptyFormMemory();
	}
}

export function persistFormMemory(data: FormMemoryData): void {
	try {
		localStorage.setItem(FORM_MEMORY_KEY, JSON.stringify(data));
	} catch {
		/* ignore quota / private mode */
	}
}

/**
 * Remember a value globally and (optionally) under one or more field keys.
 * Returns the updated snapshot (does not mutate input).
 */
export function rememberValue(
	data: FormMemoryData,
	raw: string,
	keys: string[] = [],
): FormMemoryData {
	const value = normalizeValue(raw);
	if (!value) return data;

	const byKey = { ...data.byKey };
	for (const key of keys) {
		if (!key) continue;
		byKey[key] = pushMru(byKey[key] || [], value, MAX_PER_KEY);
	}

	return {
		version: 1,
		global: pushMru(data.global, value, MAX_GLOBAL),
		byKey,
	};
}

/**
 * Remove a value. If `key` is set, only remove from that key list
 * (and from global if it no longer appears in any key). If key is omitted,
 * remove from global and every byKey list.
 */
export function removeValue(
	data: FormMemoryData,
	raw: string,
	key?: string,
): FormMemoryData {
	const value = normalizeValue(raw) ?? raw.trim();
	if (!value) return data;

	if (key) {
		const byKey = { ...data.byKey };
		if (byKey[key]) {
			const next = byKey[key].filter((x) => x !== value);
			if (next.length === 0) delete byKey[key];
			else byKey[key] = next;
		}
		// Keep global if still referenced elsewhere; otherwise drop it too
		const stillReferenced = Object.values(byKey).some((list) =>
			list.includes(value),
		);
		const global = stillReferenced
			? data.global
			: data.global.filter((x) => x !== value);
		return { version: 1, global, byKey };
	}

	const byKey: Record<string, string[]> = {};
	for (const [k, list] of Object.entries(data.byKey)) {
		const next = list.filter((x) => x !== value);
		if (next.length > 0) byKey[k] = next;
	}
	return {
		version: 1,
		global: data.global.filter((x) => x !== value),
		byKey,
	};
}

export function clearFormMemory(): FormMemoryData {
	return emptyFormMemory();
}

export function totalMemoryCount(data: FormMemoryData): number {
	const set = new Set(data.global);
	for (const list of Object.values(data.byKey)) {
		for (const v of list) set.add(v);
	}
	return set.size;
}

/**
 * Suggestions for a field: key-specific first, then type keys, then global.
 * Requires {@link MIN_SUGGESTION_QUERY_LEN}+ chars; case-insensitive **starts-with** match.
 * Deduped, capped. Returns [] when query is too short (no aggressive popdown).
 */
export function suggestionsFor(
	data: FormMemoryData,
	keys: string[],
	query = "",
): string[] {
	const q = query.trim().toLowerCase();
	if (q.length < MIN_SUGGESTION_QUERY_LEN) return [];

	const seen = new Set<string>();
	const out: string[] = [];

	const consider = (list: string[] | undefined) => {
		if (!list) return;
		for (const v of list) {
			if (seen.has(v)) continue;
			if (!v.toLowerCase().startsWith(q)) continue;
			seen.add(v);
			out.push(v);
			if (out.length >= MAX_SUGGESTIONS) return;
		}
	};

	for (const key of keys) consider(data.byKey[key]);
	consider(data.global);

	return out;
}

/** Whether the exact value is already remembered (global or any of the keys). */
export function isRemembered(
	data: FormMemoryData,
	raw: string,
	keys: string[] = [],
): boolean {
	const value = normalizeValue(raw);
	if (!value) return false;
	if (data.global.includes(value)) return true;
	return keys.some((k) => (data.byKey[k] || []).includes(value));
}

/** One unique remembered string + which stores hold it. */
export type FormMemoryRow = {
	value: string;
	/** "global" and/or form:field:… / form:text / annotation:text */
	keys: string[];
};

/** Flat list of all unique remembered values (sorted A→Z) for Settings UI. */
export function listAllMemoryValues(data: FormMemoryData): FormMemoryRow[] {
	const map = new Map<string, Set<string>>();
	const add = (value: string, key: string) => {
		if (!value) return;
		let set = map.get(value);
		if (!set) {
			set = new Set();
			map.set(value, set);
		}
		set.add(key);
	};
	for (const v of data.global || []) add(v, "global");
	for (const [k, list] of Object.entries(data.byKey || {})) {
		for (const v of list || []) add(v, k);
	}
	return [...map.entries()]
		.map(([value, keys]) => ({ value, keys: [...keys].sort() }))
		.sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: "base" }));
}

/**
 * Replace `oldRaw` with `newRaw` everywhere it appears (global + all keys).
 * Returns unchanged data when either value is empty/invalid.
 */
export function replaceMemoryValue(
	data: FormMemoryData,
	oldRaw: string,
	newRaw: string,
): FormMemoryData {
	const oldV = normalizeValue(oldRaw) ?? oldRaw.trim();
	const newV = normalizeValue(newRaw);
	if (!oldV || !newV || oldV === newV) return data;

	const without = removeValue(data, oldV);
	// Re-add under the same key set that held the old value
	const keys: string[] = [];
	if ((data.global || []).includes(oldV)) {
		// global is always updated by rememberValue
	}
	for (const [k, list] of Object.entries(data.byKey || {})) {
		if ((list || []).includes(oldV)) keys.push(k);
	}
	return rememberValue(without, newV, keys);
}
