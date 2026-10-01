import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { syncLiveThumbnail } from "./flatten";
import { activeDoc } from "../../pdfStore.svelte";
import { updateRecentThumbnail } from "../../pdfStore.svelte";

vi.mock("../../pdfStore.svelte", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../pdfStore.svelte")>();
	return {
		...actual,
		updateRecentThumbnail: vi.fn(),
		applyLiveThumbnail: vi.fn(),
	};
});

vi.mock("../render/pdfRenderQueue", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../render/pdfRenderQueue")>();
	return {
		...actual,
		runWithPdfRenderSlot: vi.fn(async (priority, callback) => {
			return await callback();
		}),
	};
});

vi.mock("pdfjs-dist", () => ({
	getDocument: vi.fn().mockReturnValue({
		promise: Promise.resolve({
			getPage: vi.fn().mockResolvedValue({
				getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
				render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
			}),
		}),
	}),
}));

describe("syncLiveThumbnail", () => {
	let querySelectorSpy: any;
	let createElementSpy: any;

	beforeEach(() => {
		activeDoc.flushDocumentState();
		localStorage.clear();

		querySelectorSpy = vi.spyOn(document, "querySelector");
		createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
			if (tag === "canvas") {
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn().mockReturnValue({
						fillStyle: "",
						fillRect: vi.fn(),
						drawImage: vi.fn(),
					}),
					toDataURL: vi.fn().mockReturnValue("data:image/jpeg;base64,mocked"),
				};
				// We must ensure the mock canvas passes `instanceof HTMLCanvasElement` if it's tested.
				// However, `createElement("canvas")` is mostly used for the background offscreen ones.
				Object.setPrototypeOf(mockCanvas, HTMLCanvasElement.prototype);
				return mockCanvas as any;
			}
			return HTMLDocument.prototype.createElement.call(document, tag);
		});

		// Mock URL.createObjectURL since it's used in image thumbnail gen
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn().mockReturnValue("blob:mock"),
			revokeObjectURL: vi.fn(),
		});

		// Mock Image to invoke onload immediately
		vi.stubGlobal(
			"Image",
			class {
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				naturalWidth = 100;
				naturalHeight = 100;
				srcValue = "";
				set src(value: string) {
					this.srcValue = value;
					queueMicrotask(() => this.onload?.());
				}
				get src() {
					return this.srcValue;
				}
			},
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns early if targetPath is falsy", () => {
		const result = syncLiveThumbnail("", new Uint8Array([1, 2, 3]));
		expect(result).toBeUndefined();
	});

	it("invokes generateTrueAnnotationThumbnail for PDF when compiledBytes are provided", async () => {
		activeDoc.fileType = "pdf";
		const bytes = new Uint8Array([1, 2, 3]);

		syncLiveThumbnail("target/path.pdf", bytes);

		await new Promise(resolve => setTimeout(resolve, 0));

		const pdfjsLib = await import("pdfjs-dist");
		expect(pdfjsLib.getDocument).toHaveBeenCalled();
	});

	it("invokes generateImageAnnotationThumbnail for image when compiledBytes are provided", async () => {
		activeDoc.fileType = "image";
		const bytes = new Uint8Array([1, 2, 3]);

		syncLiveThumbnail("target/path.png", bytes);

		await new Promise(resolve => setTimeout(resolve, 0));

		expect(createElementSpy).toHaveBeenCalledWith("canvas");
	});

	it("falls back to live workspace canvas if no compiledBytes are provided", () => {
		activeDoc.fileType = "pdf";

		// Use real DOM element for querySelector mock
		const realCanvas = document.createElement("canvas");
		const toDataURLSpy = vi.fn().mockReturnValue("data:image/jpeg;base64,canvasMock");
		realCanvas.toDataURL = toDataURLSpy;

		querySelectorSpy.mockImplementation((selector: string) => {
			if (selector === 'canvas[data-page-index="0"]') return realCanvas;
			return null;
		});

		// Set a mock cache value
		const b64Path = btoa("target/path.pdf");
		localStorage.setItem(`speeddf_meta_${b64Path}`, JSON.stringify({}));

		syncLiveThumbnail("target/path.pdf");

		expect(querySelectorSpy).toHaveBeenCalledWith('canvas[data-page-index="0"]');
		expect(toDataURLSpy).toHaveBeenCalledWith("image/jpeg", 0.4);
		expect(updateRecentThumbnail).toHaveBeenCalledWith("target/path.pdf", "data:image/jpeg;base64,canvasMock");

		const updatedCache = JSON.parse(localStorage.getItem(`speeddf_meta_${b64Path}`)!);
		expect(updatedCache.thumbnail).toBe("data:image/jpeg;base64,canvasMock");
	});

	it("falls back to document.querySelector('canvas') if page index 0 canvas is missing", () => {
		const realCanvas = document.createElement("canvas");
		const toDataURLSpy = vi.fn().mockReturnValue("data:image/jpeg;base64,canvasMock2");
		realCanvas.toDataURL = toDataURLSpy;

		querySelectorSpy.mockImplementation((selector: string) => {
			if (selector === 'canvas[data-page-index="0"]') return null;
			if (selector === 'canvas') return realCanvas;
			return null;
		});

		syncLiveThumbnail("target/path.pdf");

		expect(querySelectorSpy).toHaveBeenCalledWith("canvas");
		expect(toDataURLSpy).toHaveBeenCalledWith("image/jpeg", 0.4);
		expect(updateRecentThumbnail).toHaveBeenCalledWith("target/path.pdf", "data:image/jpeg;base64,canvasMock2");
	});
});
