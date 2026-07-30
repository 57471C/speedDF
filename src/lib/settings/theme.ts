/**
 * Pure theme utility — no Svelte reactivity.
 * Sets `data-theme` on <html> so CSS custom-property selectors activate.
 */

import type { ThemeMode } from "./appSettings";
import { APP_SETTINGS_KEY } from "./appSettings";

/** Apply theme by setting data-theme attribute on the document element. */
export function applyTheme(mode: ThemeMode): void {
	if (typeof document === "undefined") return;
	document.documentElement.dataset.theme = mode;
}

/**
 * Read the persisted theme from localStorage without pulling in the full
 * settings normalizer. Used by the inline blocking script in app.html
 * and by the reactive facade on startup.
 */
export function getPersistedTheme(): ThemeMode {
	try {
		if (typeof localStorage === "undefined") return "dark";
		const raw = localStorage.getItem(APP_SETTINGS_KEY);
		if (!raw) return "dark";
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && parsed.theme === "light") {
			return "light";
		}
	} catch {
		/* corrupt / missing — fall through */
	}
	return "dark";
}
