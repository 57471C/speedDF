import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";
import OcrPanel from "./OcrPanel.svelte";
import { activeDoc } from "../pdfStore.svelte.ts";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => {
    return {
        invoke: (...args: any[]) => mockInvoke(...args),
        Channel: class {
            onmessage = null;
        }
    };
});

vi.mock("pdfjs-dist", () => {
    return {
        getDocument: vi.fn(() => ({
            promise: Promise.resolve({
                getPage: vi.fn(() => Promise.resolve({
                    getViewport: vi.fn(() => ({ width: 100, height: 100, scale: 1 })),
                    render: vi.fn(() => ({
                        promise: Promise.resolve()
                    }))
                }))
            })
        })),
    };
});

describe("OcrPanel", () => {
    beforeEach(() => {
        activeDoc.flushDocumentState();
        vi.clearAllMocks();

        // Mock Canvas methods
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
            fillRect: vi.fn(),
            clearRect: vi.fn(),
            getImageData: vi.fn(() => ({
                data: new Uint8Array(4)
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
        })) as any;

        HTMLCanvasElement.prototype.toBlob = vi.fn(function(callback: BlobCallback, type?: string, quality?: any) {
            callback(new Blob(["mock data"], { type: type || "image/png" }));
        });

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
        activeDoc.fileType = 'pdf';

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
        activeDoc.fileType = 'tiff';
        activeDoc.tiffPages = []; // Will cause "Target TIFF page frame is missing or empty."

        await waitFor(() => {
            expect(screen.getByText(/Pipeline Halted:/i)).toBeTruthy();
            expect(screen.getByText(/Target TIFF page frame is missing or empty/i)).toBeTruthy();
        });
    });
});
