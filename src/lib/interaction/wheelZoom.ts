/**
 * Window-level capturing wheel guard.
 *
 * Prevents native WebView / browser page-level zoom and leftover child pane
 * scrolling when Ctrl or Cmd (Meta) is pressed during wheel gestures.
 * Workspace owns document zoomScale.
 */

/** Idle time after the last Ctrl/Cmd-wheel before the scroller may pan again. */
export const CTRL_WHEEL_GESTURE_MS = 200;

/** Class toggled on the workspace scroller for the Ctrl/Cmd-wheel gesture. */
export const WORKSPACE_ZOOMING_CLASS = "workspace-zooming";

export type CtrlWheelOverflowLock = {
	/** Call on every Ctrl/Cmd wheel. Locks overflow until restoreMs after last call. */
	hold: () => void;
	/** Restore overflow immediately and cancel the pending timer. */
	dispose: () => void;
};

/**
 * Freeze native overflow scroll on a scroller during Ctrl/Cmd+wheel.
 *
 * Sets overflow:hidden / overflow-anchor:none / touch-action:none via
 * {@link WORKSPACE_ZOOMING_CLASS} so the pane cannot creep while zoomScale
 * changes. Restores after `restoreMs` of inactivity.
 */
export function createCtrlWheelOverflowLock(
	node: HTMLElement,
	restoreMs: number = CTRL_WHEEL_GESTURE_MS,
): CtrlWheelOverflowLock {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let held = false;
	let prevOverflow = "";
	let prevOverflowAnchor = "";
	let prevTouchAction = "";

	const release = () => {
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
		if (!held) return;
		node.style.overflow = prevOverflow;
		node.style.overflowAnchor = prevOverflowAnchor;
		node.style.touchAction = prevTouchAction;
		node.classList.remove(WORKSPACE_ZOOMING_CLASS);
		held = false;
	};

	const hold = () => {
		if (!held) {
			prevOverflow = node.style.overflow;
			prevOverflowAnchor = node.style.overflowAnchor;
			prevTouchAction = node.style.touchAction;
			node.style.overflow = "hidden";
			node.style.overflowAnchor = "none";
			node.style.touchAction = "none";
			node.classList.add(WORKSPACE_ZOOMING_CLASS);
			held = true;
		}
		if (timer != null) clearTimeout(timer);
		timer = setTimeout(release, restoreMs);
	};

	return { hold, dispose: release };
}

export function attachWindowWheelZoomGuard(
	target: EventTarget | null = typeof window !== "undefined" ? window : null,
): () => void {
	if (!target || typeof target.addEventListener !== "function") {
		return () => {};
	}

	const handleWheelCapture = (e: Event) => {
		const we = e as WheelEvent;
		if (we.ctrlKey || we.metaKey) {
			we.preventDefault();
		}
	};

	// Safari / WKWebView pinch-magnify (separate from wheel).
	const handleGestureCapture = (e: Event) => {
		e.preventDefault();
	};

	const wheelOpts: AddEventListenerOptions = {
		passive: false,
		capture: true,
	};
	target.addEventListener("wheel", handleWheelCapture, wheelOpts);
	target.addEventListener("gesturestart", handleGestureCapture, wheelOpts);
	target.addEventListener("gesturechange", handleGestureCapture, wheelOpts);
	target.addEventListener("gestureend", handleGestureCapture, wheelOpts);

	return () => {
		const removeOpts = { capture: true } as EventListenerOptions;
		target.removeEventListener("wheel", handleWheelCapture, removeOpts);
		target.removeEventListener("gesturestart", handleGestureCapture, removeOpts);
		target.removeEventListener(
			"gesturechange",
			handleGestureCapture,
			removeOpts,
		);
		target.removeEventListener("gestureend", handleGestureCapture, removeOpts);
	};
}

/**
 * Pin WebView / browser page zoom at 1 so only app zoomScale changes.
 * `setZoom` is injectable for tests; defaults to Tauri's current webview.
 */
export async function lockWebviewPageZoom(
	setZoom?: (factor: number) => Promise<void>,
): Promise<void> {
	try {
		if (setZoom) {
			await setZoom(1);
			return;
		}
		const { getCurrentWebview } = await import("@tauri-apps/api/webview");
		await getCurrentWebview().setZoom(1);
	} catch {
		// Browser preview or missing ACL — wheel preventDefault still applies.
	}
}
