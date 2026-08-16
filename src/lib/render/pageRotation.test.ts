import { describe, expect, it } from "vitest";
import {
	combinedPageRotation,
	isQuarterTurn,
	nextPageRotateDegrees,
	normalizePageRotate,
} from "./pageRotation";

describe("normalizePageRotate", () => {
	it("wraps and snaps to 90° steps", () => {
		expect(normalizePageRotate(0)).toBe(0);
		expect(normalizePageRotate(90)).toBe(90);
		expect(normalizePageRotate(180)).toBe(180);
		expect(normalizePageRotate(270)).toBe(270);
		expect(normalizePageRotate(360)).toBe(0);
		expect(normalizePageRotate(-90)).toBe(270);
		expect(normalizePageRotate(450)).toBe(90);
	});

	it("treats non-finite as 0", () => {
		expect(normalizePageRotate(Number.NaN)).toBe(0);
		expect(normalizePageRotate(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("combinedPageRotation", () => {
	it("adds page /Rotate and session rotation", () => {
		expect(combinedPageRotation(0, 90)).toBe(90);
		expect(combinedPageRotation(90, 0)).toBe(90);
		expect(combinedPageRotation(90, 90)).toBe(180);
		expect(combinedPageRotation(270, 90)).toBe(0);
	});
});

describe("isQuarterTurn", () => {
	it("is true only for 90 and 270", () => {
		expect(isQuarterTurn(90)).toBe(true);
		expect(isQuarterTurn(270)).toBe(true);
		expect(isQuarterTurn(0)).toBe(false);
		expect(isQuarterTurn(180)).toBe(false);
	});
});

describe("nextPageRotateDegrees", () => {
	it("returns null when session rotation is 0 (do not rewrite /Rotate)", () => {
		expect(nextPageRotateDegrees(90, 0)).toBeNull();
		expect(nextPageRotateDegrees(0, 0)).toBeNull();
	});

	it("adds session offset onto existing /Rotate", () => {
		expect(nextPageRotateDegrees(0, 90)).toBe(90);
		expect(nextPageRotateDegrees(90, 90)).toBe(180);
		expect(nextPageRotateDegrees(270, 90)).toBe(0);
		expect(nextPageRotateDegrees(180, 180)).toBe(0);
	});
});
