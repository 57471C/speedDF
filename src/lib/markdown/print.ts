/**
 * Headless print for markdown documents (iframe spool, same pattern as image print).
 * Keeps app chrome out of the print tree.
 */
import { parseMarkdownToHtml } from "./parse";
import { sanitizeHtml } from "./sanitize";

const PRINT_STYLES = `
  @page { size: A4; margin: 18mm; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #111;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
  }
  .markdown-print-root {
    max-width: 100%;
    word-wrap: break-word;
  }
  .markdown-print-root h1 { font-size: 1.75em; margin: 0.8em 0 0.4em; font-weight: 700; }
  .markdown-print-root h2 { font-size: 1.4em; margin: 0.75em 0 0.35em; font-weight: 700; }
  .markdown-print-root h3 { font-size: 1.2em; margin: 0.7em 0 0.3em; font-weight: 600; }
  .markdown-print-root h4, .markdown-print-root h5, .markdown-print-root h6 {
    font-size: 1.05em; margin: 0.6em 0 0.25em; font-weight: 600;
  }
  .markdown-print-root p { margin: 0.55em 0; }
  .markdown-print-root ul, .markdown-print-root ol { margin: 0.5em 0; padding-left: 1.4em; }
  .markdown-print-root li { margin: 0.2em 0; }
  .markdown-print-root blockquote {
    margin: 0.75em 0;
    padding: 0.25em 0 0.25em 0.9em;
    border-left: 3px solid #94a3b8;
    color: #334155;
  }
  .markdown-print-root pre {
    margin: 0.75em 0;
    padding: 0.75em 1em;
    background: #f1f5f9;
    border-radius: 4px;
    overflow-x: auto;
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.9em;
    line-height: 1.45;
    page-break-inside: avoid;
  }
  .markdown-print-root code {
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.9em;
    background: #f1f5f9;
    padding: 0.1em 0.35em;
    border-radius: 3px;
  }
  .markdown-print-root pre code { background: transparent; padding: 0; }
  .markdown-print-root table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    page-break-inside: avoid;
  }
  .markdown-print-root th, .markdown-print-root td {
    border: 1px solid #cbd5e1;
    padding: 0.35em 0.6em;
    text-align: left;
  }
  .markdown-print-root th { background: #f8fafc; font-weight: 600; }
  .markdown-print-root img { max-width: 100%; height: auto; page-break-inside: avoid; }
  .markdown-print-root a { color: #0369a1; text-decoration: underline; }
  .markdown-print-root hr { border: none; border-top: 1px solid #cbd5e1; margin: 1.25em 0; }
`;

/**
 * Open a hidden iframe with sanitized markdown HTML and invoke the system print dialog.
 */
export function printMarkdownSource(source: string): void {
	const safeHtml = sanitizeHtml(parseMarkdownToHtml(source ?? ""));

	let printWindow = document.getElementById(
		"print-iframe-markdown",
	) as HTMLIFrameElement | null;
	if (!printWindow) {
		printWindow = document.createElement("iframe");
		printWindow.id = "print-iframe-markdown";
		printWindow.style.position = "fixed";
		printWindow.style.right = "0";
		printWindow.style.bottom = "0";
		printWindow.style.width = "0";
		printWindow.style.height = "0";
		printWindow.style.border = "0";
		printWindow.setAttribute("aria-hidden", "true");
		document.body.appendChild(printWindow);
	}

	const doc = printWindow.contentDocument || printWindow.contentWindow?.document;
	if (!doc) return;

	doc.open();
	doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_STYLES}</style></head><body><div class="markdown-print-root">${safeHtml}</div></body></html>`);
	doc.close();

	const win = printWindow.contentWindow;
	if (!win) return;

	// Give the iframe a tick to layout before spooling
	const runPrint = () => {
		try {
			win.focus();
			win.print();
		} catch (err) {
			console.warn("Markdown print spool failed:", err);
		}
	};

	if (doc.readyState === "complete") {
		setTimeout(runPrint, 50);
	} else {
		printWindow.onload = () => setTimeout(runPrint, 50);
	}
}
