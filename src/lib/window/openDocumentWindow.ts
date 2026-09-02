import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type OpenDocumentWindowResult = "opened" | "error" | "no-path";

/**
 * Open a full speedDF window focused on the given document path.
 * Leaves the original tab open (duplicate view from disk, not a move).
 * Requires a saved on-disk path — unsaved/untitled docs return `"no-path"`.
 */
export async function openDocumentInNewWindow(
	filePath: string | null | undefined,
	fileName?: string | null,
): Promise<OpenDocumentWindowResult> {
	const path = (filePath || "").trim();
	if (!path) return "no-path";

	// Labels: alphanumeric + hyphens only; unique so the same file can open twice.
	const label = `doc-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
	const baseName =
		(fileName || "").trim() || path.split(/[/\\]/).pop() || "Document";
	const openParam = encodeURIComponent(path);

	let width = 1000;
	let height = 720;
	try {
		const cur = getCurrentWindow();
		const size = await cur.outerSize();
		const scale = await cur.scaleFactor();
		// Logical pixels for WebviewWindow options
		width = Math.max(800, Math.round(size.width / scale));
		height = Math.max(600, Math.round(size.height / scale));
	} catch {
		// Outside Tauri or size unavailable — keep defaults
	}

	try {
		const win = new WebviewWindow(label, {
			url: `/?open=${openParam}`,
			title: `${baseName} — speedDF`,
			width,
			height,
			minWidth: 640,
			minHeight: 480,
			resizable: true,
			// Match main window chrome (custom TitleBar)
			decorations: false,
			shadow: true,
			center: true,
			focus: true,
			// +layout.svelte reveals once the UI is ready (same as main)
			visible: false,
			skipTaskbar: false,
			zoomHotkeysEnabled: false,
		});

		win.once("tauri://error", (event) => {
			console.error(
				`[doc-window] Failed to open window for ${baseName}:`,
				event.payload,
			);
		});

		return "opened";
	} catch (err) {
		console.error(`[doc-window] WebviewWindow unavailable for ${path}:`, err);
		return "error";
	}
}

/** True when this webview is a secondary document window (not main / tools). */
export function isSecondaryDocumentWindow(label: string): boolean {
	return label.startsWith("doc-");
}
