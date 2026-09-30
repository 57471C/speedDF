import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeDoc, initializeNewDocument } from "../../pdfStore.svelte";
import { flattenWorkspaceToImage, flattenWorkspaceToPDF } from "./flatten";

const caveatBytes = readFileSync("static/fonts/caveat/Caveat-Regular.ttf");
const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function blankPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.addPage([612, 792]);
	return doc.save();
}

/** Inflate PDF streams. Custom-font text is glyph ids plus a ToUnicode CMap. */
function pdfStreamTexts(bytes: Uint8Array): string[] {
	const raw = Buffer.from(bytes);
	const texts: string[] = [];
	const streamToken = Buffer.from("stream");
	const endToken = Buffer.from("endstream");
	let i = 0;
	while (i < raw.length) {
		const start = raw.indexOf(streamToken, i);
		if (start < 0) break;
		let dataStart = start + streamToken.length;
		if (raw[dataStart] === 0x0d && raw[dataStart + 1] === 0x0a) dataStart += 2;
		else if (raw[dataStart] === 0x0a) dataStart += 1;
		const end = raw.indexOf(endToken, dataStart);
		if (end < 0) break;
		let dataEnd = end;
		if (dataEnd > dataStart && raw[dataEnd - 1] === 0x0a) dataEnd--;
		if (dataEnd > dataStart && raw[dataEnd - 1] === 0x0d) dataEnd--;
		const body = raw.subarray(dataStart, dataEnd);
		try {
			texts.push(inflateSync(body).toString("latin1"));
		} catch {
			texts.push(body.toString("latin1"));
		}
		i = end + endToken.length;
	}
	return texts;
}

function hexToCodePoints(hex: string): string {
	let out = "";
	for (let i = 0; i + 4 <= hex.length; i += 4) {
		out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
	}
	return out;
}

/** Read drawText output back out: ToUnicode bfchar + <glyph ids> Tj. */
function extractDrawnText(bytes: Uint8Array): string {
	const streams = pdfStreamTexts(bytes);
	const glyphs = new Map<string, string>();
	for (const text of streams) {
		for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
			for (const pair of block[1].matchAll(
				/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
			)) {
				glyphs.set(pair[1].toUpperCase().padStart(4, "0"), hexToCodePoints(pair[2]));
			}
		}
	}
	let drawn = "";
	for (const text of streams) {
		for (const shown of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
			const hex = shown[1];
			for (let i = 0; i + 4 <= hex.length; i += 4) {
				const gid = hex.slice(i, i + 4).toUpperCase();
				drawn += glyphs.get(gid) ?? "";
			}
		}
	}
	return drawn;
}

describe("typed signature flatten", () => {
	beforeEach(() => {
		activeDoc.flushDocumentState();
		initializeNewDocument("sig.pdf", null);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (String(url).includes("/fonts/caveat/Caveat-Regular.ttf")) {
					return new Response(caveatBytes);
				}
				throw new Error(`unexpected fetch ${url}`);
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("bakes Caveat text that can be read back out of the PDF", async () => {
		activeDoc.rawBytes = await blankPdf();
		activeDoc.fileType = "pdf";
		activeDoc.pageCount = 1;
		activeDoc.pageOrder = [1];
		activeDoc.shapes = {
			1: [
				{
					type: "signature",
					x: 10,
					y: 70,
					width: 40,
					height: 10,
					text: "Terry Minett",
					fontFamily: "Caveat",
					textColor: "#1a1a1a",
				},
			],
		};

		const out = await flattenWorkspaceToPDF();
		expect(out).not.toBeNull();
		const bytes = out as Uint8Array;
		const streams = pdfStreamTexts(bytes);
		expect(streams.some((text) => text.includes("Caveat"))).toBe(true);
		expect(extractDrawnText(bytes)).toBe("Terry Minett");
	});

	it("keeps the PNG path when a signature data URL is set", async () => {
		activeDoc.rawBytes = await blankPdf();
		activeDoc.fileType = "pdf";
		activeDoc.pageCount = 1;
		activeDoc.pageOrder = [1];
		activeDoc.shapes = {
			1: [
				{
					type: "signature",
					x: 10,
					y: 70,
					width: 18,
					height: 8,
					dataUrl: TINY_PNG,
					text: "Terry Minett",
					fontFamily: "Caveat",
				},
			],
		};

		const out = await flattenWorkspaceToPDF();
		expect(out).not.toBeNull();
		const raw = Buffer.from(out as Uint8Array).toString("latin1");
		expect(raw).toContain("/Image");
		expect(raw).not.toContain("Caveat");
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});
});

describe("typed signature on an image", () => {
	const fills: { text: string; font: string }[] = [];
	const draws: string[] = [];

	beforeEach(() => {
		fills.length = 0;
		draws.length = 0;
		activeDoc.flushDocumentState();
		initializeNewDocument("page.png", "C:/tmp/page.png");
		activeDoc.fileType = "image";
		activeDoc.imageUrl = TINY_PNG;
		activeDoc.filePath = "C:/tmp/page.png";
		activeDoc.pageCount = 1;
		activeDoc.pageOrder = [1];

		class FakeImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			naturalWidth = 400;
			naturalHeight = 300;
			width = 400;
			height = 300;
			srcValue = "";
			set src(value: string) {
				this.srcValue = value;
				queueMicrotask(() => this.onload?.());
			}
			get src() {
				return this.srcValue;
			}
		}
		vi.stubGlobal("Image", FakeImage);

		const realCreate = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			const el = realCreate(tag);
			if (tag.toLowerCase() !== "canvas") return el;
			const canvas = el as HTMLCanvasElement;
			const ctx = {
				fillStyle: "",
				strokeStyle: "",
				font: "",
				textAlign: "left",
				textBaseline: "alphabetic",
				lineWidth: 1,
				lineCap: "butt",
				lineJoin: "miter",
				globalAlpha: 1,
				fillText(text: string) {
					fills.push({ text, font: ctx.font });
				},
				measureText(text: string) {
					return { width: String(text).length * 8 };
				},
				drawImage(img: { srcValue?: string }) {
					draws.push(img?.srcValue || "");
				},
			};
			const proxy = new Proxy(ctx, {
				get(target, prop) {
					if (prop in target) return target[prop as keyof typeof target];
					return () => {};
				},
				set(target, prop, value) {
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
			});
			canvas.getContext = (() =>
				proxy) as unknown as HTMLCanvasElement["getContext"];
			canvas.toDataURL = () =>
				"data:image/png;base64," + Buffer.from("png").toString("base64");
			return canvas;
		});

		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: { load: async () => [] },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("draws Caveat text and still stamps a data URL image", async () => {
		activeDoc.shapes = {
			1: [
				{
					type: "signature",
					x: 10,
					y: 20,
					width: 40,
					height: 12,
					text: "Terry Minett",
					fontFamily: "Caveat",
					textColor: "#1a1a1a",
				},
				{
					type: "initial",
					x: 60,
					y: 20,
					width: 8,
					height: 5,
					dataUrl: TINY_PNG,
				},
			],
		};

		const out = await flattenWorkspaceToImage("C:/tmp/page.png");
		expect(out).not.toBeNull();
		expect(fills.some((f) => f.text === "Terry Minett" && f.font.includes("Caveat"))).toBe(
			true,
		);
		expect(draws).toContain(TINY_PNG);
	});
});
