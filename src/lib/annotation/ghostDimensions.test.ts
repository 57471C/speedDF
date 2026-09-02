import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getGhostDimensions } from "./ghostDimensions";

describe("getGhostDimensions", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("returns { w: 0, h: 0 } for null or undefined tool", () => {
		expect(getGhostDimensions(null)).toEqual({ w: 0, h: 0 });
		expect(getGhostDimensions(undefined)).toEqual({ w: 0, h: 0 });
	});

	it("returns { w: 0, h: 0 } for an unknown tool", () => {
		expect(getGhostDimensions("unknown_tool")).toEqual({ w: 0, h: 0 });
	});

	it("returns default dimensions when no cached value exists", () => {
		expect(getGhostDimensions("signature")).toEqual({ w: 18, h: 8 });
		expect(getGhostDimensions("initial")).toEqual({ w: 6, h: 6 });
		expect(getGhostDimensions("tick")).toEqual({ w: 4, h: 4 });
		expect(getGhostDimensions("dash")).toEqual({ w: 6, h: 2 });
	});

	it("returns cached dimensions when they are present in localStorage", () => {
		localStorage.setItem("speeddf_stamp_signature_w", "30");
		localStorage.setItem("speeddf_stamp_signature_h", "15");
		expect(getGhostDimensions("signature")).toEqual({ w: 30, h: 15 });
	});

	it("returns default dimensions if only width is cached", () => {
		localStorage.setItem("speeddf_stamp_initial_w", "20");
		expect(getGhostDimensions("initial")).toEqual({ w: 6, h: 6 });
	});

	it("returns default dimensions if only height is cached", () => {
		localStorage.setItem("speeddf_stamp_tick_h", "10");
		expect(getGhostDimensions("tick")).toEqual({ w: 4, h: 4 });
	});
});
