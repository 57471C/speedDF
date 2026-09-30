import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignatureOrInitialShape } from "./toolShapes";
import { flattenWorkspaceToPDF } from "../export/flatten";
import { activeDoc, initializeNewDocument } from "../../pdfStore.svelte";
import {
	dataUrlToPngDataUrl,
	fittedEdge,
	SIGNATURE_UPLOAD_MAX_BYTES,
	signatureFileToPngDataUrl,
	signatureUploadError,
} from "./signatureUpload";

type Raster = {
	width: number;
	height: number;
	data: Uint8ClampedArray;
};

type NodeCanvas = {
	getContext: (kind: "2d") => {
		clearRect: (x: number, y: number, w: number, h: number) => void;
		fillStyle: string;
		fillRect: (x: number, y: number, w: number, h: number) => void;
		drawImage: (image: CanvasImageSource, x: number, y: number) => void;
		getImageData: (
			x: number,
			y: number,
			w: number,
			h: number,
		) => { data: Uint8ClampedArray };
	};
	toBuffer: (mime: "image/png" | "image/jpeg") => Buffer;
};

const nodeRequire = createRequire(import.meta.url);
const nodeCanvas = nodeRequire("canvas") as {
	loadImage: (src: Buffer) => Promise<CanvasImageSource & { width: number; height: number }>;
	createCanvas: (width: number, height: number) => NodeCanvas;
};

let decodes = 0;

beforeEach(() => {
	decodes = 0;
	vi.stubGlobal(
		"createImageBitmap",
		async (blob: Blob) => {
			decodes += 1;
			const img = await nodeCanvas.loadImage(Buffer.from(await blob.arrayBuffer()));
			return Object.assign(img, { close() {} });
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	activeDoc.flushDocumentState();
});

function pngFile(bytes: Buffer, name = "mark.png"): File {
	return new File([bytes], name, { type: "image/png" });
}

function transparentSignaturePng(): Buffer {
	const canvas = nodeCanvas.createCanvas(4, 2);
	const ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, 4, 2);
	ctx.fillStyle = "rgba(220, 0, 0, 1)";
	ctx.fillRect(0, 0, 1, 1);
	return canvas.toBuffer("image/png");
}

async function pixelsOf(dataUrl: string): Promise<Raster> {
	const b64 = dataUrl.split(",")[1] || "";
	const img = await nodeCanvas.loadImage(Buffer.from(b64, "base64"));
	const canvas = nodeCanvas.createCanvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const image = ctx.getImageData(0, 0, img.width, img.height);
	return { width: img.width, height: img.height, data: image.data };
}

/** Two-frame GIF. Frame 0 is red + transparent. Frame 1 is blue. */
function twoFrameGif(): Uint8Array {
	const clearCode = 4;
	const eoi = 5;
	const bits: number[] = [];
	const write = (code: number, size: number) => {
		for (let i = 0; i < size; i++) bits.push((code >> i) & 1);
	};
	const dict = new Map<string, number>();
	let codeSize = 3;
	let nextCode = eoi + 1;
	const reset = () => {
		dict.clear();
		for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
		codeSize = 3;
		nextCode = eoi + 1;
	};
	const encode = (indices: number[]) => {
		bits.length = 0;
		reset();
		write(clearCode, codeSize);
		let w = "";
		for (const idx of indices) {
			const k = String.fromCharCode(idx);
			const wk = w + k;
			if (dict.has(wk)) {
				w = wk;
			} else {
				write(dict.get(w) ?? 0, codeSize);
				if (nextCode < 4096) {
					dict.set(wk, nextCode++);
					if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
				}
				w = k;
			}
		}
		if (w) write(dict.get(w) ?? 0, codeSize);
		write(eoi, codeSize);
		const bytes: number[] = [];
		for (let i = 0; i < bits.length; i += 8) {
			let b = 0;
			for (let j = 0; j < 8; j++) if (bits[i + j]) b |= 1 << j;
			bytes.push(b);
		}
		const out = [2];
		for (let offset = 0; offset < bytes.length; ) {
			const n = Math.min(255, bytes.length - offset);
			out.push(n, ...bytes.slice(offset, offset + n));
			offset += n;
		}
		out.push(0);
		return out;
	};
	const frame = (indices: number[], transparent: boolean) => [
		0x21, 0xf9, 0x04, transparent ? 0x01 : 0x00, 0x05, 0x00, 0x00, 0x00,
		0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0,
		...encode(indices),
	];
	return Uint8Array.from([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
		2, 0, 1, 0, 0x91, 0x00, 0x00,
		0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255,
		...frame([1, 0], true),
		...frame([2, 2], false),
		0x3b,
	]);
}

async function blankPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.addPage([612, 792]);
	return doc.save();
}

describe("signature upload rules", () => {
	it("caps the longest edge at 800 and does not enlarge", () => {
		expect(fittedEdge(1600, 800)).toEqual({ width: 800, height: 400 });
		expect(fittedEdge(100, 50)).toEqual({ width: 100, height: 50 });
		expect(fittedEdge(800, 800)).toEqual({ width: 800, height: 800 });
	});

	it("rejects pdf, svg, and files over 2MB", () => {
		expect(
			signatureUploadError({ name: "scan.pdf", type: "application/pdf", size: 20 }),
		).toMatch(/PNG, GIF, JPEG, or WebP/);
		expect(
			signatureUploadError({ name: "mark.svg", type: "image/svg+xml", size: 20 }),
		).toMatch(/PNG, GIF, JPEG, or WebP/);
		expect(
			signatureUploadError({
				name: "big.png",
				type: "image/png",
				size: SIGNATURE_UPLOAD_MAX_BYTES + 1,
			}),
		).toMatch(/2MB/);
		expect(
			signatureUploadError({ name: "mark.png", type: "image/png", size: 32 }),
		).toBeNull();
		expect(
			signatureUploadError({ name: "mark.jpeg", type: "", size: 32 }),
		).toBeNull();
		expect(
			signatureUploadError({ name: "mark.webp", type: "image/webp", size: 32 }),
		).toBeNull();
	});

	it("does not decode a file over 2MB", async () => {
		const big = new File(
			[new Uint8Array(SIGNATURE_UPLOAD_MAX_BYTES + 1)],
			"big.png",
			{ type: "image/png" },
		);
		await expect(signatureFileToPngDataUrl(big)).rejects.toThrow(/2MB/);
		expect(decodes).toBe(0);
	});
});

describe("signature upload decode", () => {
	it("keeps PNG alpha and places that image ahead of Caveat text", async () => {
		const dataUrl = await signatureFileToPngDataUrl(pngFile(transparentSignaturePng()));
		expect(dataUrl.startsWith("data:image/png")).toBe(true);
		const raster = await pixelsOf(dataUrl);
		expect([...raster.data.slice(0, 4)]).toEqual([220, 0, 0, 255]);
		expect(raster.data[7]).toBe(0);

		const shape = createSignatureOrInitialShape("signature", 40, 40, {
			ghostW: 18,
			ghostH: 8,
			dataUrl,
			text: "Terry Minett",
		});
		expect(shape.dataUrl).toBe(dataUrl);
		expect(shape.text).toBeUndefined();
		expect(shape.fontFamily).toBeUndefined();

		const fallback = createSignatureOrInitialShape("signature", 40, 40, {
			ghostW: 32,
			ghostH: 8,
			text: "Terry Minett",
		});
		expect(fallback.text).toBe("Terry Minett");
		expect(fallback.fontFamily).toBe("Caveat");
		expect(fallback.dataUrl).toBeUndefined();
	});

	it("stores a GIF as PNG using frame 0 only", async () => {
		const file = new File([twoFrameGif()], "sign.gif", { type: "image/gif" });
		const dataUrl = await signatureFileToPngDataUrl(file);
		expect(dataUrl.startsWith("data:image/png")).toBe(true);
		const raster = await pixelsOf(dataUrl);
		expect(raster.width).toBe(2);
		expect(raster.height).toBe(1);
		expect(raster.data[0]).toBeGreaterThan(200);
		expect(raster.data[2]).toBeLessThan(40);
		expect(raster.data[3]).toBe(255);
		expect(raster.data[7]).toBe(0);
	});

	it("turns a JPEG into an opaque PNG", async () => {
		const canvas = nodeCanvas.createCanvas(2, 2);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#112233";
		ctx.fillRect(0, 0, 2, 2);
		const file = new File([canvas.toBuffer("image/jpeg")], "photo.jpg", {
			type: "image/jpeg",
		});
		const dataUrl = await signatureFileToPngDataUrl(file);
		expect(dataUrl.startsWith("data:image/png")).toBe(true);
		const raster = await pixelsOf(dataUrl);
		expect(raster.data[3]).toBe(255);
	});

	it("scales a wide image down to 800px and keeps a transparent edge", async () => {
		const canvas = nodeCanvas.createCanvas(1000, 10);
		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, 1000, 10);
		ctx.fillStyle = "rgba(10, 20, 30, 1)";
		ctx.fillRect(0, 0, 400, 10);
		const dataUrl = await signatureFileToPngDataUrl(pngFile(canvas.toBuffer("image/png")));
		const raster = await pixelsOf(dataUrl);
		expect(raster.width).toBe(800);
		expect(raster.height).toBe(8);
		expect(raster.data[3]).toBe(255);
		expect(raster.data[(799 * 4) + 3]).toBe(0);
	});
});

describe("uploaded stamp on a PDF", () => {
	beforeEach(() => {
		activeDoc.flushDocumentState();
		initializeNewDocument("upload.pdf", null);
	});

	it("embeds a transparent PNG without baking an opaque mask", async () => {
		const dataUrl = await signatureFileToPngDataUrl(pngFile(transparentSignaturePng()));
		const before = await pixelsOf(dataUrl);
		expect(before.data[7]).toBe(0);

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
					dataUrl,
					text: "Terry Minett",
					fontFamily: "Caveat",
				},
			],
		};

		const out = await flattenWorkspaceToPDF();
		expect(out).not.toBeNull();
		const bytes = out as Uint8Array;
		const raw = Buffer.from(bytes).toString("latin1");
		expect(raw).toContain("/SMask");
		expect(raw).toContain("/Image");
		expect(raw).not.toContain("Caveat");

		const reopened = await PDFDocument.load(bytes);
		expect(reopened.getPageCount()).toBe(1);
		const again = Buffer.from(await reopened.save()).toString("latin1");
		expect(again).toContain("/SMask");
	});

	it("converts a JPEG data URL when embedPng cannot take it", async () => {
		const canvas = nodeCanvas.createCanvas(2, 2);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#445566";
		ctx.fillRect(0, 0, 2, 2);
		const jpegUrl = `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg").toString("base64")}`;
		await expect(PDFDocument.create().then((doc) => doc.embedPng(jpegUrl))).rejects.toThrow();
		const pngUrl = await dataUrlToPngDataUrl(jpegUrl);
		expect(pngUrl.startsWith("data:image/png")).toBe(true);

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
					width: 12,
					height: 8,
					dataUrl: jpegUrl,
				},
			],
		};
		const out = await flattenWorkspaceToPDF();
		expect(out).not.toBeNull();
		expect(Buffer.from(out as Uint8Array).toString("latin1")).toContain("/Image");
	});
});
