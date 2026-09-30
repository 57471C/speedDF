import { describe, expect, it } from "vitest";
import {
	buildSignatureSet,
	imageDataHasInk,
	initialsFromTypedName,
	isCaveatTextStamp,
	splitTypedName,
} from "./signatureText";

describe("initialsFromTypedName", () => {
	it("uses the first letter of each word", () => {
		expect(initialsFromTypedName("Terry Minett")).toBe("TM");
		expect(initialsFromTypedName("  mary ann smith  ")).toBe("MAS");
		expect(initialsFromTypedName("a b c d e")).toBe("ABCD");
		expect(initialsFromTypedName("")).toBe("");
		expect(initialsFromTypedName("Terry")).toBe("T");
	});
});

describe("splitTypedName", () => {
	it("splits a typed signature into first and last", () => {
		expect(splitTypedName("Terry Minett")).toEqual({
			firstName: "Terry",
			lastName: "Minett",
		});
		expect(splitTypedName("Terry Ann Minett")).toEqual({
			firstName: "Terry",
			lastName: "Ann Minett",
		});
		expect(splitTypedName("Terry")).toEqual({
			firstName: "Terry",
			lastName: "",
		});
	});
});

describe("buildSignatureSet", () => {
	const scan = {
		id: "1",
		signatureDataUrl: "data:image/png;base64,scan",
		initialDataUrl: "data:image/png;base64,init",
		firstName: "Terry",
		lastName: "Minett",
		initials: "TM",
	};

	it("keeps a saved scan when only text is added", () => {
		const next = buildSignatureSet({
			id: "1",
			existing: scan,
			signatureText: "Terry Minett",
			initials: "TM",
			firstName: "Terry",
			lastName: "Minett",
		});
		expect(next.signatureDataUrl).toBe(scan.signatureDataUrl);
		expect(next.initialDataUrl).toBe(scan.initialDataUrl);
		expect(next.signatureText).toBe("Terry Minett");
		expect(next.initials).toBe("TM");
		expect(next.label).toBe("Terry Minett:");
	});

	it("replaces a scan only when a new drawing is passed", () => {
		const next = buildSignatureSet({
			id: "1",
			existing: scan,
			signatureText: "Terry Minett",
			initials: "T",
			firstName: "Terry",
			lastName: "Minett",
			drawnSignatureDataUrl: "data:image/png;base64,new",
		});
		expect(next.signatureDataUrl).toBe("data:image/png;base64,new");
		expect(next.initialDataUrl).toBe(scan.initialDataUrl);
		expect(next.initials).toBe("T");
	});

	it("does not invent signature text from a profile name", () => {
		const next = buildSignatureSet({
			id: "2",
			signatureText: "",
			initials: "TM",
			firstName: "Terry",
			lastName: "Minett",
			drawnSignatureDataUrl: "data:image/png;base64,drawn",
			drawnInitialDataUrl: "data:image/png;base64,di",
		});
		expect(next.signatureText).toBeUndefined();
		expect(next.signatureDataUrl).toBe("data:image/png;base64,drawn");
		expect(next.initials).toBe("TM");
	});
});

describe("imageDataHasInk", () => {
	it("detects a non-transparent pixel", () => {
		const blank = new Uint8ClampedArray(16);
		expect(imageDataHasInk(blank)).toBe(false);
		const ink = new Uint8ClampedArray(16);
		ink[7] = 255;
		expect(imageDataHasInk(ink)).toBe(true);
	});
});

describe("isCaveatTextStamp", () => {
	it("requires text, Caveat, and no data URL", () => {
		expect(
			isCaveatTextStamp({
				type: "signature",
				text: "Terry Minett",
				fontFamily: "Caveat",
			}),
		).toBe(true);
		expect(
			isCaveatTextStamp({
				type: "signature",
				text: "Terry Minett",
				fontFamily: "Caveat",
				dataUrl: "data:image/png;base64,x",
			}),
		).toBe(false);
		expect(
			isCaveatTextStamp({
				type: "tick",
				text: "x",
				fontFamily: "Caveat",
			}),
		).toBe(false);
	});
});
