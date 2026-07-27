/**
 * AcroForm field detection + value application (non-XFA).
 * Uses pdf-lib for structure and save; UI positions use page-relative percentages
 * (top-left origin) consistent with annotation shapes.
 *
 * Signature fields reuse stamp data URLs (string values) and are drawn + removed
 * on save — pdf-lib does not generate digital-signature appearances.
 */

import {
	PDFCheckBox,
	PDFDocument,
	PDFDropdown,
	type PDFImage,
	type PDFPage,
	PDFSignature,
	PDFTextField,
} from "pdf-lib";

export type FormFieldType = "text" | "checkbox" | "dropdown" | "signature";

export type FormFieldValue = string | boolean;

/** Widget-level form field definition for overlay rendering. */
export interface FormFieldDef {
	/** Fully-qualified AcroForm field name (pdf-lib). */
	name: string;
	type: FormFieldType;
	/** 1-based original page number in the PDF. */
	pageNum: number;
	/** Left edge as % of page width (0–100), CSS top-left space. */
	x: number;
	/** Top edge as % of page height (0–100), CSS top-left space. */
	y: number;
	/** Width as % of page width. */
	width: number;
	/** Height as % of page height. */
	height: number;
	/** Dropdown options (display strings). */
	options?: string[];
	readOnly?: boolean;
	maxLength?: number;
	/** Disambiguate multi-widget fields. */
	widgetIndex: number;
}

export function fieldsForPage(
	fields: FormFieldDef[] | undefined | null,
	pageNum: number,
): FormFieldDef[] {
	return (fields || []).filter((f) => f.pageNum === pageNum);
}

/** True when a form value looks like an embedded stamp image. */
export function isSignatureStampValue(
	v: FormFieldValue | undefined | null,
): v is string {
	return typeof v === "string" && v.startsWith("data:image/");
}

/**
 * Extract interactive AcroForm text/checkbox/dropdown/signature widgets from PDF bytes.
 * Returns empty arrays when the document has no form or is not a PDF AcroForm.
 */
export async function extractFormFields(
	pdfBytes: Uint8Array,
): Promise<{ fields: FormFieldDef[]; values: Record<string, FormFieldValue> }> {
	try {
		const doc = await PDFDocument.load(pdfBytes, {
			ignoreEncryption: true,
			updateMetadata: false,
		});
		const form = doc.getForm();
		const pages = doc.getPages();
		const fields: FormFieldDef[] = [];
		const values: Record<string, FormFieldValue> = {};

		for (const field of form.getFields()) {
			const name = field.getName();
			if (!name) continue;

			let type: FormFieldType | null = null;
			let options: string[] | undefined;
			let maxLength: number | undefined;

			if (field instanceof PDFTextField) {
				type = "text";
				if (!(name in values)) {
					values[name] = field.getText() ?? "";
				}
				try {
					maxLength = field.getMaxLength() ?? undefined;
				} catch {
					/* ignore */
				}
			} else if (field instanceof PDFCheckBox) {
				type = "checkbox";
				if (!(name in values)) {
					values[name] = field.isChecked();
				}
			} else if (field instanceof PDFDropdown) {
				type = "dropdown";
				try {
					options = field.getOptions();
				} catch {
					options = [];
				}
				if (!(name in values)) {
					const selected = field.getSelected();
					values[name] = selected?.[0] ?? "";
				}
			} else if (field instanceof PDFSignature) {
				// Stamp overlay only — pdf-lib has no digital-signature payload API
				type = "signature";
				if (!(name in values)) {
					values[name] = "";
				}
			} else {
				// Skip radio groups, buttons, option lists for now
				continue;
			}

			if (!type) continue;
			const fieldType = type;

			const readOnly = (() => {
				try {
					return field.isReadOnly();
				} catch {
					return false;
				}
			})();

			const widgets = field.acroField.getWidgets();
			if (!widgets || widgets.length === 0) continue;

			widgets.forEach((widget, widgetIndex) => {
				try {
					const rect = widget.getRectangle();
					const page = resolveWidgetPage(doc, pages, widget);
					if (!page) return;
					const pageNum = pages.indexOf(page) + 1;
					if (pageNum < 1) return;

					// Prefer CropBox (matches pdf.js viewBox) over MediaBox so
					// overlays align with the painted page at every zoom.
					const crop = page.getCropBox();
					const viewW = crop.width;
					const viewH = crop.height;
					if (viewW <= 0 || viewH <= 0) return;

					let rotationAngle = 0;
					try {
						rotationAngle = page.getRotation()?.angle ?? 0;
					} catch {
						rotationAngle = 0;
					}

					const display = pdfRectToDisplayPercent(
						rect,
						crop.x,
						crop.y,
						viewW,
						viewH,
						rotationAngle,
					);

					fields.push({
						name,
						type: fieldType,
						pageNum,
						x: clampPct(display.x),
						y: clampPct(display.y),
						width: Math.max(0.5, clampPct(display.width)),
						height: Math.max(0.5, clampPct(display.height)),
						options,
						readOnly,
						maxLength,
						widgetIndex,
					});
				} catch (err) {
					console.warn("Skipping form widget for", name, err);
				}
			});
		}

		return { fields, values };
	} catch (err) {
		// Missing/corrupt AcroForm, encrypted edge cases, non-PDF bytes
		console.warn("Form field extraction skipped:", err);
		return { fields: [], values: {} };
	}
}

/**
 * Write in-memory form values onto a loaded pdf-lib document and flatten
 * so appearances bake into page content (copy-safe for our export pipeline).
 *
 * Signature fields: draw the chosen stamp image into the widget rect, then
 * remove the field (pdf-lib cannot build Sig appearances).
 */
export async function applyAndFlattenFormValues(
	pdfDoc: PDFDocument,
	values: Record<string, FormFieldValue> | undefined | null,
): Promise<void> {
	const form = pdfDoc.getForm();
	const map = values || {};
	const pages = pdfDoc.getPages();
	const imageCache = new Map<string, PDFImage>();

	for (const field of form.getFields()) {
		const name = field.getName();
		if (!name) continue;
		const hasOverride = Object.hasOwn(map, name);
		const v = hasOverride ? map[name] : undefined;

		try {
			if (field instanceof PDFSignature) {
				// Always strip Sig widgets before flatten (empty ones have no appearance
				// and pdf-lib form.removeField / flatten require an /AP stream).
				if (isSignatureStampValue(v)) {
					await drawSignatureStampOnField(pdfDoc, pages, field, v, imageCache);
				}
				removeSignatureFieldSafely(pdfDoc, form, field, pages);
				continue;
			}

			if (!hasOverride) continue;

			if (field instanceof PDFTextField) {
				const text = v == null ? "" : String(v);
				const max = field.getMaxLength();
				// Need appearance refresh so flatten draws the new string
				field.setText(
					max != null && text.length > max ? text.slice(0, max) : text,
				);
			} else if (field instanceof PDFCheckBox) {
				if (v === true || v === "true" || v === "Yes" || v === "On") {
					field.check();
				} else {
					field.uncheck();
				}
			} else if (field instanceof PDFDropdown) {
				const text = v == null ? "" : String(v);
				if (text) {
					try {
						field.select(text);
					} catch {
						// Value not in options — skip quietly
					}
				}
			}
		} catch (err) {
			console.warn("Failed to set form field", name, err);
		}
	}

	// Appearances must be rebuilt before flatten or baked pages stay blank/old
	try {
		form.updateFieldAppearances();
	} catch (err) {
		console.warn("Form appearance update failed:", err);
	}

	try {
		// updateFieldAppearances: true again inside flatten for safety
		form.flatten({ updateFieldAppearances: true });
	} catch (err) {
		// Flatten can fail on odd forms; filled values may still be in the dictionary
		console.warn("Form flatten failed (values may still be present):", err);
	}
}

/**
 * Remove a signature field without requiring widget appearance streams.
 * pdf-lib's form.removeField walks /AP and throws on empty Sig widgets.
 */
function removeSignatureFieldSafely(
	pdfDoc: PDFDocument,
	form: ReturnType<PDFDocument["getForm"]>,
	field: PDFSignature,
	pages: PDFPage[],
): void {
	const name = field.getName();
	try {
		const widgets = field.acroField.getWidgets();
		for (const widget of widgets) {
			try {
				const widgetRef = pdfDoc.context.getObjectRef(
					// pdf-lib Widget exposes dict but types omit it
					(
						widget as {
							dict: Parameters<typeof pdfDoc.context.getObjectRef>[0];
						}
					).dict,
				);
				const page = resolveWidgetPage(pdfDoc, pages, widget);
				if (page && widgetRef) {
					page.node.removeAnnot(widgetRef);
				}
			} catch {
				/* continue */
			}
		}
		// Merged field/widget: field.ref is also the annotation on the page
		for (const page of pages) {
			try {
				page.node.removeAnnot(field.ref);
			} catch {
				/* ignore */
			}
		}
		try {
			form.acroForm.removeField(field.acroField);
		} catch {
			/* may already be unlinked */
		}
		try {
			const kids = field.acroField.Kids();
			if (kids) {
				for (let i = 0; i < kids.size(); i++) {
					const child = kids.get(i);
					// Only delete object refs (not nested dicts)
					if (child && "objectNumber" in (child as object)) {
						pdfDoc.context.delete(
							child as Parameters<typeof pdfDoc.context.delete>[0],
						);
					}
				}
			}
		} catch {
			/* ignore */
		}
		try {
			pdfDoc.context.delete(field.ref);
		} catch {
			/* ignore */
		}
	} catch (err) {
		console.warn("Failed to remove signature field", name, err);
	}
}

async function drawSignatureStampOnField(
	pdfDoc: PDFDocument,
	pages: PDFPage[],
	field: PDFSignature,
	dataUrl: string,
	imageCache: Map<string, PDFImage>,
): Promise<void> {
	let embedded = imageCache.get(dataUrl);
	if (!embedded) {
		// Stamps from canvas are PNG; fall back to JPG if needed
		if (
			dataUrl.startsWith("data:image/jpeg") ||
			dataUrl.startsWith("data:image/jpg")
		) {
			embedded = await pdfDoc.embedJpg(dataUrl);
		} else {
			embedded = await pdfDoc.embedPng(dataUrl);
		}
		imageCache.set(dataUrl, embedded);
	}

	const imgW = embedded.width;
	const imgH = embedded.height;
	if (imgW <= 0 || imgH <= 0) return;

	const widgets = field.acroField.getWidgets();
	for (const widget of widgets) {
		try {
			const rect = widget.getRectangle();
			const page = resolveWidgetPage(pdfDoc, pages, widget);
			if (!page || rect.width <= 0 || rect.height <= 0) continue;

			// Contain stamp within widget box, centered (same idea as free stamps)
			const scale = Math.min(rect.width / imgW, rect.height / imgH);
			const drawW = imgW * scale;
			const drawH = imgH * scale;
			const drawX = rect.x + (rect.width - drawW) / 2;
			const drawY = rect.y + (rect.height - drawH) / 2;

			page.drawImage(embedded, {
				x: drawX,
				y: drawY,
				width: drawW,
				height: drawH,
			});
		} catch (err) {
			console.warn("Failed to draw signature stamp on widget:", err);
		}
	}
}

function clampPct(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(0, n));
}

/**
 * Map a PDF user-space widget rect to CSS % on the *displayed* page
 * (top-left origin), matching pdf.js PageViewport at scale 1.
 *
 * Uses the same rotation matrix as pdf.js so AcroForm overlays stay glued
 * to the painted canvas across zoom levels and page /Rotate values.
 *
 * @param rect Widget rectangle in PDF user space (bottom-left origin)
 * @param viewX Crop/Media box origin X
 * @param viewY Crop/Media box origin Y
 * @param viewW Crop/Media box width
 * @param viewH Crop/Media box height
 * @param rotationDeg Page /Rotate in degrees (0/90/180/270)
 */
export function pdfRectToDisplayPercent(
	rect: { x: number; y: number; width: number; height: number },
	viewX: number,
	viewY: number,
	viewW: number,
	viewH: number,
	rotationDeg: number,
): { x: number; y: number; width: number; height: number } {
	if (viewW <= 0 || viewH <= 0) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const viewBox: [number, number, number, number] = [
		viewX,
		viewY,
		viewX + viewW,
		viewY + viewH,
	];
	const { transform, width: displayW, height: displayH } =
		buildPageViewportTransform(viewBox, 1, rotationDeg);

	const corners: [number, number][] = [
		[rect.x, rect.y],
		[rect.x + rect.width, rect.y],
		[rect.x, rect.y + rect.height],
		[rect.x + rect.width, rect.y + rect.height],
	];

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const [px, py] of corners) {
		const [vx, vy] = applyTransform(px, py, transform);
		if (vx < minX) minX = vx;
		if (vy < minY) minY = vy;
		if (vx > maxX) maxX = vx;
		if (vy > maxY) maxY = vy;
	}

	const w = Math.max(0, maxX - minX);
	const h = Math.max(0, maxY - minY);
	return {
		x: (minX / displayW) * 100,
		y: (minY / displayH) * 100,
		width: (w / displayW) * 100,
		height: (h / displayH) * 100,
	};
}

/** 6-number affine matrix [a,b,c,d,e,f] as used by pdf.js Util.applyTransform. */
type Affine6 = [number, number, number, number, number, number];

/**
 * Build a pdf.js-compatible PageViewport transform for the given viewBox.
 * Scale is CSS pixels per PDF unit (1 = 72dpi screen space).
 */
function buildPageViewportTransform(
	viewBox: [number, number, number, number],
	scale: number,
	rotationDeg: number,
): { transform: Affine6; width: number; height: number } {
	const centerX = (viewBox[2] + viewBox[0]) / 2;
	const centerY = (viewBox[3] + viewBox[1]) / 2;

	let rotation = rotationDeg % 360;
	if (rotation < 0) rotation += 360;

	let rotateA: number;
	let rotateB: number;
	let rotateC: number;
	let rotateD: number;
	switch (rotation) {
		case 180:
			rotateA = -1;
			rotateB = 0;
			rotateC = 0;
			rotateD = 1;
			break;
		case 90:
			rotateA = 0;
			rotateB = 1;
			rotateC = 1;
			rotateD = 0;
			break;
		case 270:
			rotateA = 0;
			rotateB = -1;
			rotateC = -1;
			rotateD = 0;
			break;
		default:
			// 0° — flip Y so PDF bottom-left becomes CSS top-left
			rotateA = 1;
			rotateB = 0;
			rotateC = 0;
			rotateD = -1;
			break;
	}

	let offsetCanvasX: number;
	let offsetCanvasY: number;
	let width: number;
	let height: number;
	if (rotateA === 0) {
		// 90 / 270 — display size swaps axes
		offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale;
		offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale;
		width = (viewBox[3] - viewBox[1]) * scale;
		height = (viewBox[2] - viewBox[0]) * scale;
	} else {
		offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale;
		offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale;
		width = (viewBox[2] - viewBox[0]) * scale;
		height = (viewBox[3] - viewBox[1]) * scale;
	}

	const transform: Affine6 = [
		rotateA * scale,
		rotateB * scale,
		rotateC * scale,
		rotateD * scale,
		offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
		offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
	];
	return { transform, width, height };
}

function applyTransform(x: number, y: number, m: Affine6): [number, number] {
	// [a b c d e f] · (x, y, 1)  →  (a*x + c*y + e, b*x + d*y + f)
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function resolveWidgetPage(
	doc: PDFDocument,
	pages: PDFPage[],
	widget: { P: () => unknown; dict: unknown },
): PDFPage | undefined {
	try {
		const pageRef = widget.P();
		if (pageRef) {
			const match = pages.find((p) => p.ref === pageRef);
			if (match) return match;
		}
	} catch {
		/* fall through */
	}
	try {
		const widgetRef = doc.context.getObjectRef(
			// pdf-lib Widget exposes dict but types omit it
			(widget as { dict: Parameters<typeof doc.context.getObjectRef>[0] }).dict,
		);
		if (widgetRef) {
			return doc.findPageForAnnotationRef(widgetRef);
		}
	} catch {
		/* ignore */
	}
	return undefined;
}
