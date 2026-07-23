import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type ToolsMode = "calculator" | "timer" | "stopwatch";

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
};

async function hardenToolsWindow(win: WebviewWindow): Promise<void> {
	// Ensure frameless even if a prior session / window-state restored chrome
	await win.setDecorations(false).catch(() => undefined);
	await win.setAlwaysOnTop(true).catch(() => undefined);
}

/**
 * Opens (or focuses) a lightweight always-on-top tools WebviewWindow.
 * Created hidden; the tools page reveals itself once UI is ready (avoids flash).
 */
export async function openToolsWindow(mode: ToolsMode): Promise<void> {
	const cfg = WINDOW_CONFIG[mode];

	try {
		const existing = await WebviewWindow.getByLabel(cfg.label);
		if (existing) {
			await hardenToolsWindow(existing);
			await existing.unminimize().catch(() => undefined);
			await existing.show().catch(() => undefined);
			await existing.setFocus().catch(() => undefined);
			return;
		}
	} catch {
		// getByLabel can throw outside Tauri; fall through to create.
	}

	try {
		const win = new WebviewWindow(cfg.label, {
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
			// Stay hidden until the tools page paints (prevents blank/chrome flash)
			focus: false,
			visible: false,
			skipTaskbar: false,
		});

		win.once("tauri://created", () => {
			void hardenToolsWindow(win);
		});

		win.once("tauri://error", (event) => {
			console.error(`[tools] Failed to open ${mode} window:`, event.payload);
		});
	} catch (err) {
		console.error(`[tools] WebviewWindow unavailable for ${mode}:`, err);
	}
}
