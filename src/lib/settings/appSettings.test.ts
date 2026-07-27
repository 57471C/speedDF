import { afterEach, describe, expect, it } from "vitest";
import {
	APP_SETTINGS_KEY,
	defaultAppSettings,
	isToolEnabled,
	loadAppSettings,
	normalizeAppSettings,
	persistAppSettings,
} from "./appSettings";

describe("appSettings", () => {
	afterEach(() => {
		localStorage.removeItem(APP_SETTINGS_KEY);
	});

	it("defaults all tools on, ocr/dict off, updates on", () => {
		const d = defaultAppSettings();
		expect(d.tools.calculator).toBe(true);
		expect(d.tools.scratchpad).toBe(true);
		expect(d.ocr).toBe(false);
		expect(d.dictionary).toBe(false);
		expect(d.checkUpdatesOnLaunch).toBe(true);
		expect(d.theme).toBe("dark");
	});

	it("round-trips through localStorage", () => {
		const s = defaultAppSettings();
		s.ocr = true;
		s.tools.timer = false;
		persistAppSettings(s);
		const loaded = loadAppSettings();
		expect(loaded.ocr).toBe(true);
		expect(loaded.tools.timer).toBe(false);
		expect(isToolEnabled(loaded, "calculator")).toBe(true);
	});

	it("forces dark theme until light ships", () => {
		const n = normalizeAppSettings({ theme: "light" } as never);
		expect(n.theme).toBe("dark");
	});
});
