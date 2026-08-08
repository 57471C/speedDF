/**
 * Markdown Recent / sidebar thumbnails — simple html2canvas path.
 *
 * Capture the live markdown content root after paint → JPEG data URL →
 * callers use applyLiveThumbnail (pageThumbnailOverrides + recents).
 *
 * Fixed solid paper background so light/dark theme does not flip the thumb.
 * No offscreen clone, no modern-screenshot, no multi-strategy stack.
 */
import html2canvas from "html2canvas";

/** Max long edge of the stored JPEG. */
export const MARKDOWN_THUMB_MAX_EDGE_PX = 400;
export const MARKDOWN_THUMB_MAX_WIDTH_PX = MARKDOWN_THUMB_MAX_EDGE_PX;
/** Top-of-doc height band (content px) before downscale. */
export const MARKDOWN_THUMB_MAX_CAPTURE_HEIGHT_PX = 400;
/**
 * Fixed dark paper palette for thumbs — independent of user light/dark theme.
 * Light text on dark paper so light-mode UI never yields black-on-black thumbs.
 */
export const MARKDOWN_THUMB_PAPER_BG = "#121a2b";
export const MARKDOWN_THUMB_TEXT = "#e2e8f0";
export const MARKDOWN_THUMB_TEXT_MUTED = "#94a3b8";
export const MARKDOWN_THUMB_HEADING = "#f1f5f9";
export const MARKDOWN_THUMB_ACCENT = "#22d3ee";
export const MARKDOWN_THUMB_CODE_BG = "#0b1220";
export const MARKDOWN_THUMB_BORDER = "#1e293b";
export const MARKDOWN_THUMB_JPEG_QUALITY = 0.78;
/**
 * Same sans stack as live MarkdownView — avoid Times serif when clone
 * stylesheets are stripped and html2canvas falls back to default.
 * (Live view: system-ui / Segoe UI / … in MarkdownView.svelte)
 */
export const MARKDOWN_THUMB_FONT_SANS =
	'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Mono stack for code/pre — match live MarkdownView. */
export const MARKDOWN_THUMB_FONT_MONO =
	'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace';

/** Injected into the html2canvas clone so theme never controls thumb colours. */
export function markdownThumbCaptureCss(paperBg = MARKDOWN_THUMB_PAPER_BG): string {
	return `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: ${paperBg} !important;
      color: ${MARKDOWN_THUMB_TEXT} !important;
      font-family: ${MARKDOWN_THUMB_FONT_SANS} !important;
    }
    [data-markdown-content],
    .markdown-view,
    .markdown-view * {
      color: ${MARKDOWN_THUMB_TEXT} !important;
      border-color: ${MARKDOWN_THUMB_BORDER} !important;
      font-family: ${MARKDOWN_THUMB_FONT_SANS} !important;
    }
    [data-markdown-content],
    .markdown-view {
      background-color: ${paperBg} !important;
      background-image: none !important;
      box-shadow: none !important;
      font-family: ${MARKDOWN_THUMB_FONT_SANS} !important;
    }
    .markdown-view h1,
    .markdown-view h2,
    .markdown-view h3,
    .markdown-view h4,
    .markdown-view h5,
    .markdown-view h6 {
      color: ${MARKDOWN_THUMB_HEADING} !important;
      border-color: ${MARKDOWN_THUMB_BORDER} !important;
      font-family: ${MARKDOWN_THUMB_FONT_SANS} !important;
    }
    .markdown-view a {
      color: ${MARKDOWN_THUMB_ACCENT} !important;
    }
    .markdown-view blockquote {
      color: ${MARKDOWN_THUMB_TEXT_MUTED} !important;
      border-left-color: ${MARKDOWN_THUMB_ACCENT} !important;
      background: transparent !important;
    }
    .markdown-view code,
    .markdown-view pre,
    .markdown-view code *,
    .markdown-view pre * {
      color: ${MARKDOWN_THUMB_TEXT} !important;
      background-color: ${MARKDOWN_THUMB_CODE_BG} !important;
      border-color: ${MARKDOWN_THUMB_BORDER} !important;
      font-family: ${MARKDOWN_THUMB_FONT_MONO} !important;
    }
    .markdown-view pre code {
      background: transparent !important;
    }
    .markdown-view th,
    .markdown-view td {
      color: ${MARKDOWN_THUMB_TEXT} !important;
      border-color: ${MARKDOWN_THUMB_BORDER} !important;
    }
    .markdown-view th {
      background-color: ${MARKDOWN_THUMB_CODE_BG} !important;
    }
    .markdown-view hr {
      border-color: ${MARKDOWN_THUMB_BORDER} !important;
      background: ${MARKDOWN_THUMB_BORDER} !important;
    }
    .markdown-view__empty {
      color: ${MARKDOWN_THUMB_TEXT_MUTED} !important;
    }
  `;
}

/**
 * Apply fixed dark-paper + light-text + sans font on a capture clone root.
 * Theme must not control thumb colours (avoids black text on dark paper).
 * Font must not fall back to Times when clone stylesheets are stripped.
 */
export function applyMarkdownThumbCapturePalette(
	clonedEl: HTMLElement,
	paperBg = MARKDOWN_THUMB_PAPER_BG,
): void {
	clonedEl.style.backgroundColor = paperBg;
	clonedEl.style.backgroundImage = "none";
	clonedEl.style.color = MARKDOWN_THUMB_TEXT;
	clonedEl.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;
	// Inline on every descendant so stripped stylesheets / light theme computed
	// colours cannot leave black text on dark paper, and font is never Times.
	clonedEl.querySelectorAll("*").forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const tag = node.tagName;
		if (tag === "A") {
			node.style.color = MARKDOWN_THUMB_ACCENT;
			node.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;
		} else if (tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6") {
			node.style.color = MARKDOWN_THUMB_HEADING;
			node.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;
		} else if (tag === "BLOCKQUOTE") {
			node.style.color = MARKDOWN_THUMB_TEXT_MUTED;
			node.style.borderLeftColor = MARKDOWN_THUMB_ACCENT;
			node.style.background = "transparent";
			node.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;
		} else if (tag === "CODE" || tag === "PRE") {
			node.style.color = MARKDOWN_THUMB_TEXT;
			node.style.fontFamily = MARKDOWN_THUMB_FONT_MONO;
			if (tag === "PRE" || node.parentElement?.tagName !== "PRE") {
				node.style.backgroundColor = MARKDOWN_THUMB_CODE_BG;
			}
		} else {
			node.style.color = MARKDOWN_THUMB_TEXT;
			node.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;
		}
	});
}

/** Wait for document fonts so html2canvas does not paint with Times. */
export async function waitForDocumentFonts(timeoutMs = 400): Promise<void> {
	try {
		if (typeof document !== "undefined" && document.fonts?.ready) {
			await Promise.race([
				document.fonts.ready,
				new Promise<void>((r) => setTimeout(r, timeoutMs)),
			]);
		}
	} catch {
		/* ignore — capture still proceeds with system-ui stack */
	}
}

/**
 * Downscale canvas so max(width, height) ≤ maxEdge and export JPEG.
 * Always paints fixed paper under the image so transparent areas stay solid.
 */
export function canvasToThumbDataUrl(
	source: HTMLCanvasElement,
	maxEdgePx = MARKDOWN_THUMB_MAX_EDGE_PX,
	jpegQuality = MARKDOWN_THUMB_JPEG_QUALITY,
): string {
	const sw = Math.max(1, source.width);
	const sh = Math.max(1, source.height);
	const scale = Math.min(1, maxEdgePx / Math.max(sw, sh));
	const tw = Math.max(1, Math.round(sw * scale));
	const th = Math.max(1, Math.round(sh * scale));

	const out = document.createElement("canvas");
	out.width = tw;
	out.height = th;
	const ctx = out.getContext("2d");
	if (!ctx) return "";
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.fillStyle = MARKDOWN_THUMB_PAPER_BG;
	ctx.fillRect(0, 0, tw, th);
	ctx.drawImage(source, 0, 0, tw, th);
	try {
		return out.toDataURL("image/jpeg", jpegQuality);
	} catch {
		return "";
	}
}

/**
 * Capture top of live `[data-markdown-content]` / markdown-view with html2canvas.
 * Returns "" on failure — never blocks open.
 */
export async function captureMarkdownViewThumbnail(
	el: HTMLElement,
): Promise<string> {
	if (typeof document === "undefined" || !el) return "";

	const root =
		(el.closest?.("[data-markdown-content]") as HTMLElement | null) || el;

	const fullW = Math.max(
		1,
		Math.round(
			root.scrollWidth || root.clientWidth || root.offsetWidth || 1,
		),
	);
	const fullH = Math.max(
		1,
		Math.round(
			root.scrollHeight || root.clientHeight || root.offsetHeight || 1,
		),
	);
	// Top band only — not full-document minimap
	const captureH = Math.max(
		1,
		Math.min(fullH, MARKDOWN_THUMB_MAX_CAPTURE_HEIGHT_PX),
	);

	const paper = MARKDOWN_THUMB_PAPER_BG;

	try {
		// Ensure web/system fonts are ready so capture is not Times serif fallback
		await waitForDocumentFonts();

		const canvas = await html2canvas(root, {
			backgroundColor: paper,
			scale: 1,
			width: fullW,
			height: captureH,
			windowWidth: fullW,
			windowHeight: captureH,
			x: 0,
			y: 0,
			scrollX: 0,
			scrollY: 0,
			useCORS: true,
			allowTaint: true,
			logging: false,
			foreignObjectRendering: false,
			onclone: (clonedDoc, clonedEl) => {
				// Drop stylesheets that use color-mix / modern color() (parser crash)
				// and that would re-apply light-theme black text onto dark paper.
				clonedDoc
					.querySelectorAll("style, link[rel='stylesheet']")
					.forEach((n) => n.remove());

				clonedEl.style.zoom = "1";
				clonedEl.style.transform = "none";
				clonedEl.style.width = `${fullW}px`;
				clonedEl.style.maxWidth = `${fullW}px`;
				clonedEl.style.margin = "0";
				clonedEl.style.boxShadow = "none";
				clonedEl.style.overflow = "hidden";
				clonedEl.style.maxHeight = `${captureH}px`;
				// Sans stack on root (matches live MarkdownView)
				clonedEl.style.fontFamily = MARKDOWN_THUMB_FONT_SANS;

				// Fixed dark paper + light text + sans — theme never controls thumbs
				applyMarkdownThumbCapturePalette(clonedEl, paper);

				const safe = clonedDoc.createElement("style");
				safe.textContent = markdownThumbCaptureCss(paper);
				(clonedDoc.head || clonedDoc.documentElement).appendChild(safe);
			},
		});

		// Crop taller results to the top band
		let source: HTMLCanvasElement = canvas;
		if (canvas.height > captureH + 2 && canvas.width > 0) {
			const crop = document.createElement("canvas");
			crop.width = canvas.width;
			crop.height = Math.min(canvas.height, captureH);
			const ctx = crop.getContext("2d");
			if (ctx) {
				ctx.fillStyle = paper;
				ctx.fillRect(0, 0, crop.width, crop.height);
				ctx.drawImage(
					canvas,
					0,
					0,
					canvas.width,
					crop.height,
					0,
					0,
					crop.width,
					crop.height,
				);
				source = crop;
			}
		}

		return canvasToThumbDataUrl(
			source,
			MARKDOWN_THUMB_MAX_EDGE_PX,
			MARKDOWN_THUMB_JPEG_QUALITY,
		);
	} catch (err) {
		console.warn("Markdown view thumbnail capture failed:", err);
		return "";
	}
}

export function findMarkdownContentRoot(): HTMLElement | null {
	if (typeof document === "undefined") return null;
	return document.querySelector(
		"[data-markdown-content]",
	) as HTMLElement | null;
}
