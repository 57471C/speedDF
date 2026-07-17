import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeDoc, initializeNewDocument } from "../pdfStore.svelte.ts";
import OcrPanel from "./OcrPanel.svelte";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => {
	return {
		invoke: (...args: unknown[]) => mockInvoke(...args),
		Channel: class {
			onmessage = null;
		},
	};
});

vi.mock("pdfjs-dist", () => {
	return {
		getDocument: vi.fn(() => ({
			promise: Promise.resolve({
				getPage: vi.fn(() =>
					Promise.resolve({
						getViewport: vi.fn(() => ({ width: 100, height: 100, scale: 1 })),
						render: vi.fn(() => ({
							promise: Promise.resolve(),
						})),
					}),
				),
			}),
		})),
	};
});

describe("OcrPanel", () => {
	beforeEach(() => {
		activeDoc.flushDocumentState();
		// Multi-doc facade: document-bound setters no-op without a current workspace
		initializeNewDocument("ocr-test.pdf", null);
		vi.clearAllMocks();

		// Mock Canvas methods
		const mockCtx = {
			fillRect: vi.fn(),
			clearRect: vi.fn(),
			getImageData: vi.fn(() => ({
				data: new Uint8Array(4),
			})),
			putImageData: vi.fn(),
			createImageData: vi.fn(),
			setTransform: vi.fn(),
			drawImage: vi.fn(),
			save: vi.fn(),
			fillText: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			closePath: vi.fn(),
			stroke: vi.fn(),
			translate: vi.fn(),
			scale: vi.fn(),
			rotate: vi.fn(),
			arc: vi.fn(),
			fill: vi.fn(),
			measureText: vi.fn(() => ({ width: 0 })),
			transform: vi.fn(),
			rect: vi.fn(),
			clip: vi.fn(),
		};
		HTMLCanvasElement.prototype.getContext = vi.fn(
			() => mockCtx,
		) as unknown as typeof HTMLCanvasElement.prototype.getContext;

		HTMLCanvasElement.prototype.toBlob = vi.fn(
			(callback: BlobCallback, type?: string, _quality?: number) => {
				callback(new Blob(["mock data"], { type: type || "image/png" }));
			},
		);

		global.URL.createObjectURL = vi.fn(() => "mock-url");
		global.URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should mount properly", () => {
		const { container } = render(OcrPanel);
		expect(container).toBeTruthy();
	});

	it("should handle error in inner try-catch (PDF processing OCR failure)", async () => {
		// Mock OCR rejection
		mockInvoke.mockRejectedValue(new Error("Local OCR model failed to load"));

		render(OcrPanel);

		// Setup document state to trigger the effect watcher
		activeDoc.rawBytes = new Uint8Array([1, 2, 3]);
		activeDoc.currentPage = 1;
		activeDoc.fileType = "pdf";

		await waitFor(() => {
			// Verify that the error log is rendered
			expect(screen.getByText(/Pipeline Halted:/i)).toBeTruthy();
			expect(screen.getByText(/Local OCR model failed to load/i)).toBeTruthy();
		});
	});

	it("should handle error in outer try-catch (TIFF processing setup failure)", async () => {
		render(OcrPanel);

		// Setup state but leave tiffPages empty, which will throw in the TIFF processing branch
		activeDoc.rawBytes = new Uint8Array([1, 2, 3]);
		activeDoc.currentPage = 1;
		activeDoc.fileType = "tiff";
		activeDoc.tiffPages = []; // Will cause "Target TIFF page frame is missing or empty."

		await waitFor(() => {
			expect(screen.getByText(/Pipeline Halted:/i)).toBeTruthy();
			expect(
				screen.getByText(/Target TIFF page frame is missing or empty/i),
			).toBeTruthy();
		});
	});
});
