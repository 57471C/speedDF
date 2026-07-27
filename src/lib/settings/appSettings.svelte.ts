/**
 * Reactive app settings facade. Live settings are what the app enforces;
 * open Settings clones a draft until Save.
 */

import {
	type AppSettings,
	type ToolId,
	cloneAppSettings,
	isToolEnabled as isToolEnabledPure,
	loadAppSettings,
	persistAppSettings,
} from "./appSettings";

let settings = $state<AppSettings>(loadAppSettings());
let revision = $state(0);

function touch() {
	revision += 1;
}

export function getAppSettings(): AppSettings {
	void revision;
	return settings;
}

export function isToolEnabled(id: ToolId): boolean {
	void revision;
	return isToolEnabledPure(settings, id);
}

export function isOcrEnabled(): boolean {
	void revision;
	return settings.ocr === true;
}

export function isDictionaryEnabled(): boolean {
	void revision;
	return settings.dictionary === true;
}

export function isCheckUpdatesOnLaunch(): boolean {
	void revision;
	return settings.checkUpdatesOnLaunch !== false;
}

/** Commit full settings object (after Save in the modal). */
export function saveAppSettings(next: AppSettings): void {
	const normalized = cloneAppSettings(next);
	// Light theme not available yet
	normalized.theme = "dark";
	settings = normalized;
	persistAppSettings(normalized);
	touch();
}

/** Snapshot for editing in the Settings modal (does not mutate live until Save). */
export function createSettingsDraft(): AppSettings {
	return cloneAppSettings(settings);
}
