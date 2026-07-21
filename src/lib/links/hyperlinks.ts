/**
 * PDF hyperlink (URI Link annotation) extraction and safe-URL helpers.
 * v1: external http(s)/mailto only — no javascript:, file:, data:, or internal dests.
 *
 * PDF.js is loaded only inside {@link extractHyperlinks} so pure helpers stay
 * testable in Node without the browser canvas stack.
 */

/** Clickable link region in page-relative CSS % (top-left origin). */
export interface HyperlinkDef {
	/** Stable id within a document load (page + index). */
	id: string;
	/** 1-based original page number. */
	pageNum: number;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Sanitized absolute URL (http, https, or mailto). */
	url: string;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * True when `raw` is a safe external URL for open-in-browser.
 * Rejects javascript:, data:, file:, vbscript:, relative paths, etc.
 */
export function isSafeHyperlinkUrl(raw: string | null | undefined): boolean {
	if (raw == null) return false;
	const trimmed = String(raw).trim();
	if (!trimmed) return false;
	// Hard reject common dangerous schemes before URL parse
	if (/^(javascript|vbscript|data|file|blob|about):/i.test(trimmed)) {
		return false;
	}
	// mailto: — require at least a non-empty address-ish path; no nested schemes
	if (/^mailto:/i.test(trimmed)) {
		const rest = trimmed.slice(7);
		if (!rest || rest.includes("javascript:") || rest.includes("\0")) {
			return false;
		}
		// Disallow whitespace / angle brackets in the core address
		const addr = rest.split("?")[0] || "";
		if (!addr || /[\s<>"]/.test(addr)) return false;
		return true;
	}
	try {
		const u = new URL(trimmed);
		return ALLOWED_PROTOCOLS.has(u.protocol.toLowerCase());
	} catch {
		return false;
	}
}

/** Returns a trimmed safe URL, or null if rejected. */
export function normalizeHyperlinkUrl(
	raw: string | null | undefined,
): string | null {
	if (!isSafeHyperlinkUrl(raw)) return null;
	return String(raw).trim();
}

export function linksForPage(
	links: HyperlinkDef[] | undefined | null,
	pageNum: number,
): HyperlinkDef[] {
	return (links || []).filter((l) => l.pageNum === pageNum);
}

type PdfJsPageProxy = {
	getViewport: (params: { scale: number; rotation?: number }) => {
		width: number;
		height: number;
		convertToViewportPoint: (x: number, y: number) => number[];
	};
	getAnnotations: (params?: { intent?: string }) => Promise<any[]>;
	rotate?: number;
};

type PdfJsDocumentProxy = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<PdfJsPageProxy>;
	destroy?: () => Promise<void>;
};

/**
 * Extract Link annotations with URI actions from an already-loaded PDF.js document.
 */
export async function extractHyperlinksFromDocument(
	pdf: PdfJsDocumentProxy,
): Promise<HyperlinkDef[]> {
	const links: HyperlinkDef[] = [];
	const pageCount = pdf.numPages || 0;

	for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
		let page: PdfJsPageProxy;
		try {
			page = await pdf.getPage(pageNum);
		} catch {
			continue;
		}

		const rotation = typeof page.rotate === "number" ? page.rotate : 0;
		const viewport = page.getViewport({ scale: 1, rotation: rotation });
		const pageW = viewport.width || 1;
		const pageH = viewport.height || 1;

		let annotations: any[] = [];
		try {
			annotations = await page.getAnnotations({ intent: "display" });
		} catch {
			continue;
		}

		let linkIndex = 0;
		for (const ann of annotations || []) {
			if (!ann || ann.subtype !== "Link") continue;

			// pdf.js sets `url` for safe-ish URIs; `unsafeUrl` is the raw string
			const candidate =
				(typeof ann.url === "string" && ann.url) ||
				(typeof ann.unsafeUrl === "string" && ann.unsafeUrl) ||
				null;
			const url = normalizeHyperlinkUrl(candidate);
			if (!url) continue;

			const rect = ann.rect as number[] | undefined;
			if (!rect || rect.length < 4) continue;

			const [x1, y1, x2, y2] = rect;
			const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
			const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);

			const left = Math.min(vx1, vx2);
			const top = Math.min(vy1, vy2);
			const width = Math.abs(vx2 - vx1);
			const height = Math.abs(vy2 - vy1);
			if (width < 0.5 && height < 0.5) continue;

			const xPct = (left / pageW) * 100;
			const yPct = (top / pageH) * 100;
			const wPct = (width / pageW) * 100;
			const hPct = (height / pageH) * 100;

			links.push({
				id: `p${pageNum}-l${linkIndex++}`,
				pageNum,
				x: clampPct(xPct),
				y: clampPct(yPct),
				width: Math.max(0.15, clampPct(wPct)),
				height: Math.max(0.15, clampPct(hPct)),
				url,
			});
		}
	}

	return links;
}

/**
 * Load PDF bytes with PDF.js and extract hyperlinks.
 * Caller must ensure GlobalWorkerOptions.workerSrc is set (app bootstrap).
 * Dynamic import keeps pure URL helpers free of the PDF.js Node/canvas stack.
 */
export async function extractHyperlinks(
	pdfBytes: Uint8Array,
): Promise<HyperlinkDef[]> {
	try {
		const pdfjsLib = await import("pdfjs-dist");
		const loadingTask = pdfjsLib.getDocument({
			data: pdfBytes.slice(0),
			// Match other call sites; workers/fonts already configured app-wide
			cMapUrl:
				typeof window !== "undefined"
					? window.location.origin + "/cmaps/"
					: undefined,
			cMapPacked: true,
			standardFontDataUrl:
				typeof window !== "undefined"
					? window.location.origin + "/standard_fonts/"
					: undefined,
			wasmUrl:
				typeof window !== "undefined"
					? window.location.origin + "/"
					: undefined,
		});
		const pdf = (await loadingTask.promise) as unknown as PdfJsDocumentProxy;
		try {
			return await extractHyperlinksFromDocument(pdf);
		} finally {
			try {
				await pdf.destroy?.();
			} catch {
				/* ignore */
			}
		}
	} catch (err) {
		console.warn("Hyperlink extraction skipped:", err);
		return [];
	}
}

function clampPct(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, v));
}
