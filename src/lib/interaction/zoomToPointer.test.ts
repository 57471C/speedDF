import { describe, expect, it } from "vitest";
import { scrollAfterZoomToPointer } from "./zoomToPointer";

describe("scrollAfterZoomToPointer", () => {
	it("keeps the content point under the cursor when content grows from origin", () => {
		// Cursor at view (100, 80); content filled the left side; local (100, 80)
		// After 2× zoom content grows; without scroll adjust point would shift
		const result = scrollAfterZoomToPointer(
			{
				viewX: 100,
				viewY: 80,
				localX: 100,
				localY: 80,
				oldContentW: 400,
				oldContentH: 600,
			},
			{
				// After zoom, content still starts at viewport 0,0 (no mx-auto)
				contentLeftInView: 0,
				contentTopInView: 0,
				newContentW: 800,
				newContentH: 1200,
				scrollLeft: 0,
				scrollTop: 0,
				maxScrollLeft: 400,
				maxScrollTop: 600,
			},
		);
		// visual = 0 + 100*2 = 200; need scroll so 200 - scroll = 100 → scroll 100
		expect(result.scrollLeft).toBe(100);
		expect(result.scrollTop).toBe(80);
	});

	it("accounts for centering shift (mx-auto collapse on zoom-in)", () => {
		// Before: content centered — local under cursor was mid content
		// After zoom: content left-aligned at 0 (wider than viewport)
		const result = scrollAfterZoomToPointer(
			{
				viewX: 200,
				viewY: 100,
				localX: 150,
				localY: 100,
				oldContentW: 300,
				oldContentH: 400,
			},
			{
				// Post-zoom content starts at left edge of scrollport
				contentLeftInView: 0,
				contentTopInView: 0,
				newContentW: 600,
				newContentH: 800,
				scrollLeft: 0,
				scrollTop: 0,
				maxScrollLeft: 300,
				maxScrollTop: 400,
			},
		);
		// visualX = 0 + 150*2 = 300; scroll = 300 - 200 = 100
		expect(result.scrollLeft).toBe(100);
		expect(result.scrollTop).toBe(100);
	});

	it("clamps to max scroll", () => {
		const result = scrollAfterZoomToPointer(
			{
				viewX: 10,
				viewY: 10,
				localX: 500,
				localY: 500,
				oldContentW: 400,
				oldContentH: 400,
			},
			{
				contentLeftInView: 0,
				contentTopInView: 0,
				newContentW: 1200,
				newContentH: 1200,
				scrollLeft: 0,
				scrollTop: 0,
				maxScrollLeft: 50,
				maxScrollTop: 50,
			},
		);
		expect(result.scrollLeft).toBe(50);
		expect(result.scrollTop).toBe(50);
	});
});
