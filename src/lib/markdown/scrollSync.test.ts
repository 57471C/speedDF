import { afterEach, describe, expect, it } from "vitest";
import {
	applyScrollRatio,
	clampRestoredScrollTop,
	createMarkdownScrollSync,
	maxScroll,
	restoreScrollTop,
	scrollRatio,
	shouldSkipPreviewToEditor,
	SCROLL_SYNC_TYPING_GUARD_MS,
} from "./scrollSync";

function pane(
	scrollHeight: number,
	clientHeight: number,
	scrollTop = 0,
): { scrollTop: number; scrollHeight: number; clientHeight: number } {
	return { scrollTop, scrollHeight, clientHeight };
}

/** Queue-style rAF so tests can flush one frame at a time. */
function makeRaf() {
	const queue: FrameRequestCallback[] = [];
	let nextId = 1;
	const ids = new Map<number, FrameRequestCallback>();
	return {
		raf(cb: FrameRequestCallback) {
			const id = nextId++;
			ids.set(id, cb);
			queue.push(cb);
			return id;
		},
		caf(id: number) {
			const cb = ids.get(id);
			ids.delete(id);
			const i = cb ? queue.indexOf(cb) : -1;
			if (i >= 0) queue.splice(i, 1);
		},
		flush(n = 1) {
			for (let i = 0; i < n; i++) {
				const cb = queue.shift();
				if (!cb) return;
				cb(0);
			}
		},
		pending() {
			return queue.length;
		},
	};
}

describe("scrollRatio / applyScrollRatio", () => {
	it("is 0 at top and when content does not overflow", () => {
		expect(scrollRatio(pane(200, 400, 0))).toBe(0);
		expect(scrollRatio(pane(800, 200, 0))).toBe(0);
		expect(maxScroll(pane(200, 400))).toBe(0);
	});

	it("is 1 at the bottom and 0.5 in the middle", () => {
		expect(scrollRatio(pane(1000, 200, 800))).toBe(1);
		expect(scrollRatio(pane(1000, 200, 400))).toBe(0.5);
	});

	it("clamps out-of-range scrollTop", () => {
		expect(scrollRatio(pane(1000, 200, -20))).toBe(0);
		expect(scrollRatio(pane(1000, 200, 9999))).toBe(1);
	});

	it("maps a ratio onto a differently sized pane", () => {
		const preview = pane(2200, 200, 0);
		expect(applyScrollRatio(preview, 0.5)).toBe(true);
		expect(preview.scrollTop).toBe(1000);
		expect(applyScrollRatio(preview, 0.5)).toBe(false);
		expect(applyScrollRatio(preview, 1)).toBe(true);
		expect(preview.scrollTop).toBe(2000);
	});
});

describe("restoreScrollTop after a content patch", () => {
	it("puts the scroller back where it was", () => {
		const preview = pane(4000, 200, 0);
		expect(restoreScrollTop(preview, 1400)).toBe(1400);
		expect(preview.scrollTop).toBe(1400);
	});

	it("clamps when the document got shorter", () => {
		const preview = pane(500, 200, 0);
		expect(clampRestoredScrollTop(preview, 1400)).toBe(300);
		expect(restoreScrollTop(preview, 1400)).toBe(300);
	});
});

describe("shouldSkipPreviewToEditor", () => {
	it("skips while inside the typing guard window", () => {
		expect(shouldSkipPreviewToEditor(1000, 1000 + 50)).toBe(true);
		expect(
			shouldSkipPreviewToEditor(1000, 1000 + SCROLL_SYNC_TYPING_GUARD_MS),
		).toBe(false);
	});
});

describe("createMarkdownScrollSync", () => {
	const clocks = makeRaf();
	afterEach(() => {
		// drain leftover frames
		clocks.flush(8);
	});

	it("syncs editor → preview by relative position", () => {
		const editor = pane(1000, 200, 400);
		const preview = pane(2200, 200, 0);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			raf: clocks.raf,
			caf: clocks.caf,
		});
		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBe(1000);
		sync.dispose();
	});

	it("syncs preview → editor by relative position", () => {
		const editor = pane(1000, 200, 0);
		const preview = pane(2200, 200, 1000);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			raf: clocks.raf,
			caf: clocks.caf,
		});
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(400);
		sync.dispose();
	});

	it("ignores the destination echo so it cannot loop", () => {
		const editor = pane(1000, 200, 400);
		const preview = pane(2200, 200, 0);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			raf: clocks.raf,
			caf: clocks.caf,
		});
		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBe(1000);
		expect(sync.isApplying).toBe(true);

		// Echo from programmatic preview scroll — must not rewrite the editor.
		editor.scrollTop = 400;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(400);
		expect(preview.scrollTop).toBe(1000);

		clocks.flush(2);
		expect(sync.isApplying).toBe(false);
		sync.dispose();
	});

	it("does not yank the editor while typing; editor → preview still runs", () => {
		let now = 10_000;
		const editor = pane(1000, 200, 200);
		const preview = pane(2200, 200, 0);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			now: () => now,
			raf: clocks.raf,
			caf: clocks.caf,
		});

		sync.noteTyping();
		preview.scrollTop = 1800;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(200);

		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBeCloseTo(scrollRatio(editor) * 2000);
		clocks.flush(2);

		now += SCROLL_SYNC_TYPING_GUARD_MS + 1;
		preview.scrollTop = 1800;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(720);
		sync.dispose();
	});

	it("coalesces rapid scroll events to one apply", () => {
		const editor = pane(1000, 200, 0);
		const preview = pane(2200, 200, 0);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			raf: clocks.raf,
			caf: clocks.caf,
		});
		editor.scrollTop = 100;
		sync.onEditorScroll();
		editor.scrollTop = 400;
		sync.onEditorScroll();
		expect(preview.scrollTop).toBe(0);
		clocks.flush(1);
		expect(preview.scrollTop).toBe(1000);
		sync.dispose();
	});

	it("hold blocks both directions until release", () => {
		const editor = pane(1000, 200, 400);
		const preview = pane(2200, 200, 1000);
		const sync = createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			raf: clocks.raf,
			caf: clocks.caf,
		});
		sync.hold();
		expect(sync.isApplying).toBe(true);
		// Transient jump-to-top from an HTML patch must not drive the editor.
		preview.scrollTop = 0;
		sync.onPreviewScroll();
		editor.scrollTop = 0;
		sync.onEditorScroll();
		clocks.flush(2);
		expect(editor.scrollTop).toBe(0);
		expect(preview.scrollTop).toBe(0);
		// Restore, then release — sync stays quiet through the restore echo.
		restoreScrollTop(preview, 1000);
		restoreScrollTop(editor, 400);
		sync.release();
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(400);
		expect(preview.scrollTop).toBe(1000);
		clocks.flush(2);
		expect(sync.isApplying).toBe(false);
		sync.dispose();
	});
});
