/**
 * Window-level capturing wheel guard.
 *
 * Prevents native WebView / browser page-level zoom and leftover child pane
 * scrolling when Ctrl or Cmd (Meta) is pressed during wheel gestures.
 * Workspace owns document zoomScale.
 */
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

	target.addEventListener("wheel", handleWheelCapture, {
		passive: false,
		capture: true,
	});

	return () => {
		target.removeEventListener("wheel", handleWheelCapture, {
			capture: true,
		} as EventListenerOptions);
	};
}
