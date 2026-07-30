/**
 * Pure app settings model + localStorage persistence.
 * Defaults: all tools ON; OCR/dictionary OFF; update check ON; dark theme.
 */

export const APP_SETTINGS_KEY = "speeddf_app_settings";

export type ThemeMode = "dark" | "light";

export type ToolId =
	| "calculator"
	| "timer"
	| "stopwatch"
	| "magic8ball"
	| "scratchpad";

export type AppSettings = {
	version: 1;
	theme: ThemeMode;
	tools: Record<ToolId, boolean>;
	/** Network features */
	ocr: boolean;
	dictionary: boolean;
	checkUpdatesOnLaunch: boolean;
};

export const TOOL_LABELS: Record<ToolId, string> = {
	calculator: "Calculator",
	timer: "Timer",
	stopwatch: "Stopwatch",
	magic8ball: "Magic 8 Ball",
	scratchpad: "Scratch Pad",
};

export const TOOL_IDS: ToolId[] = [
	"calculator",
	"timer",
	"stopwatch",
	"magic8ball",
	"scratchpad",
];

export function defaultAppSettings(): AppSettings {
	return {
		version: 1,
		theme: "dark",
		tools: {
			calculator: true,
			timer: true,
			stopwatch: true,
			magic8ball: true,
			scratchpad: true,
		},
		ocr: false,
		dictionary: false,
		checkUpdatesOnLaunch: true,
	};
}

function coerceBool(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

/** Merge partial/legacy storage into a full settings object. */
export function normalizeAppSettings(
	raw: Partial<AppSettings> | null | undefined,
): AppSettings {
	const d = defaultAppSettings();
	if (!raw || typeof raw !== "object") return d;
	const tools = { ...d.tools };
	if (raw.tools && typeof raw.tools === "object") {
		for (const id of TOOL_IDS) {
			if (typeof (raw.tools as Record<string, unknown>)[id] === "boolean") {
				tools[id] = (raw.tools as Record<ToolId, boolean>)[id];
			}
		}
	}
	return {
		version: 1,
		theme: raw.theme === "light" ? "light" : "dark",
		tools,
		ocr: coerceBool(raw.ocr, d.ocr),
		dictionary: coerceBool(raw.dictionary, d.dictionary),
		checkUpdatesOnLaunch: coerceBool(
			raw.checkUpdatesOnLaunch,
			d.checkUpdatesOnLaunch,
		),
	};
}

export function loadAppSettings(): AppSettings {
	try {
		if (typeof localStorage === "undefined") return defaultAppSettings();
		const raw = localStorage.getItem(APP_SETTINGS_KEY);
		if (!raw) return defaultAppSettings();
		return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>);
	} catch {
		return defaultAppSettings();
	}
}

export function persistAppSettings(settings: AppSettings): void {
	try {
		if (typeof localStorage === "undefined") return;
		localStorage.setItem(
			APP_SETTINGS_KEY,
			JSON.stringify(normalizeAppSettings(settings)),
		);
	} catch {
		/* quota / private mode */
	}
}

export function cloneAppSettings(s: AppSettings): AppSettings {
	return normalizeAppSettings(JSON.parse(JSON.stringify(s)) as AppSettings);
}

export function isToolEnabled(settings: AppSettings, id: ToolId): boolean {
	return settings.tools[id] !== false;
}
