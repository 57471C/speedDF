import { describe, expect, it } from "vitest";
import { createSignatureOrInitialShape } from "./toolShapes";
import {
	buildSignatureSet,
	imageDataHasInk,
	initialsFromIdentity,
	isCaveatTextStamp,
	resolveCaveatString,
} from "./signatureText";

describe("resolveCaveatString", () => {
	it("joins first and last with one space", () => {
		expect(resolveCaveatString(" Terry ", " Minett ")).toBe("Terry Minett");
		expect(resolveCaveatString("Terry", "")).toBe("Terry");
		expect(resolveCaveatString("", "")).toBe("");
	});

	it("lets Written as replace the Caveat string only", () => {
		expect(resolveCaveatString("Terry", "Minett", "  T. Minett  ")).toBe(
			"T. Minett",
		);
		expect(resolveCaveatString("Terry", "Minett", "   ")).toBe("Terry Minett");
	});
});

describe("initialsFromIdentity", () => {
	it("uses the first letter of first and last, uppercase", () => {
		expect(initialsFromIdentity("Terry", "Minett")).toBe("TM");
		expect(initialsFromIdentity(" terry ", " minett ")).toBe("TM");
		expect(initialsFromIdentity("Mary Ann", "Smith")).toBe("MS");
		expect(initialsFromIdentity("Terry", "")).toBe("T");
		expect(initialsFromIdentity("", "")).toBe("");
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

	it("stores First Last and TM when Written as is empty", () => {
		const next = buildSignatureSet({
			id: "2",
			signatureText: "",
			firstName: " Terry ",
			lastName: " Minett ",
			drawnSignatureDataUrl: "data:image/png;base64,drawn",
			drawnInitialDataUrl: "data:image/png;base64,di",
		});
		expect(next.signatureText).toBe("Terry Minett");
		expect(next.initials).toBe("TM");
		expect(next.firstName).toBe("Terry");
		expect(next.lastName).toBe("Minett");
		expect(next.signatureDataUrl).toBe("data:image/png;base64,drawn");
		expect(next.initialDataUrl).toBe("data:image/png;base64,di");
		expect(next.label).toBe("Terry Minett:");
	});

	it("lets Written as override the Caveat string without changing identity or initials", () => {
		const next = buildSignatureSet({
			id: "3",
			signatureText: "Alex Quinn",
			firstName: "Terry",
			lastName: "Minett",
		});
		expect(next.signatureText).toBe("Alex Quinn");
		expect(next.firstName).toBe("Terry");
		expect(next.lastName).toBe("Minett");
		expect(next.initials).toBe("TM");
		expect(next.label).toBe("Terry Minett:");
	});

	it("places a Caveat stamp with the profile name", () => {
		const set = buildSignatureSet({
			id: "tm",
			firstName: "Terry",
			lastName: "Minett",
		});
		const shape = createSignatureOrInitialShape("signature", 50, 40, {
			ghostW: 32,
			ghostH: 8,
			text: set.signatureText,
		});
		expect(set.initials).toBe("TM");
		expect(shape.text).toBe("Terry Minett");
		expect(shape.fontFamily).toBe("Caveat");
		expect(shape.textColor).toBe("#1a1a1a");
		expect(shape.dataUrl).toBeUndefined();
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
