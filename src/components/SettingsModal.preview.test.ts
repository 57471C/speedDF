import { cleanup, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsModal from "./SettingsModal.svelte";

const previewTest = vi.hoisted(() => ({
	windows: true,
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: previewTest.invoke,
}));

vi.mock("../lib/preview/previewRegistration", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../lib/preview/previewRegistration")>();
	return {
		...actual,
		isWindowsPlatform: () => previewTest.windows,
	};
});

describe("Settings Preview section", () => {
	beforeEach(() => {
		previewTest.invoke.mockReset();
		previewTest.invoke.mockResolvedValue({
			explorer: "yes",
			outlook_clicktorun: "yes",
			dll_path: "C:\\speeddf_preview.dll",
			cancelled: false,
			message: "",
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("omits the section on macOS and Linux", async () => {
		previewTest.windows = false;
		render(SettingsModal, { show: true });
		await tick();
		expect(screen.queryByRole("heading", { name: "Preview" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Repair" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
		expect(screen.queryByText("Markdown preview in Explorer and Outlook")).toBeNull();
		expect(previewTest.invoke).not.toHaveBeenCalled();
	});

	it("shows the section and UAC shields on Windows", async () => {
		previewTest.windows = true;
		render(SettingsModal, { show: true });
		expect(screen.getByRole("heading", { name: "Preview" })).toBeTruthy();
		expect(screen.getByText("Markdown preview in Explorer and Outlook")).toBeTruthy();
		for (const name of ["Enable", "Repair", "Disable"]) {
			const button = screen.getByRole("button", { name });
			const html = button.innerHTML.toLowerCase();
			expect(html).toContain("#0078d4");
			expect(html).toContain("#ffb900");
			expect(html).toContain("url(#speeddf-uac-");
			expect(button.querySelectorAll("svg")).toHaveLength(1);
		}
		await tick();
		expect(previewTest.invoke).toHaveBeenCalled();
	});
});
