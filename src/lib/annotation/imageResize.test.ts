import { describe, expect, it } from "vitest";
import {
	clampPx,
	computeLinkedResize,
	mimeFromFileName,
} from "./imageResize";

describe("computeLinkedResize", () => {
	const native = { nativeWidth: 200, nativeHeight: 100 };
	const current = { width: 200, height: 100, scale: 100 };

	it("locks aspect when changing width", () => {
		const next = computeLinkedResize("width", 100, true, native, current);
		expect(next.width).toBe(100);
		expect(next.height).toBe(50);
		expect(next.scale).toBe(50);
	});

	it("locks aspect when changing height", () => {
		const next = computeLinkedResize("height", 50, true, native, current);
		expect(next.width).toBe(100);
		expect(next.height).toBe(50);
		expect(next.scale).toBe(50);
	});

	it("scale drives both dimensions when locked", () => {
		const next = computeLinkedResize("scale", 25, true, native, current);
		expect(next.width).toBe(50);
		expect(next.height).toBe(25);
		expect(next.scale).toBe(25);
	});

	it("clamps scale edits to 1–99", () => {
		const hi = computeLinkedResize("scale", 150, true, native, current);
		expect(hi.scale).toBe(99);
		expect(hi.width).toBe(198);
		const lo = computeLinkedResize("scale", 0, true, native, current);
		expect(lo.scale).toBe(1);
	});

	it("allows independent height when unlocked", () => {
		const next = computeLinkedResize("width", 100, false, native, current);
		expect(next.width).toBe(100);
		expect(next.height).toBe(100);
		expect(next.scale).toBe(50);
	});

	it("does not clamp display scale when enlarging via width", () => {
		const next = computeLinkedResize("width", 400, true, native, current);
		expect(next.width).toBe(400);
		expect(next.height).toBe(200);
		expect(next.scale).toBe(200);
	});
});

describe("clampPx / mime", () => {
	it("clamps pixel values", () => {
		expect(clampPx(0)).toBe(1);
		expect(clampPx(50.4)).toBe(50);
		expect(clampPx(999999)).toBe(20000);
	});

	it("picks mime from filename", () => {
		expect(mimeFromFileName("a.PNG")).toBe("image/png");
		expect(mimeFromFileName("a.jpg")).toBe("image/jpeg");
		expect(mimeFromFileName("a.webp")).toBe("image/webp");
		expect(mimeFromFileName(null)).toBe("image/jpeg");
	});
});
