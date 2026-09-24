import { afterEach, describe, expect, it } from "vitest";
import {
	applyScrollRatio,
	clampRestoredScrollTop,
	collapseLineAnchors,
	createMarkdownScrollSync,
	maxScroll,
	previewOffsetForLine,
	readLineAnchors,
	restoreScrollTop,
	scrollRatio,
	scrollTopForSourceLine,
	sourceLineAtOffset,
	sourceLineAtScrollTop,
	sourceLineForContentY,
	shouldSkipPreviewToEditor,
	SCROLL_SYNC_TYPING_GUARD_MS,
	type LineAnchor,
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

describe("line map", () => {
	const anchors: LineAnchor[] = [
		{ line: 1, top: 0 },
		{ line: 2, top: 20 },
		{ line: 3, top: 500 },
		{ line: 4, top: 520 },
	];

	it("interpolates inside a tall block instead of using pane height", () => {
		expect(previewOffsetForLine(anchors, 3)).toBe(500);
		expect(previewOffsetForLine(anchors, 4)).toBe(520);
		expect(previewOffsetForLine(anchors, 2.5)).toBe(260);
		expect(sourceLineForContentY(anchors, 500)).toBe(3);
		expect(sourceLineForContentY(anchors, 260)).toBe(2.5);
		// A scroll-height ratio of the same Y would not land on these lines.
		expect(sourceLineForContentY(anchors, 260)).not.toBeCloseTo(260 / 520);
	});

	it("stays on the last line past the final anchor", () => {
		expect(sourceLineForContentY(anchors, 9000)).toBe(4);
		expect(previewOffsetForLine(anchors, 40)).toBe(520);
	});

	it("collapses duplicate lines to the topmost block", () => {
		expect(
			collapseLineAnchors([
				{ line: 3, top: 140 },
				{ line: 3, top: 100 },
				{ line: 1, top: 0 },
			]),
		).toEqual([
			{ line: 1, top: 0 },
			{ line: 3, top: 100 },
		]);
	});

	it("maps editor scroll and caret offsets onto source lines", () => {
		expect(sourceLineAtScrollTop(0, 20)).toBe(1);
		expect(sourceLineAtScrollTop(20, 20)).toBe(2);
		expect(sourceLineAtScrollTop(30, 20)).toBe(2.5);
		expect(sourceLineAtOffset("a\nb\nc", 0)).toBe(1);
		expect(sourceLineAtOffset("a\nb\nc", 2)).toBe(2);
		expect(sourceLineAtOffset("a\nb\nc", 4)).toBe(3);
		expect(scrollTopForSourceLine(3, 20, 800)).toBe(40);
	});

	it("reads data-md-line tops in scroller content coordinates", () => {
		const scroller = document.createElement("div");
		const block = document.createElement("h1");
		block.setAttribute("data-md-line", "4");
		const later = document.createElement("p");
		later.setAttribute("data-md-line", "4");
		scroller.append(block, later);
		scroller.getBoundingClientRect = () =>
			({ top: 100 }) as DOMRect;
		block.getBoundingClientRect = () => ({ top: 180 }) as DOMRect;
		later.getBoundingClientRect = () => ({ top: 240 }) as DOMRect;
		scroller.scrollTop = 40;
		expect(readLineAnchors(scroller)).toEqual([{ line: 4, top: 120 }]);
	});
});

describe("createMarkdownScrollSync", () => {
	const clocks = makeRaf();
	afterEach(() => {
		// drain leftover frames
		clocks.flush(8);
	});

	const tallAnchors: LineAnchor[] = [
		{ line: 1, top: 0 },
		{ line: 5, top: 400 },
		{ line: 6, top: 2000 },
		{ line: 11, top: 2200 },
		{ line: 21, top: 2600 },
	];

	function lineSync(
		editor: ReturnType<typeof pane>,
		preview: ReturnType<typeof pane>,
		anchors: LineAnchor[] = tallAnchors,
		extra?: {
			now?: () => number;
			caretLine?: () => number | null;
		},
	) {
		return createMarkdownScrollSync({
			getEditor: () => editor,
			getPreview: () => preview,
			getPreviewAnchors: () => anchors,
			getEditorLineHeight: () => 20,
			getViewportLine: () => sourceLineAtScrollTop(editor.scrollTop, 20),
			getCaretLine: extra?.caretLine ?? (() => null),
			now: extra?.now,
			raf: clocks.raf,
			caf: clocks.caf,
		});
	}

	it("syncs editor → preview by source line, not scroll ratio", () => {
		const editor = pane(1000, 200, 80);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview);
		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBe(400);
		expect(scrollRatio(editor) * maxScroll(preview)).not.toBe(400);
		sync.dispose();
	});

	it("syncs preview → editor by the line at the preview viewport top", () => {
		const editor = pane(1000, 200, 0);
		const preview = pane(5000, 200, 2000);
		const sync = lineSync(editor, preview);
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(100);
		sync.dispose();
	});

	it("does nothing when the preview has no line anchors", () => {
		const editor = pane(1000, 200, 80);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview, []);
		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBe(0);
		sync.dispose();
	});

	it("ignores the destination echo so it cannot loop", () => {
		const editor = pane(1000, 200, 80);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview);
		sync.onEditorScroll();
		clocks.flush(1);
		expect(preview.scrollTop).toBe(400);
		expect(sync.isApplying).toBe(true);

		editor.scrollTop = 80;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(80);
		expect(preview.scrollTop).toBe(400);

		clocks.flush(2);
		expect(sync.isApplying).toBe(false);
		sync.dispose();
	});

	it("does not yank the editor while typing; editor → preview follows the caret line", () => {
		let now = 10_000;
		const editor = pane(1000, 200, 200);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview, tallAnchors, {
			now: () => now,
			caretLine: () => 21,
		});

		sync.noteTyping();
		preview.scrollTop = 1800;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(200);

		sync.onEditorScroll();
		clocks.flush(1);
		// Caret is on line 21, not the viewport line (11 → top 2200).
		expect(preview.scrollTop).toBe(2600);
		clocks.flush(2);

		now += SCROLL_SYNC_TYPING_GUARD_MS + 1;
		preview.scrollTop = 2600;
		sync.onPreviewScroll();
		clocks.flush(1);
		expect(editor.scrollTop).toBe(400);
		sync.dispose();
	});

	it("coalesces rapid scroll events to one apply", () => {
		const editor = pane(1000, 200, 0);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview);
		editor.scrollTop = 20;
		sync.onEditorScroll();
		editor.scrollTop = 80;
		sync.onEditorScroll();
		expect(preview.scrollTop).toBe(0);
		clocks.flush(1);
		expect(preview.scrollTop).toBe(400);
		sync.dispose();
	});

	it("realigns once from the line map after a held image load, not by ratio", () => {
		const editor = pane(1000, 200, 80);
		const preview = pane(5000, 200, 0);
		const sync = lineSync(editor, preview);
		sync.hold();
		sync.realign();
		clocks.flush(2);
		expect(preview.scrollTop).toBe(0);
		sync.release();
		clocks.flush(3);
		expect(preview.scrollTop).toBe(400);
		expect(scrollRatio(editor) * maxScroll(preview)).not.toBe(preview.scrollTop);
		sync.dispose();
	});

	it("hold blocks both directions until release", () => {
		const editor = pane(1000, 200, 80);
		const preview = pane(5000, 200, 400);
		const sync = lineSync(editor, preview);
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
