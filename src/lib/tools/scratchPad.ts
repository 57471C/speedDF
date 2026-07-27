/**
 * Scratch Pad persistence helpers (session + localStorage).
 * Stores HTML from a contentEditable notepad so formatting survives restarts.
 */

export const SCRATCH_PAD_STORAGE_KEY = "speeddf_scratch_pad";

const DEFAULT_HTML = "";

/** Load HTML content for the scratch pad (empty string when unset). */
export function loadScratchPadHtml(): string {
	if (typeof localStorage === "undefined") return DEFAULT_HTML;
	try {
		const raw = localStorage.getItem(SCRATCH_PAD_STORAGE_KEY);
		return raw == null ? DEFAULT_HTML : raw;
	} catch {
		return DEFAULT_HTML;
	}
}

/** Persist HTML content (best-effort). */
export function saveScratchPadHtml(html: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(SCRATCH_PAD_STORAGE_KEY, html ?? "");
	} catch {
		/* quota / private mode */
	}
}

/** Clear stored pad content. */
export function clearScratchPadHtml(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(SCRATCH_PAD_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}
