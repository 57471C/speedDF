import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import SettingsModal from "../../components/SettingsModal.svelte";
import {
	APP_SETTINGS_KEY,
	defaultAppSettings,
	isToolEnabled,
	loadAppSettings,
	normalizeAppSettings,
	persistAppSettings,
	type SettingsHost,
} from "./appSettings";
import { saveAppSettings } from "./appSettings.svelte";

const WINDOWS: SettingsHost = {
	platform: "Win32",
	userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
};
const LINUX: SettingsHost = {
	platform: "Linux x86_64",
	userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
};

describe("appSettings", () => {
	afterEach(() => {
		cleanup();
		localStorage.removeItem(APP_SETTINGS_KEY);
	});

	it("defaults all tools on, ocr/dict off, updates on", () => {
		const d = defaultAppSettings(LINUX);
		expect(d.tools.calculator).toBe(true);
		expect(d.tools.scratchpad).toBe(true);
		expect(d.ocr).toBe(false);
		expect(d.dictionary).toBe(false);
		expect(d.checkUpdatesOnLaunch).toBe(true);
		expect(d.theme).toBe("dark");
	});

	it("defaults OCR on for a fresh Windows profile and does not store it yet", () => {
		expect(localStorage.getItem(APP_SETTINGS_KEY)).toBeNull();
		const loaded = loadAppSettings(WINDOWS);
		expect(loaded.ocr).toBe(true);
		expect(localStorage.getItem(APP_SETTINGS_KEY)).toBeNull();
	});

	it("keeps OCR off on Mac and Linux when nothing is saved", () => {
		expect(loadAppSettings(LINUX).ocr).toBe(false);
		expect(
			loadAppSettings({ platform: "MacIntel", userAgent: "Macintosh" }).ocr,
		).toBe(false);
	});

	it("does not replace a saved OCR value on Windows", () => {
		localStorage.setItem(
			APP_SETTINGS_KEY,
			JSON.stringify({ ocr: false, theme: "dark" }),
		);
		expect(loadAppSettings(WINDOWS).ocr).toBe(false);

		localStorage.setItem(
			APP_SETTINGS_KEY,
			JSON.stringify({ ocr: true, theme: "light" }),
		);
		expect(loadAppSettings(LINUX).ocr).toBe(true);
	});

	it("uses the Windows default when saved settings omit OCR", () => {
		localStorage.setItem(
			APP_SETTINGS_KEY,
			JSON.stringify({ theme: "dark", tools: { calculator: false } }),
		);
		expect(loadAppSettings(WINDOWS).ocr).toBe(true);
		expect(loadAppSettings(LINUX).ocr).toBe(false);
	});

	it("shows the OCR toggle on for a fresh Windows profile", () => {
		saveAppSettings(loadAppSettings(WINDOWS));
		render(SettingsModal, { show: true });
		const ocr = screen.getByRole("checkbox", { name: /OCR/i });
		expect((ocr as HTMLInputElement).checked).toBe(true);
	});

	it("round-trips through localStorage", () => {
		const s = defaultAppSettings(LINUX);
		s.ocr = true;
		s.tools.timer = false;
		persistAppSettings(s);
		const loaded = loadAppSettings();
		expect(loaded.ocr).toBe(true);
		expect(loaded.tools.timer).toBe(false);
		expect(isToolEnabled(loaded, "calculator")).toBe(true);
	});

	it("preserves light theme through normalization", () => {
		const n = normalizeAppSettings({ theme: "light" } as never);
		expect(n.theme).toBe("light");
	});
});
