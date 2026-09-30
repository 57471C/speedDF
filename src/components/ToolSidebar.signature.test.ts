import { createRequire } from "node:module";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignatureOrInitialShape } from "../lib/annotation/toolShapes";
import { activeDoc } from "../pdfStore.svelte.ts";
import ToolSidebar from "./ToolSidebar.svelte";

const nodeRequire = createRequire(import.meta.url);
const nodeCanvas = nodeRequire("canvas") as {
	loadImage: (src: Buffer) => Promise<CanvasImageSource & { width: number; height: number }>;
	createCanvas: (width: number, height: number) => {
		getContext: (kind: "2d") => {
			clearRect: (x: number, y: number, w: number, h: number) => void;
			fillStyle: string;
			fillRect: (x: number, y: number, w: number, h: number) => void;
			drawImage: (image: CanvasImageSource, x: number, y: number) => void;
			getImageData: (
				x: number,
				y: number,
				w: number,
				h: number,
			) => { data: Uint8ClampedArray };
		};
		toBuffer: (mime: "image/png") => Buffer;
	};
};

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

function transparentSignatureFile(): File {
	const canvas = nodeCanvas.createCanvas(4, 2);
	const ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, 4, 2);
	ctx.fillStyle = "rgba(220, 0, 0, 1)";
	ctx.fillRect(0, 0, 1, 1);
	return new File([canvas.toBuffer("image/png")], "mark.png", { type: "image/png" });
}

async function waitForPadInk(label: string) {
	const pad = screen.getByLabelText(label) as HTMLCanvasElement;
	await waitFor(() => {
		const data = pad.getContext("2d")?.getImageData(0, 0, pad.width, pad.height).data;
		expect(!!data && Array.from(data).some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
	});
}

async function pngAlphaAt(dataUrl: string, pixelIndex: number): Promise<number> {
	const img = await nodeCanvas.loadImage(
		Buffer.from(dataUrl.split(",")[1] || "", "base64"),
	);
	const canvas = nodeCanvas.createCanvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return ctx.getImageData(0, 0, img.width, img.height).data[pixelIndex * 4 + 3];
}

describe("signature pad upload", () => {
	beforeEach(() => {
		localStorage.removeItem("speeddf_signature_sets");
		activeDoc.savedSignatureSets = [];
		activeDoc.activeStampText = null;
		activeDoc.activeStampDataUrl = null;
		activeDoc.activeTool = "select";
		vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
			const img = await nodeCanvas.loadImage(Buffer.from(await blob.arrayBuffer()));
			return Object.assign(img, { close() {} });
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		localStorage.removeItem("speeddf_signature_sets");
		activeDoc.savedSignatureSets = [];
		activeDoc.activeStampText = null;
		activeDoc.activeStampDataUrl = null;
		activeDoc.activeTool = "select";
	});

	it("uploads a transparent PNG, keeps the Caveat name, and places the image", async () => {
		const view = render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);
		expect(screen.getAllByRole("button", { name: /^upload$/i })).toHaveLength(2);

		const input = view.container.querySelector(
			'input[aria-label="Upload master signature"]',
		) as HTMLInputElement;
		const file = transparentSignatureFile();
		Object.defineProperty(input, "files", { configurable: true, value: [file] });
		await fireEvent.change(input);
		await waitForPadInk("Master signature pad");

		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		const saved = activeDoc.savedSignatureSets[0];
		expect(saved.signatureText).toBe("Terry Minett");
		expect(saved.signatureDataUrl.startsWith("data:image/png")).toBe(true);
		expect(await pngAlphaAt(saved.signatureDataUrl, 1)).toBe(0);
		expect(screen.getByText("Terry Minett")).toBeTruthy();

		await fireEvent.click(screen.getByTitle("Image signature"));
		expect(activeDoc.activeStampDataUrl).toBe(saved.signatureDataUrl);
		expect(activeDoc.activeStampText).toBeNull();
		expect(activeDoc.activeTool).toBe("signature");
	});

	it("drops a file onto the initials pad and stores a PNG", async () => {
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
		const pad = screen.getByLabelText("Initials pad");
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", {
			value: { files: [transparentSignatureFile()] },
		});
		pad.dispatchEvent(event);
		await waitForPadInk("Initials pad");

		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		const saved = activeDoc.savedSignatureSets[0];
		expect(saved.initialDataUrl.startsWith("data:image/png")).toBe(true);
		expect(saved.signatureDataUrl).toBe("");
		expect(await pngAlphaAt(saved.initialDataUrl, 1)).toBe(0);
	});

	it("clears an upload and rejects a PDF", async () => {
		const view = render(ToolSidebar, { zoomScale: 100 });
		await openSignoff();
		await typeInto(
			screen.getByPlaceholderText("First name") as HTMLInputElement,
			"Terry",
		);
		await typeInto(
			screen.getByPlaceholderText("Last name") as HTMLInputElement,
			"Minett",
		);
		const input = view.container.querySelector(
			'input[aria-label="Upload master signature"]',
		) as HTMLInputElement;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: [transparentSignatureFile()],
		});
		await fireEvent.change(input);
		await waitForPadInk("Master signature pad");
		await fireEvent.click(screen.getAllByRole("button", { name: /^clear$/i })[0]);

		Object.defineProperty(input, "files", {
			configurable: true,
			value: [new File([new Uint8Array([1, 2, 3])], "scan.pdf", { type: "application/pdf" })],
		});
		await fireEvent.change(input);
		expect(
			await screen.findByText("Use a PNG, GIF, JPEG, or WebP image."),
		).toBeTruthy();

		await fireEvent.click(screen.getByRole("button", { name: /save profile combo/i }));
		expect(activeDoc.savedSignatureSets[0].signatureDataUrl).toBe("");
		expect(activeDoc.savedSignatureSets[0].signatureText).toBe("Terry Minett");
	});
});
