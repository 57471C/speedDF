/**
 * Pure app settings model + localStorage persistence.
 * Defaults: all tools ON; dictionary OFF; update check ON; dark theme.
 * OCR defaults on for Windows only when the user has no saved value.
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

/** Platform strings, same shape the preview gate uses. */
export type SettingsHost = {
	platform: string;
	userAgent: string;
};

function currentHost(): SettingsHost {
	if (typeof navigator === "undefined") {
		return { platform: "", userAgent: "" };
	}
	return {
		platform: navigator.platform ?? "",
		userAgent: navigator.userAgent ?? "",
	};
}

function isWindowsHost(host: SettingsHost): boolean {
	return host.platform.includes("Win") || host.userAgent.includes("Windows");
}

export function defaultAppSettings(host: SettingsHost = currentHost()): AppSettings {
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
		// Windows-only default. A saved boolean always wins in normalizeAppSettings.
		ocr: isWindowsHost(host),
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
	host: SettingsHost = currentHost(),
): AppSettings {
	const d = defaultAppSettings(host);
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

export function loadAppSettings(host: SettingsHost = currentHost()): AppSettings {
	try {
		if (typeof localStorage === "undefined") return defaultAppSettings(host);
		const raw = localStorage.getItem(APP_SETTINGS_KEY);
		if (!raw) return defaultAppSettings(host);
		return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>, host);
	} catch {
		return defaultAppSettings(host);
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
