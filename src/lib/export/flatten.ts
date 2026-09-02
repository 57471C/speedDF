/**
 * Workspace flatten/export pipeline: PDF + image compilation, font embed,
 * and post-save thumbnail generation. UI chrome stays in TitleBar.svelte.
 */

import fontkit from "@pdf-lib/fontkit";
import {
	BlendMode,
	degrees,
	LineCapStyle,
	PDFDocument,
	type PDFFont,
	type PDFImage,
	PDFName,
	type PDFPage,
	PDFString,
	type RGB,
	rgb,
	type StandardFonts,
} from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import {
	activeDoc,
	applyLiveThumbnail,
	FONT_MAP,
	updateRecentThumbnail,
} from "../../pdfStore.svelte";
import {
	arrowHeadSizePct,
	arrowHeadVertices,
	HIGHLIGHT_COLOR,
	HIGHLIGHT_OPACITY,
	HIGHLIGHT_STROKE_WIDTH,
	lineStrokeEndpoints,
	shapesInPaintOrder,
} from "../annotation/toolShapes";
import { encodeCommentsKeyword } from "../comments/comments";
import { applyAndFlattenFormValues } from "../forms/formFields";
import {
	combinedPageRotation,
	computeFlattenedTextPosition,
	nextPageRotateDegrees,
} from "../render/pageRotation";
import {
	runWithPdfRenderSlot,
	THUMBNAIL_JPEG_QUALITY,
	THUMBNAIL_MAX_SCALE,
} from "../render/pdfRenderQueue";

function hexToRgb(hexString: string): RGB {
	const hex = hexString.replace("#", "");
	const r = parseInt(hex.substring(0, 2), 16) / 255;
	const g = parseInt(hex.substring(2, 4), 16) / 255;
	const b = parseInt(hex.substring(4, 6), 16) / 255;
	return rgb(r, g, b);
}

/** Drop C0 controls (except HT/LF/CR) and DEL — avoids control-char regex lint. */
function stripControlChars(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === 9 || code === 10 || code === 13) {
			out += text[i];
		} else if (code < 32 || code === 127) {
		} else {
			out += text[i];
		}
	}
	return out;
}

function getHexOpacity(hexString: string): number {
	const hex = hexString.replace("#", "");
	if (hex.length === 8) {
		return parseInt(hex.substring(6, 8), 16) / 255;
	}
	return 1.0;
}

function getDashArray(lineStyle?: string): number[] | undefined {
	if (!lineStyle || lineStyle === "solid") return undefined;
	if (lineStyle === "dashed") return [6, 6];
	if (lineStyle === "dotted") return [2, 3];
	if (lineStyle === "dash-dot") return [6, 3, 2, 3];
	return undefined;
}

async function drawAnnotationsOnPage(
	destDoc: PDFDocument,
	page: PDFPage,
	originalPageNumber: number,
	pageWidth: number,
	pageHeight: number,
	imageCache: Map<string, Promise<PDFImage>>,
	fontCache: Map<string, Promise<PDFFont>>,
	rotationAngle = 0,
) {
	// Stamps (tick/dash/signature/initial) last so they always sit on top of boxes/ink
	const pageShapes = shapesInPaintOrder(
		activeDoc.shapes[originalPageNumber] || [],
	);
	for (const { shape } of pageShapes) {
		if (!shape) continue;
		const s = shape;

		const x = (s.x / 100) * pageWidth;
		const w = ((s.width ?? 0) / 100) * pageWidth;
		const h = ((s.height ?? 0) / 100) * pageHeight;
		const y = pageHeight - (s.y / 100) * pageHeight - h;

		const shapeColorHex = s.color || "#000000";
		const resolvedColorRgb = hexToRgb(shapeColorHex);

		if (s.type === "rect") {
			page.drawRectangle({
				x,
				y,
				width: w,
				height: h,
				borderColor: resolvedColorRgb,
				borderWidth: 2,
				opacity: getHexOpacity(shapeColorHex),
				borderDashArray: getDashArray(s.lineStyle),
			});
		} else if (s.type === "rect-fill") {
			page.drawRectangle({
				x,
				y,
				width: w,
				height: h,
				color: resolvedColorRgb,
				opacity: getHexOpacity(shapeColorHex),
			});
		} else if (s.type === "oval") {
			page.drawEllipse({
				x: x + w / 2,
				y: y + h / 2,
				xScale: w / 2,
				yScale: h / 2,
				borderColor: resolvedColorRgb,
				borderWidth: 2,
				opacity: getHexOpacity(shapeColorHex),
				borderDashArray: getDashArray(s.lineStyle),
			});
		} else if (s.type === "oval-fill") {
			page.drawEllipse({
				x: x + w / 2,
				y: y + h / 2,
				xScale: w / 2,
				yScale: h / 2,
				color: resolvedColorRgb,
				opacity: getHexOpacity(shapeColorHex),
			});
		} else if (s.type === "text") {
			const fontName = s.fontFamily || s.font || "Helvetica";
			let pdfFont: PDFFont;

			if (fontName === "Inter") {
				let fontPromise = fontCache.get("Inter");
				if (!fontPromise) {
					fontPromise = (async () => {
						const fontResponse = await fetch("/fonts/inter/Inter-Regular.ttf");
						const fontBuffer = await fontResponse.arrayBuffer();
						return await destDoc.embedFont(fontBuffer);
					})();
					fontCache.set("Inter", fontPromise);
				}
				pdfFont = await fontPromise;
			} else if (fontName === "JetBrainsMono") {
				let fontPromise = fontCache.get("JetBrainsMono");
				if (!fontPromise) {
					fontPromise = (async () => {
						const fontResponse = await fetch(
							"/fonts/jetbrains/JetBrainsMono-Regular.ttf",
						);
						const fontBuffer = await fontResponse.arrayBuffer();
						return await destDoc.embedFont(fontBuffer);
					})();
					fontCache.set("JetBrainsMono", fontPromise);
				}
				pdfFont = await fontPromise;
			} else {
				const fontStyle = (s.style || "Normal") as "Normal" | "Bold" | "Italic";
				const fontMapping = FONT_MAP[fontName];
				const pdfFontKey = fontMapping
					? fontMapping.pdf[fontStyle] || fontMapping.pdf.Normal
					: "Helvetica";

				let fontPromise = fontCache.get(pdfFontKey);
				if (!fontPromise) {
					// embedStandardFont is sync; wrap so the cache stays Promise<PDFFont>
					fontPromise = Promise.resolve(
						destDoc.embedStandardFont(pdfFontKey as StandardFonts),
					);
					fontCache.set(pdfFontKey, fontPromise);
				}
				pdfFont = await fontPromise;
			}

			const fontSize = s.size || 12;
			const textHexColor = s.textColor || s.color || "#000000";
			const resolvedTextColorRgb = hexToRgb(textHexColor);

			// Font ascent above baseline (pdf-lib metric, no descender).
			const ascent = pdfFont.heightAtSize(fontSize, { descender: false });

			// Sanitize text input before PDF content stream injection
			let safeText = stripControlChars(s?.text || "");

			// Strip out full multi-byte emoji blocks, surrogate pairs, and pictograph ranges cleanly
			safeText = safeText.replace(
				/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
				"",
			);

			// Continue safeguarding rigid Core 14 fonts against out-of-bounds Latin characters:
			if (
				s.fontFamily === "Helvetica" ||
				s.fontFamily === "Times-Roman" ||
				s.fontFamily === "Courier"
			) {
				safeText = safeText.replace(/[^\x20-\x7E\x80-\xFF\n\r\t]/g, "");
			}

			if (safeText.length > 5000) {
				safeText = safeText.substring(0, 5000);
			}

			const computedTextWidth = pdfFont.widthOfTextAtSize(safeText, fontSize);

			const placement = computeFlattenedTextPosition({
				shape: s,
				pageWidth,
				pageHeight,
				rotationAngle,
				fontSize,
				ascent,
				textWidth: computedTextWidth,
			});

			page.drawText(safeText, {
				x: placement.x,
				y: placement.y,
				size: fontSize,
				font: pdfFont,
				color: resolvedTextColorRgb,
				opacity: getHexOpacity(textHexColor),
				rotate: degrees(placement.rotateDegrees),
			});
		} else if (s.type === "tick") {
			const startPt = { x: x + w * 0.167, y: y + h * 0.5 };
			const vertexPt = { x: x + w * 0.375, y: y + h * 0.292 };
			const endPt = { x: x + w * 0.833, y: y + h * 0.75 };
			page.drawLine({
				start: startPt,
				end: vertexPt,
				color: resolvedColorRgb,
				thickness: 3.5,
				lineCap: LineCapStyle.Round,
				opacity: getHexOpacity(shapeColorHex),
			});
			page.drawLine({
				start: vertexPt,
				end: endPt,
				color: resolvedColorRgb,
				thickness: 3.5,
				lineCap: LineCapStyle.Round,
				opacity: getHexOpacity(shapeColorHex),
			});
		} else if (s.type === "dash") {
			page.drawLine({
				start: { x, y: y + h / 2 },
				end: { x: x + w, y: y + h / 2 },
				color: resolvedColorRgb,
				thickness: 3.5,
				lineCap: LineCapStyle.Round,
				opacity: getHexOpacity(shapeColorHex),
			});
		} else if ((s.type === "signature" || s.type === "initial") && s.dataUrl) {
			let imgPromise = imageCache.get(s.dataUrl);
			if (!imgPromise) {
				imgPromise = destDoc.embedPng(s.dataUrl);
				imageCache.set(s.dataUrl, imgPromise);
			}
			const embeddedImageDest = await imgPromise;
			const imgW = embeddedImageDest.width;
			const imgH = embeddedImageDest.height;
			const dampedH = h * 0.8;
			const targetW = dampedH * (imgW / imgH);
			const dampedY = y + (h - dampedH) / 2;
			page.drawImage(embeddedImageDest, {
				x,
				y: dampedY,
				width: targetW,
				height: dampedH,
			});
		} else if (s.type === "highlight" && s.points && s.points.length > 1) {
			// Always neon yellow + translucent — never inherit pen/line toolbar styles
			const highlightRgb = hexToRgb(HIGHLIGHT_COLOR);
			const highlightThickness = (HIGHLIGHT_STROKE_WIDTH / 100) * pageWidth;
			for (let k = 0; k < s.points.length - 1; k++) {
				const p1 = s.points[k];
				const p2 = s.points[k + 1];
				page.drawLine({
					start: {
						x: (p1.x / 100) * pageWidth,
						y: pageHeight - (p1.y / 100) * pageHeight,
					},
					end: {
						x: (p2.x / 100) * pageWidth,
						y: pageHeight - (p2.y / 100) * pageHeight,
					},
					color: highlightRgb,
					thickness: highlightThickness,
					opacity: HIGHLIGHT_OPACITY,
					blendMode: BlendMode.Multiply,
					lineCap: LineCapStyle.Round,
				});
			}
		} else if (s.type === "pen" && s.points && s.points.length > 1) {
			for (let k = 0; k < s.points.length - 1; k++) {
				const p1 = s.points[k];
				const p2 = s.points[k + 1];
				page.drawLine({
					start: {
						x: (p1.x / 100) * pageWidth,
						y: pageHeight - (p1.y / 100) * pageHeight,
					},
					end: {
						x: (p2.x / 100) * pageWidth,
						y: pageHeight - (p2.y / 100) * pageHeight,
					},
					color: resolvedColorRgb,
					thickness: s.thickness || 3,
					opacity: getHexOpacity(shapeColorHex),
					lineCap: LineCapStyle.Round,
				});
			}
		} else if (s.type === "line" && s.points && s.points.length >= 2) {
			const pStart = s.points[0];
			const pEnd = s.points[1];
			const ends = s.lineEnds || "plain";
			const arrowSizePct = arrowHeadSizePct(s.thickness);
			// Shorten stroke to arrow bases so the round cap never pokes past the tip
			const stroke = lineStrokeEndpoints(pStart, pEnd, ends, arrowSizePct);
			const startPdf = {
				x: (stroke.start.x / 100) * pageWidth,
				y: pageHeight - (stroke.start.y / 100) * pageHeight,
			};
			const endPdf = {
				x: (stroke.end.x / 100) * pageWidth,
				y: pageHeight - (stroke.end.y / 100) * pageHeight,
			};
			page.drawLine({
				start: startPdf,
				end: endPdf,
				color: resolvedColorRgb,
				thickness: s.thickness || 3,
				opacity: getHexOpacity(shapeColorHex),
				lineCap: LineCapStyle.Round,
				dashArray: getDashArray(s.lineStyle),
			});

			const drawArrowHead = (
				fromPct: { x: number; y: number },
				tipPct: { x: number; y: number },
			) => {
				const head = arrowHeadVertices(fromPct, tipPct, arrowSizePct);
				const tipPdfX = (head[0].x / 100) * pageWidth;
				const tipPdfY = pageHeight - (head[0].y / 100) * pageHeight;
				// Local SVG coords (y-down) relative to tip; pdf-lib applies scale(1,-1)
				const local = head.map((v) => {
					const px = (v.x / 100) * pageWidth;
					const py = pageHeight - (v.y / 100) * pageHeight;
					return { x: px - tipPdfX, y: tipPdfY - py };
				});
				const path = `${local
					.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
					.join(" ")} Z`;
				page.drawSvgPath(path, {
					x: tipPdfX,
					y: tipPdfY,
					color: resolvedColorRgb,
					opacity: getHexOpacity(shapeColorHex),
					borderWidth: 0,
				});
			};
			if (ends === "end" || ends === "both") {
				drawArrowHead(pStart, pEnd);
			}
			if (ends === "both") {
				drawArrowHead(pEnd, pStart);
			}
		}
	}
}

export async function flattenWorkspaceToPDF(): Promise<Uint8Array | null> {
	if (!activeDoc.rawBytes || activeDoc.pageOrder.length === 0) return null;
	try {
		const destDoc = await PDFDocument.create();
		destDoc.registerFontkit(fontkit);
		const imageCache = new Map<string, Promise<PDFImage>>();
		const fontCache = new Map<string, Promise<PDFFont>>();
		if (activeDoc.fileType === "tiff") {
			console.log(
				"Save Engine: Compiling native multi-page TIFF drawing into a standard PDF structure...",
			);
			const annotationPromises = [];
			for (let i = 0; i < activeDoc.pageOrder.length; i++) {
				const originalPageNumber = activeDoc.pageOrder[i];
				const rawPngBytes = activeDoc.tiffPages[originalPageNumber - 1];
				if (!rawPngBytes) continue;

				const embeddedImage = await destDoc.embedPng(rawPngBytes);
				const rotationAngle = activeDoc.rotations[originalPageNumber] ?? 0;
				let pageWidth = embeddedImage.width;
				let pageHeight = embeddedImage.height;

				if (rotationAngle === 90 || rotationAngle === 270) {
					pageWidth = embeddedImage.height;
					pageHeight = embeddedImage.width;
				}

				const page = destDoc.addPage([pageWidth, pageHeight]);
				let drawX = 0;
				let drawY = 0;
				if (rotationAngle === 90) {
					drawX = pageWidth;
					drawY = 0;
				} else if (rotationAngle === 180) {
					drawX = pageWidth;
					drawY = pageHeight;
				} else if (rotationAngle === 270) {
					drawX = 0;
					drawY = pageHeight;
				}

				page.drawImage(embeddedImage, {
					x: drawX,
					y: drawY,
					width: embeddedImage.width,
					height: embeddedImage.height,
					rotate: degrees(-rotationAngle),
				});
				annotationPromises.push(
					drawAnnotationsOnPage(
						destDoc,
						page,
						originalPageNumber,
						pageWidth,
						pageHeight,
						imageCache,
						fontCache,
					),
				);
			}
			await Promise.all(annotationPromises);
		} else {
			const srcDoc = await PDFDocument.load(activeDoc.rawBytes);
			// Bake AcroForm values into page content before copyPages so filled
			// appearances survive the export pipeline (and remain multi-doc safe).
			// Use formValues presence too — fields may exist even if def list is stale.
			const hasFormEdits =
				(activeDoc.formFields?.length || 0) > 0 ||
				Object.keys(activeDoc.formValues || {}).length > 0;
			if (hasFormEdits) {
				try {
					await applyAndFlattenFormValues(srcDoc, activeDoc.formValues || {});
				} catch (formErr) {
					console.warn("Form fill/flatten during export failed:", formErr);
				}
			}
			const copiedPages = await destDoc.copyPages(
				srcDoc,
				activeDoc.pageOrder.map((num) => num - 1),
			);
			const annotationPromises = [];
			for (let i = 0; i < activeDoc.pageOrder.length; i++) {
				const originalPageNumber = activeDoc.pageOrder[i];
				const page = copiedPages[i];
				destDoc.addPage(page);

				const { width: pageWidth, height: pageHeight } = page.getSize();
				const sessionRotate = activeDoc.rotations[originalPageNumber] ?? 0;
				const existingRotate = page.getRotation()?.angle ?? 0;
				const totalRotation = combinedPageRotation(
					existingRotate,
					sessionRotate,
				);
				const bakedRotate = nextPageRotateDegrees(
					existingRotate,
					sessionRotate,
				);
				if (bakedRotate !== null) {
					page.setRotation(degrees(bakedRotate));
				}

				annotationPromises.push(
					drawAnnotationsOnPage(
						destDoc,
						page,
						originalPageNumber,
						pageWidth,
						pageHeight,
						imageCache,
						fontCache,
						totalRotation,
					),
				);
			}
			await Promise.all(annotationPromises);
		}

		// Outline / Bookmark Serialization Layer
		if (activeDoc.bookmarks && activeDoc.bookmarks.length > 0) {
			const { context } = destDoc;
			const pageRefs = destDoc.getPages().map((p) => p.ref); // Get native Object IDs for pages
			const pageOrderSet = new Set(activeDoc.pageOrder);
			const validBookmarks = activeDoc.bookmarks.filter((b) =>
				pageOrderSet.has(b.pageNum),
			);
			if (validBookmarks.length > 0) {
				const pageIndexMap = new Map<number, number>();
				for (let i = 0; i < activeDoc.pageOrder.length; i++) {
					pageIndexMap.set(activeDoc.pageOrder[i], i);
				}
				// Create individual outline item dictionaries
				const outlineItems = validBookmarks.flatMap((b) => {
					const targetIndex = pageIndexMap.get(b.pageNum);
					if (targetIndex === undefined) return [];
					const itemRef = context.nextRef();
					return [
						{
							ref: itemRef,
							dict: context.obj({
								Title: PDFString.of(b.name || `Page ${b.pageNum}`),
								Dest: [pageRefs[targetIndex], "XYZ", null, null, null], // Maps accurately to target page object reference
							}),
						},
					];
				});
				// Wire up the linked-list properties (/Parent, /Next, /Prev) for each item ref
				const outlinesDictRef = context.nextRef();
				outlineItems.forEach((item, idx) => {
					item.dict.set(PDFName.of("Parent"), outlinesDictRef);
					if (idx > 0)
						item.dict.set(PDFName.of("Prev"), outlineItems[idx - 1].ref);
					if (idx < outlineItems.length - 1)
						item.dict.set(PDFName.of("Next"), outlineItems[idx + 1].ref);
					context.assign(item.ref, item.dict);
				});
				// Compile the parent /Outlines root control block
				const outlinesDict = context.obj({
					Type: PDFName.of("Outlines"),
					First: outlineItems[0].ref,
					Last: outlineItems[outlineItems.length - 1].ref,
					Count: outlineItems.length,
				});
				context.assign(outlinesDictRef, outlinesDict);

				// Securely attach the completed hierarchy directly to the main file catalog registry
				destDoc.catalog.set(PDFName.of("Outlines"), outlinesDictRef);
			} else {
				destDoc.catalog.delete(PDFName.of("Outlines"));
			}
		} else {
			destDoc.catalog.delete(PDFName.of("Outlines"));
		}

		// Per-page threaded comments → PDF Keywords (pdf-lib / pdf.js readable metadata)
		// + PDF Text (sticky note) annots for other viewers when flags have positions.
		// Dest pages are written in pageOrder sequence as 1..N — remap pageNum to match.
		try {
			const pageOrder = activeDoc.pageOrder || [];
			const pageOrderSet = new Set(pageOrder);
			const commentsToSave = (activeDoc.comments || [])
				.filter((c) => pageOrderSet.has(c.pageNum))
				.map((c) => {
					const destPage = pageOrder.indexOf(c.pageNum) + 1;
					return destPage > 0 ? { ...c, pageNum: destPage } : c;
				});
			if (commentsToSave.length > 0) {
				destDoc.setKeywords([encodeCommentsKeyword(commentsToSave)]);
			}
			// Sticky notes for positioned flags (other PDF viewers)
			const pages = destDoc.getPages();
			for (const c of commentsToSave) {
				if (
					typeof c.x !== "number" ||
					typeof c.y !== "number" ||
					!Number.isFinite(c.x) ||
					!Number.isFinite(c.y)
				) {
					continue;
				}
				const pageIndex = c.pageNum - 1;
				if (pageIndex < 0 || pageIndex >= pages.length) continue;
				const page = pages[pageIndex];
				const { width: pageWidth, height: pageHeight } = page.getSize();
				// % top-left → PDF bottom-left
				const pdfX = (c.x / 100) * pageWidth;
				const pdfYTop = (c.y / 100) * pageHeight;
				const icon = 18;
				const rect = [
					pdfX - icon * 0.35,
					pageHeight - pdfYTop - icon * 0.15,
					pdfX + icon * 0.65,
					pageHeight - pdfYTop + icon * 0.85,
				];
				const contents = [c.text || "Comment"]
					.concat((c.replies || []).map((r) => `↳ ${r.author}: ${r.text}`))
					.join("\n");
				const annotDict = destDoc.context.obj({
					Type: "Annot",
					Subtype: "Text",
					Rect: rect,
					C: [1, 0.92, 0.05],
					Open: false,
					Name: "Comment",
					F: 4, // Print
					P: page.ref,
				});
				annotDict.set(
					PDFName.of("Contents"),
					PDFString.of(contents.slice(0, 2000)),
				);
				annotDict.set(
					PDFName.of("T"),
					PDFString.of(
						(c.authorFullName || c.author || "speedDF").slice(0, 64),
					),
				);
				// NM: unique name so speedDF can recognize its own notes if needed
				annotDict.set(PDFName.of("NM"), PDFString.of(`speeddf-cmt-${c.id}`));
				const annotRef = destDoc.context.register(annotDict);
				page.node.addAnnot(annotRef);
			}
		} catch (commentsErr) {
			console.warn("Failed to embed comments into PDF keywords:", commentsErr);
		}

		return await destDoc.save();
	} catch (err) {
		console.error("PDF Flattening/Compilation Failure:", err);
		return null;
	}
}

export async function flattenWorkspaceToImage(
	outputPath: string | null = null,
): Promise<Uint8Array | null> {
	if (!activeDoc.imageUrl) return null;
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = (err) => reject(err);
			img.src = activeDoc.imageUrl || "";
		});

		const basePageWidth = img.naturalWidth || img.width;
		const basePageHeight = img.naturalHeight || img.height;

		const shapes = activeDoc.shapes[1] || [];
		const imgElements: { [key: number]: HTMLImageElement } = {};
		for (let i = 0; i < shapes.length; i++) {
			const shape = shapes[i];
			if (
				shape &&
				(shape.type === "signature" || shape.type === "initial") &&
				shape.dataUrl
			) {
				try {
					const sigImg = new Image();
					await new Promise<void>((resolve, reject) => {
						sigImg.onload = () => resolve();
						sigImg.onerror = (err) => reject(err);
						sigImg.src = shape.dataUrl || "";
					});
					imgElements[i] = sigImg;
				} catch (e) {
					console.error("Failed to preload signature image:", e);
				}
			}
		}

		const canvas = document.createElement("canvas");
		const rotation = activeDoc.imageRotation || 0;
		const isRotated90 = rotation === 90 || rotation === 270;

		const W = basePageWidth;
		const H = basePageHeight;

		canvas.width = isRotated90 ? H : W;
		canvas.height = isRotated90 ? W : H;

		const ctx = canvas.getContext("2d");
		if (!ctx) return null;

		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((rotation * Math.PI) / 180);
		ctx.drawImage(img, -W / 2, -H / 2, W, H);

		// Stamps last so they paint above boxes / freehand / text
		const orderedShapes = shapesInPaintOrder(shapes);
		for (const { shape, index: i } of orderedShapes) {
			if (!shape) continue;

			const x = -W / 2 + (shape.x / 100) * W;
			const y = -H / 2 + (shape.y / 100) * H;
			const w = ((shape.width ?? 0) / 100) * W;
			const h = ((shape.height ?? 0) / 100) * H;

			ctx.save();
			ctx.strokeStyle = shape.color || "#000000";
			ctx.fillStyle = shape.color || "#000000";
			ctx.lineWidth = shape.thickness || 3;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";

			const dashPattern = getDashArray(shape.lineStyle);
			if (dashPattern) {
				ctx.setLineDash(dashPattern);
			}

			if (shape.type === "rect") {
				ctx.strokeRect(x, y, w, h);
			} else if (shape.type === "rect-fill") {
				ctx.fillRect(x, y, w, h);
			} else if (shape.type === "round-rect") {
				ctx.beginPath();
				if (typeof ctx.roundRect === "function") {
					ctx.roundRect(x, y, w, h, 8);
				} else {
					ctx.rect(x, y, w, h);
				}
				ctx.stroke();
			} else if (shape.type === "round-rect-fill") {
				ctx.beginPath();
				if (typeof ctx.roundRect === "function") {
					ctx.roundRect(x, y, w, h, 8);
				} else {
					ctx.rect(x, y, w, h);
				}
				ctx.fill();
			} else if (shape.type === "oval") {
				ctx.beginPath();
				ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
				ctx.stroke();
			} else if (shape.type === "oval-fill") {
				ctx.beginPath();
				ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
				ctx.fill();
			} else if (shape.type === "text") {
				ctx.fillStyle = shape.textColor || shape.color || "#000000";
				const fontSize = shape.size || 12;
				const fontName = shape.fontFamily || shape.font || "Helvetica";
				const fontStyle =
					shape.style === "Bold"
						? "bold"
						: shape.style === "Italic"
							? "italic"
							: "normal";
				const cssFontFamily =
					FONT_MAP[fontName]?.css || `${fontName}, sans-serif`;
				ctx.font = `${fontStyle} ${fontSize}px ${cssFontFamily}`;
				ctx.textBaseline = "top";
				// Content inset: 1px border + 2px CSS padding (p-0.5)
				ctx.fillText(shape.text || "", x + 3, y + 3);
			} else if (shape.type === "tick") {
				ctx.beginPath();
				ctx.moveTo(x + (20 / 24) * w, y + (6 / 24) * h);
				ctx.lineTo(x + (9 / 24) * w, y + (17 / 24) * h);
				ctx.lineTo(x + (4 / 24) * w, y + (12 / 24) * h);
				ctx.stroke();
			} else if (shape.type === "dash") {
				ctx.beginPath();
				ctx.moveTo(x + (2 / 24) * w, y + (12 / 24) * h);
				ctx.lineTo(x + (22 / 24) * w, y + (12 / 24) * h);
				ctx.stroke();
			} else if (shape.type === "signature" || shape.type === "initial") {
				const sigImg = imgElements[i];
				if (sigImg) {
					ctx.drawImage(sigImg, x, y, w, h);
				}
			} else if (
				(shape.type === "pen" || shape.type === "highlight") &&
				shape.points
			) {
				if (shape.points.length > 0) {
					ctx.beginPath();
					const firstPt = shape.points[0];
					const fx = -W / 2 + (firstPt.x / 100) * W;
					const fy = -H / 2 + (firstPt.y / 100) * H;
					ctx.moveTo(fx, fy);
					for (let j = 1; j < shape.points.length; j++) {
						const pt = shape.points[j];
						const px = -W / 2 + (pt.x / 100) * W;
						const py = -H / 2 + (pt.y / 100) * H;
						ctx.lineTo(px, py);
					}
					if (shape.type === "highlight") {
						ctx.strokeStyle = HIGHLIGHT_COLOR;
						ctx.lineWidth = (HIGHLIGHT_STROKE_WIDTH / 100) * W;
						ctx.globalAlpha = HIGHLIGHT_OPACITY;
					}
					ctx.stroke();
				}
			} else if (
				shape.type === "line" &&
				shape.points &&
				shape.points.length >= 2
			) {
				const p0 = shape.points[0];
				const p1 = shape.points[1];
				const ends = shape.lineEnds || "plain";
				const arrowSizePct = arrowHeadSizePct(shape.thickness);
				const stroke = lineStrokeEndpoints(p0, p1, ends, arrowSizePct);
				const x0 = -W / 2 + (stroke.start.x / 100) * W;
				const y0 = -H / 2 + (stroke.start.y / 100) * H;
				const x1 = -W / 2 + (stroke.end.x / 100) * W;
				const y1 = -H / 2 + (stroke.end.y / 100) * H;
				ctx.beginPath();
				ctx.moveTo(x0, y0);
				ctx.lineTo(x1, y1);
				ctx.stroke();

				const drawHead = (
					from: { x: number; y: number },
					tip: { x: number; y: number },
				) => {
					const head = arrowHeadVertices(from, tip, arrowSizePct);
					ctx.beginPath();
					head.forEach((v, i) => {
						const px = -W / 2 + (v.x / 100) * W;
						const py = -H / 2 + (v.y / 100) * H;
						if (i === 0) ctx.moveTo(px, py);
						else ctx.lineTo(px, py);
					});
					ctx.closePath();
					ctx.fill();
				};
				if (ends === "end" || ends === "both") drawHead(p0, p1);
				if (ends === "both") drawHead(p1, p0);
			}
			ctx.restore();
		}

		ctx.restore();

		const lowerPath = (outputPath || activeDoc.filePath || "").toLowerCase();
		let mimeType = "image/jpeg";
		if (lowerPath.endsWith(".png")) {
			mimeType = "image/png";
		} else if (lowerPath.endsWith(".webp")) {
			mimeType = "image/webp";
		}
		// SVG source opens as image; flatten always bakes to raster (JPEG default).
		// Do not try to write annotations back as SVG.

		const dataUrl =
			mimeType === "image/jpeg"
				? canvas.toDataURL(mimeType, 0.95)
				: canvas.toDataURL(mimeType);

		const base64Data = dataUrl.split(",")[1];
		const binaryString = atob(base64Data);
		const len = binaryString.length;
		const resultBytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) {
			resultBytes[i] = binaryString.charCodeAt(i);
		}
		return resultBytes;
	} catch (err) {
		console.error("Failed to compile image annotations:", err);
		return null;
	}
}

async function generateTrueAnnotationThumbnail(
	pdfBytes: Uint8Array,
	targetPath: string,
) {
	try {
		await runWithPdfRenderSlot("low", async () => {
			// 1. Initialize a standalone background pdf.js worker task from the fresh bytes
			//    (fresh flattened bytes — must not reuse the live workspace document handle)
			const loadingTask = pdfjsLib.getDocument({
				data: pdfBytes.slice(0),
				cMapUrl: `${window.location.origin}/cmaps/`,
				cMapPacked: true,
				standardFontDataUrl: `${window.location.origin}/standard_fonts/`,
				wasmUrl: `${window.location.origin}/`,
			});
			try {
				const freshPdfDoc = await loadingTask.promise;

				// 2. Fetch page 1 containing our newly flattened text/vector marks
				const firstPage = await freshPdfDoc.getPage(1);

				// 3. Detached offscreen canvas — never the main workspace canvas
				const offscreenCanvas = document.createElement("canvas");
				const offscreenContext = offscreenCanvas.getContext("2d");
				const thumbViewport = firstPage.getViewport({
					scale: THUMBNAIL_MAX_SCALE,
				});

				offscreenCanvas.width = thumbViewport.width;
				offscreenCanvas.height = thumbViewport.height;

				if (offscreenContext) {
					// 4. Render the flattened page layout onto the offscreen canvas context
					const renderTask = firstPage.render({
						canvas: offscreenCanvas,
						viewport: thumbViewport,
					});
					try {
						await renderTask.promise;
					} catch (err: unknown) {
						if (
							err &&
							typeof err === "object" &&
							"name" in err &&
							(err as { name?: string }).name === "RenderingCancelledException"
						) {
							return;
						}
						throw err;
					}

					const freshlyGeneratedDataUrl = offscreenCanvas.toDataURL(
						"image/jpeg",
						THUMBNAIL_JPEG_QUALITY,
					);

					// 5–6. Store override map + bump version + refresh recents
					applyLiveThumbnail(freshlyGeneratedDataUrl, targetPath, 0);
					console.log(
						"🚀 True annotation thumbnail successfully broadcasted across app environments.",
					);
				}
			} finally {
				// Clean up the background loading task to release system memory heaps
				try {
					await loadingTask.destroy();
				} catch {
					/* ignore */
				}
			}
		});
	} catch (err) {
		console.warn("Skipped background thumbnail compilation pass:", err);
	}
}

function mimeTypeForImagePath(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".bmp")) return "image/bmp";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	return "image/jpeg";
}

/**
 * IMAGE pipeline (mirrors PDF): load flattened annotated bytes → downscale offscreen
 * → JPEG data URL → applyLiveThumbnail (overrides + recents + version).
 * Does not capture live DOM workspace canvas.
 */
async function generateImageAnnotationThumbnail(
	imageBytes: Uint8Array,
	targetPath: string,
) {
	try {
		const mimeType = mimeTypeForImagePath(targetPath);
		// Copy into a fresh ArrayBuffer-backed view — Blob rejects SharedArrayBuffer views.
		const safeBytes = Uint8Array.from(imageBytes);
		const blob = new Blob([safeBytes], { type: mimeType });
		const objectUrl = URL.createObjectURL(blob);

		try {
			const img = new Image();
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () =>
					reject(new Error("Failed to decode flattened image bytes"));
				img.src = objectUrl;
			});

			const maxEdge = 200;
			const scale = Math.min(
				1,
				maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1),
			);
			const w = Math.max(1, Math.round(img.naturalWidth * scale));
			const h = Math.max(1, Math.round(img.naturalHeight * scale));

			const offscreenCanvas = document.createElement("canvas");
			offscreenCanvas.width = w;
			offscreenCanvas.height = h;
			const ctx = offscreenCanvas.getContext("2d");
			if (!ctx) return;

			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, w, h);
			ctx.drawImage(img, 0, 0, w, h);

			const freshlyGeneratedDataUrl = offscreenCanvas.toDataURL(
				"image/jpeg",
				THUMBNAIL_JPEG_QUALITY,
			);
			if (!freshlyGeneratedDataUrl || freshlyGeneratedDataUrl.length < 32) {
				console.warn(
					"Image thumbnail data URL empty after flatten; skipping broadcast.",
				);
				return;
			}

			applyLiveThumbnail(freshlyGeneratedDataUrl, targetPath, 0);
			console.log(
				"🚀 Image annotation thumbnail broadcasted (overrides + recents + version).",
			);
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	} catch (err) {
		console.warn("Skipped image thumbnail compilation pass:", err);
	}
}

export function syncLiveThumbnail(
	targetPath: string,
	compiledBytes?: Uint8Array | null,
) {
	if (!targetPath) return;
	try {
		// PDF: offscreen pdf.js render of flattened bytes → applyLiveThumbnail
		if (
			compiledBytes &&
			compiledBytes.length > 0 &&
			activeDoc.fileType !== "image"
		) {
			generateTrueAnnotationThumbnail(compiledBytes, targetPath);
			return;
		}

		// IMAGE: offscreen downscale of flattened annotated bytes → applyLiveThumbnail
		if (
			compiledBytes &&
			compiledBytes.length > 0 &&
			activeDoc.fileType === "image"
		) {
			void generateImageAnnotationThumbnail(compiledBytes, targetPath);
			return;
		}

		// Last-resort fallback: live workspace canvas (should rarely run)
		const pageOneCanvas =
			document.querySelector('canvas[data-page-index="0"]') ||
			document.querySelector("canvas");

		if (pageOneCanvas instanceof HTMLCanvasElement) {
			const targetThumbnailDataUrl = pageOneCanvas.toDataURL("image/jpeg", 0.4);

			const cacheKey = `speeddf_meta_${btoa(targetPath)}`;
			const currentMetaRaw = localStorage.getItem(cacheKey);
			if (currentMetaRaw) {
				try {
					const parsedMeta = JSON.parse(currentMetaRaw);
					parsedMeta.thumbnail = targetThumbnailDataUrl;
					parsedMeta.timestamp = Date.now();
					localStorage.setItem(cacheKey, JSON.stringify(parsedMeta));
				} catch (_e) {}
			}

			updateRecentThumbnail(targetPath, targetThumbnailDataUrl);
			console.log(
				"🚀 Triggered reactive application store thumbnail mutation pass.",
			);
		}
	} catch (thumbSyncError) {
		console.warn(
			"Skipped dashboard visualization cache stream extraction pass:",
			thumbSyncError,
		);
	}
}

/** Public alias used by TitleBar bind:this / print path. */
export const getAnnotatedPdfBytes = flattenWorkspaceToPDF;
