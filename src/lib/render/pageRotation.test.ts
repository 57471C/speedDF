import { describe, expect, it } from "vitest";
import {
	combinedPageRotation,
	computeFlattenedTextPosition,
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

describe("computeFlattenedTextPosition", () => {
	const portraitW = 612;
	const portraitH = 792;
	const fontSize = 12;
	const ascent = 10;
	const textWidth = 50;

	it("positions text correctly on unrotated portrait page (0°)", () => {
		const pos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 0,
			fontSize,
			ascent,
			textWidth,
		});
		// u = 61.2, v = 158.4
		// text_u = 61.2 + 3 = 64.2
		// text_v_baseline = 158.4 + 3 + 1.2 + 10 = 172.6
		expect(pos.x).toBeCloseTo(64.2);
		expect(pos.y).toBeCloseTo(792 - 172.6);
		expect(pos.rotateDegrees).toBe(0);
	});

	it("positions and rotates text correctly on 90° rotated portrait page", () => {
		const pos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 90,
			fontSize,
			ascent,
			textWidth,
		});
		// visibleWidth = 792, visibleHeight = 612
		// u = 79.2, v = 122.4
		// text_u = 79.2 + 3 = 82.2
		// text_v_baseline = 122.4 + 3 + 1.2 + 10 = 136.6
		expect(pos.x).toBeCloseTo(136.6);
		expect(pos.y).toBeCloseTo(82.2);
		expect(pos.rotateDegrees).toBe(90);
	});

	it("positions and rotates text correctly on 180° rotated portrait page", () => {
		const pos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 180,
			fontSize,
			ascent,
			textWidth,
		});
		// visibleWidth = 612, visibleHeight = 792
		// text_u = 64.2, text_v_baseline = 172.6
		expect(pos.x).toBeCloseTo(612 - 64.2);
		expect(pos.y).toBeCloseTo(172.6);
		expect(pos.rotateDegrees).toBe(180);
	});

	it("positions and rotates text correctly on 270° rotated portrait page", () => {
		const pos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 270,
			fontSize,
			ascent,
			textWidth,
		});
		// visibleWidth = 792, visibleHeight = 612
		// text_u = 82.2, text_v_baseline = 136.6
		expect(pos.x).toBeCloseTo(612 - 136.6);
		expect(pos.y).toBeCloseTo(792 - 82.2);
		expect(pos.rotateDegrees).toBe(270);
	});

	it("handles landscape pages correctly (90° and 270°)", () => {
		const landscapeW = 792;
		const landscapeH = 612;

		const pos90 = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: landscapeW,
			pageHeight: landscapeH,
			rotationAngle: 90,
			fontSize,
			ascent,
			textWidth,
		});
		// visibleWidth = 612, visibleHeight = 792
		// u = 61.2, v = 158.4
		// text_u = 64.2, text_v_baseline = 172.6
		expect(pos90.x).toBeCloseTo(172.6);
		expect(pos90.y).toBeCloseTo(64.2);
		expect(pos90.rotateDegrees).toBe(90);

		const pos270 = computeFlattenedTextPosition({
			shape: { x: 10, y: 20 },
			pageWidth: landscapeW,
			pageHeight: landscapeH,
			rotationAngle: 270,
			fontSize,
			ascent,
			textWidth,
		});
		expect(pos270.x).toBeCloseTo(792 - 172.6);
		expect(pos270.y).toBeCloseTo(612 - 64.2);
		expect(pos270.rotateDegrees).toBe(270);
	});

	it("handles center and right alignment with specified box width", () => {
		const centerPos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20, width: 30, alignment: "center" },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 0,
			fontSize,
			ascent,
			textWidth: 50,
		});
		// visibleWidth = 612
		// u = 61.2, boxW = 183.6
		// text_u = 61.2 + (183.6 - 50) / 2 = 128.0
		expect(centerPos.x).toBeCloseTo(128.0);

		const rightPos = computeFlattenedTextPosition({
			shape: { x: 10, y: 20, width: 30, alignment: "right" },
			pageWidth: portraitW,
			pageHeight: portraitH,
			rotationAngle: 0,
			fontSize,
			ascent,
			textWidth: 50,
		});
		// text_u = 61.2 + 183.6 - 3 - 50 = 191.8
		expect(rightPos.x).toBeCloseTo(191.8);
	});
});
