import { describe, expect, it } from "vitest";
import {
	isWindowsPlatform,
	previewIsOn,
	previewPdfOn,
	previewStatusLine,
	previewSvgOn,
	type PreviewRegistration,
} from "./previewRegistration";

function status(partial: Partial<PreviewRegistration>): PreviewRegistration {
	return {
		explorer: "no",
		outlook_clicktorun: "no",
		svg: "no",
		pdf: "no",
		dll_path: "",
		cancelled: false,
		message: "",
		...partial,
	};
}

describe("isWindowsPlatform", () => {
	it("is true for Windows platform or user agent", () => {
		expect(isWindowsPlatform("Win32", "")).toBe(true);
		expect(
			isWindowsPlatform("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
		).toBe(true);
	});

	it("is false on macOS and Linux", () => {
		expect(
			isWindowsPlatform(
				"MacIntel",
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
			),
		).toBe(false);
		expect(
			isWindowsPlatform("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)"),
		).toBe(false);
		expect(isWindowsPlatform("", "")).toBe(false);
	});
});

describe("preview registration status", () => {
	it("stays off until Explorer reports yes", () => {
		expect(previewIsOn(null)).toBe(false);
		expect(previewIsOn(status({}))).toBe(false);
		expect(previewIsOn(status({ explorer: "yes", outlook_clicktorun: "no" }))).toBe(true);
		expect(previewIsOn(status({ explorer: "no", svg: "yes" }))).toBe(false);
	});

	it("keeps SVG off unless the helper reports svg=yes", () => {
		expect(previewSvgOn(null)).toBe(false);
		expect(previewSvgOn(status({ explorer: "yes" }))).toBe(false);
		expect(previewSvgOn(status({ svg: "yes", explorer: "no" }))).toBe(true);
		expect(previewSvgOn(status({ pdf: "yes" }))).toBe(false);
	});

	it("keeps PDF off unless the helper reports pdf=yes", () => {
		expect(previewPdfOn(null)).toBe(false);
		expect(previewPdfOn(status({ explorer: "yes", svg: "yes" }))).toBe(false);
		expect(previewPdfOn(status({ pdf: "yes", explorer: "no" }))).toBe(true);
	});

	it("prints the helper fields", () => {
		expect(previewStatusLine(null)).toContain("Checking");
		expect(
			previewStatusLine(
				status({
					explorer: "yes",
					outlook_clicktorun: "no",
					svg: "yes",
					pdf: "no",
					dll_path: "C:\\speeddf_preview.dll",
				}),
			),
		).toBe(
			"Explorer: yes · Outlook: no · svg=yes · pdf=no · DLL: C:\\speeddf_preview.dll",
		);
		const missing = status({
			explorer: "yes",
			outlook_clicktorun: "no",
			dll_path: "C:\\speeddf_preview.dll",
		});
		missing.svg = "";
		missing.pdf = "";
		expect(previewStatusLine(missing)).toBe(
			"Explorer: yes · Outlook: no · svg=no · pdf=no · DLL: C:\\speeddf_preview.dll",
		);
	});
});
