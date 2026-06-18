// Import the core library straight through the main distribution bundle
import * as pdfjsLib from "pdfjs-dist";

// Explicitly anchor the worker thread using an absolute local asset path string
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

export interface SharedDocumentState {
	rawBytes: Uint8Array | null;
	pageCount: number;
	currentPage: number;
}

// Global reactive application synchronization state
export const activeDoc = $state<SharedDocumentState>({
	rawBytes: null,
	pageCount: 0,
	currentPage: 1,
});
