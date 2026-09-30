import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignatureOrInitialShape } from "../lib/annotation/toolShapes";
import { activeDoc } from "../pdfStore.svelte.ts";
import ToolSidebar from "./ToolSidebar.svelte";

vi.mock("pdfjs-dist", () => ({
	getDocument: vi.fn(),
}));

async function typeInto(el: HTMLInputElement, value: string) {
	el.value = value;
	await fireEvent.input(el);
}

async function openSignoff() {
	await fireEvent.click(screen.getByTitle("Signatures & Initials"));
	await screen.findByPlaceholderText("First name");
}

describe("sign-off name fields", () => {
	beforeEach(() => {
		localStorage.removeItem("speeddf_signature_sets");
		activeDoc.savedSignatureSets = [];
		activeDoc.activeStampText = null;
		activeDoc.activeStampDataUrl = null;
		activeDoc.activeTool = "select";
	});

	afterEach(() => {
		cleanup();
		localStorage.removeItem("speeddf_signature_sets");
		activeDoc.savedSignatureSets = [];
		activeDoc.activeStampText = null;
		activeDoc.activeStampDataUrl = null;
		activeDoc.activeTool = "select";
	});

	it("previews Terry Minett, defaults initials to TM, and places that Caveat string", async () => {
		render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();

		expect(screen.queryByPlaceholderText("Type your signature")).toBeNull();
		expect(
			screen.queryByPlaceholderText("Leave blank to use first and last name"),
		).toBeNull();

		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);

		await waitFor(() => {
			expect(screen.getByText("Terry Minett")).toBeTruthy();
			expect(
				(screen.getByPlaceholderText("TM") as HTMLInputElement).value,
			).toBe("TM");
		});

		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));

		const saved = activeDoc.savedSignatureSets[0];
		expect(saved.signatureText).toBe("Terry Minett");
		expect(saved.initials).toBe("TM");
		expect(saved.firstName).toBe("Terry");
		expect(saved.lastName).toBe("Minett");
		expect(saved.signatureDataUrl).toBe("");
		expect(saved.initialDataUrl).toBe("");

		await fireEvent.click(screen.getByTitle("Typed signature"));
		expect(activeDoc.activeTool).toBe("signature");
		expect(activeDoc.activeStampText).toBe("Terry Minett");
		expect(activeDoc.activeStampDataUrl).toBeNull();

		const shape = createSignatureOrInitialShape("signature", 50, 40, {
			ghostW: 32,
			ghostH: 8,
			text: activeDoc.activeStampText,
		});
		expect(shape.text).toBe("Terry Minett");
		expect(shape.fontFamily).toBe("Caveat");
		expect(shape.dataUrl).toBeUndefined();
	});

	it("lets Written as override the preview without changing initials", async () => {
		render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);
		await fireEvent.click(screen.getByRole("button", { name: /written as/i }));
		await typeInto(
			screen.getByPlaceholderText(
				"Leave blank to use first and last name",
			) as HTMLInputElement,
			"T. Minett",
		);

		await waitFor(() => {
			expect(screen.getByText("T. Minett")).toBeTruthy();
			expect(
				(screen.getByPlaceholderText("TM") as HTMLInputElement).value,
			).toBe("TM");
		});

		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		const saved = activeDoc.savedSignatureSets[0];
		expect(saved.signatureText).toBe("T. Minett");
		expect(saved.firstName).toBe("Terry");
		expect(saved.lastName).toBe("Minett");
		expect(saved.initials).toBe("TM");
		expect(saved.label).toBe("Terry Minett:");
	});

	it("keeps an edited initials value", async () => {
		render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);
		await typeInto(screen.getByPlaceholderText("TM") as HTMLInputElement, "TJM");
		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		expect(activeDoc.savedSignatureSets[0].initials).toBe("TJM");
		expect(activeDoc.savedSignatureSets[0].signatureText).toBe("Terry Minett");
	});

	it("reopens a custom Written as line without changing the profile name", async () => {
		render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);
		await fireEvent.click(screen.getByRole("button", { name: /written as/i }));
		await typeInto(
			screen.getByPlaceholderText(
				"Leave blank to use first and last name",
			) as HTMLInputElement,
			"T. Minett",
		);
		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));

		await fireEvent.click(screen.getByTitle("Edit profile set"));
		const written = (await screen.findByPlaceholderText(
			"Leave blank to use first and last name",
		)) as HTMLInputElement;
		expect(written.value).toBe("T. Minett");
		expect((screen.getByPlaceholderText("First name") as HTMLInputElement).value).toBe(
			"Terry",
		);
		expect((screen.getByPlaceholderText("Last name") as HTMLInputElement).value).toBe(
			"Minett",
		);
		expect((screen.getByPlaceholderText("TM") as HTMLInputElement).value).toBe("TM");
		expect(screen.getByText("T. Minett")).toBeTruthy();
	});

	it("requires first and last name", async () => {
		render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		expect(screen.getByText("First and last name are required.")).toBeTruthy();
		expect(activeDoc.savedSignatureSets).toEqual([]);
	});
});
