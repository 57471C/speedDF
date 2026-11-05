import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isToolEnabled } from "../settings/appSettings.svelte";
import type { ToolId } from "../settings/appSettings";

export type ToolsMode =
	| "calculator"
	| "timer"
	| "stopwatch"
	| "magic8ball"
	| "scratchpad";

const WINDOW_CONFIG: Record<
	ToolsMode,
	{ label: string; title: string; width: number; height: number }
> = {
	calculator: {
		label: "tools-calculator",
		title: "Calculator",
		width: 280,
		height: 400,
	},
	timer: {
		label: "tools-timer",
		title: "Timer",
		width: 280,
		height: 260,
	},
	stopwatch: {
		label: "tools-stopwatch",
		title: "Stopwatch",
		width: 300,
		height: 400,
	},
	magic8ball: {
		label: "tools-magic8ball",
		title: "Magic 8 Ball",
		width: 300,
		height: 380,
	},
	scratchpad: {
		label: "tools-scratchpad",
		title: "Scratch Pad",
		width: 360,
		height: 480,
	},
};

/** Text the main window can toast. Prefer the real payload over a generic line. */
function toolsErrorText(payload: unknown): string {
	if (typeof payload === "string" && payload.trim()) return payload;
	if (payload instanceof Error && payload.message.trim()) return payload.message;
	if (payload && typeof payload === "object") {
		const message = (payload as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
		try {
			return JSON.stringify(payload);
		} catch {
			/* fall through */
		}
	}
	return payload == null ? "Failed to open tools window" : String(payload);
}

export type OpenToolsResult =
	| "opened"
	| "disabled"
	| { status: "error"; message: string };

const closeWatched = new Set<string>();
let closeReasonListenerStarted = false;

function describePayload(payload: unknown): string {
	if (payload == null || payload === "") return "(no payload)";
	if (typeof payload === "string") return payload;
	try {
		return JSON.stringify(payload);
	} catch {
		return String(payload);
	}
}

/** One main-window listener for the reason the tools page emits before close(). */
function ensureCloseReasonListener(): void {
	if (closeReasonListenerStarted) return;
	closeReasonListenerStarted = true;
	void listen(
		"tools-window-closing",
		(event) => {
			console.error(`[tools] close reason: ${describePayload(event.payload)}`);
		},
		{ target: "main" },
	).catch((err) => {
		closeReasonListenerStarted = false;
		console.error("[tools] Failed to listen for close reason:", err);
	});
}

/**
 * Log close-requested and destroyed in the main console.
 * Register before `new WebviewWindow`: a listener attached after creation
 * misses the close that kills the window on Windows, and without a listener
 * Tauri performs that close. A listener skips the default close. The first
 * second is ignored so creation cannot destroy the window. After that,
 * destroy() finishes a real close. Do not call setDecorations or setAlwaysOnTop.
 */
async function watchToolsWindowClose(label: string, mode: ToolsMode): Promise<void> {
	if (closeWatched.has(label)) return;
	closeWatched.add(label);
	ensureCloseReasonListener();

	const watchedAt = Date.now();
	const target = { kind: "WebviewWindow" as const, label };

	try {
		await listen("tauri://close-requested", (event) => {
			const ageMs = Date.now() - watchedAt;
			const detail = describePayload(event.payload);
			if (ageMs < 1000) {
				console.error(
					`[tools] ${label} (${mode}) ignored close-requested at ${ageMs}ms: ${detail}`,
				);
				return;
			}
			console.error(
				`[tools] ${label} (${mode}) close-requested at ${ageMs}ms: ${detail}`,
			);
			void WebviewWindow.getByLabel(label)
				.then((existing) => existing?.destroy())
				.catch((err) => {
					console.error(`[tools] ${label} destroy after close-requested failed:`, err);
				});
		}, { target });

		await listen("tauri://destroyed", (event) => {
			const ageMs = Date.now() - watchedAt;
			console.error(
				`[tools] ${label} (${mode}) destroyed at ${ageMs}ms: ${describePayload(event.payload)}`,
			);
		}, { target });
	} catch (err) {
		closeWatched.delete(label);
		console.error(`[tools] Failed to listen for ${label} close:`, err);
	}
}

/**
 * Opens (or focuses) a lightweight always-on-top tools WebviewWindow.
 * Created visible, focused, and frameless. Decorations are not changed after creation.
 * The opener shows and focuses on `tauri://created` only.
 * `tauri://error` is listened on this WebviewWindow (main window) and
 * returned so the caller can toast the payload.
 * Close events are logged in the main console.
 * Returns `"disabled"` when the user turned the tool off in Settings.
 */
export async function openToolsWindow(mode: ToolsMode): Promise<OpenToolsResult> {
	if (!isToolEnabled(mode as ToolId)) {
		return "disabled";
	}

	const cfg = WINDOW_CONFIG[mode];

	try {
		const existing = await WebviewWindow.getByLabel(cfg.label);
		if (existing) {
			await watchToolsWindowClose(cfg.label, mode);
			try {
				await existing.unminimize();
				await existing.show();
				await existing.setFocus();
				return "opened";
			} catch (err) {
				console.error(`[tools] Failed to show ${mode} window:`, err);
				return { status: "error", message: toolsErrorText(err) };
			}
		}
	} catch {
		// getByLabel can throw outside Tauri; fall through to create.
	}

	try {
		await watchToolsWindowClose(cfg.label, mode);
		// Held in a variable so the browser-args field is sent. It is not on the
		// published WindowOptions type, and a fresh object literal would be rejected.
		// The string must match app.windows additionalBrowserArgs in tauri.conf.json.
		// A second WebView2 in the same data folder fails with 0x8007139F when
		// these arguments differ, and Tao then drops the window.
		const windowOptions = {
			// SvelteKit route `/tools` prerenders to `tools.html`. Tauri maps
			// `/tools` → `tools.html` and keeps `?mode=`, so the tools page
			// reads calculator | timer | stopwatch | magic8ball | scratchpad.
			// `tools.html?mode=` would leave pathname `/tools.html`, which is
			// not a client route.
			url: `/tools?mode=${mode}`,
			title: cfg.title,
			width: cfg.width,
			height: cfg.height,
			minWidth: 220,
			minHeight: 240,
			resizable: true,
			alwaysOnTop: true,
			// Custom title bar in the tools page (drag region + close)
			decorations: false,
			// Soft edge on Windows when undecorated
			shadow: true,
			center: true,
			// Visible at creation. On Windows a hidden WebviewWindow often
			// never finishes, so the tools page never runs and no error
			// reaches the main window.
			focus: true,
			visible: true,
			skipTaskbar: false,
			zoomHotkeysEnabled: false,
			additionalBrowserArgs:
				"--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-pinch",
		};
		const win = new WebviewWindow(cfg.label, windowOptions);

		// Listeners were registered before create so an immediate close is logged
		// and, in the first second, ignored.
		// Register before the create IPC settles, then return the outcome.
		return await new Promise<OpenToolsResult>((resolve) => {
			void win.once("tauri://created", () => {
				void (async () => {
					try {
						// Show and focus only. Do not change decorations or topmost
						// after creation.
						await win.show();
						await win.setFocus();
					} catch (err) {
						console.error(`[tools] Failed to show ${mode} window:`, err);
						resolve({ status: "error", message: toolsErrorText(err) });
						return;
					}
					resolve("opened");
				})();
			});

			void win.once("tauri://error", (event) => {
				const payload = event?.payload ?? event;
				resolve({ status: "error", message: toolsErrorText(payload) });
			});
		});
	} catch (err) {
		console.error(`[tools] WebviewWindow unavailable for ${mode}:`, err);
		return { status: "error", message: toolsErrorText(err) };
	}
}
