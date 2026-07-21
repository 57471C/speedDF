import { PDFDocument, PDFHexString, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
	applyAndFlattenFormValues,
	extractFormFields,
	fieldsForPage,
	isSignatureStampValue,
} from "./formFields";

/** Minimal 1×1 red PNG (valid for pdf-lib embedPng). */
const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makeSampleFormPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([400, 300]);
	const form = doc.getForm();
	const font = await doc.embedFont(StandardFonts.Helvetica);

	const text = form.createTextField("Applicant.Name");
	text.setText("Ada");
	text.addToPage(page, { x: 40, y: 220, width: 200, height: 24, font });

	const check = form.createCheckBox("Applicant.Agree");
	check.check();
	check.addToPage(page, { x: 40, y: 180, width: 16, height: 16 });

	const drop = form.createDropdown("Applicant.Color");
	drop.addOptions(["Red", "Green", "Blue"]);
	drop.select("Green");
	drop.addToPage(page, { x: 40, y: 140, width: 120, height: 22, font });

	return doc.save();
}

/** Build a PDF with a merged field/widget Sig annotation via low-level dicts. */
async function makeSignatureFormPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([400, 300]);
	const context = doc.context;

	// Merged terminal field + widget (common for single-widget signatures).
	// T must be a PDFString/PDFHexString — plain strings in context.obj become names.
	const sigDict = context.obj({
		FT: "Sig",
		Type: "Annot",
		Subtype: "Widget",
		Rect: [40, 80, 220, 130],
		F: 4,
		P: page.ref,
	});
	sigDict.set(PDFName.of("T"), PDFHexString.fromText("Signature1"));
	const sigRef = context.register(sigDict);
	page.node.addAnnot(sigRef);

	// Ensure AcroForm exists and lists the signature field
	const form = doc.getForm();
	form.acroForm.addField(sigRef);

	// Also include a text field so mixed-form flatten stays covered
	const text = form.createTextField("NameField");
	text.setText("Ada");
	const font = await doc.embedFont(StandardFonts.Helvetica);
	text.addToPage(page, { x: 40, y: 220, width: 200, height: 24, font });

	return doc.save();
}

describe("formFields", () => {
	it("filters fields by page", () => {
		const fields = [
			{
				name: "a",
				type: "text" as const,
				pageNum: 1,
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				widgetIndex: 0,
			},
			{
				name: "b",
				type: "checkbox" as const,
				pageNum: 2,
				x: 0,
				y: 0,
				width: 5,
				height: 5,
				widgetIndex: 0,
			},
		];
		expect(fieldsForPage(fields, 1)).toHaveLength(1);
		expect(fieldsForPage(fields, 2)[0].name).toBe("b");
		expect(fieldsForPage(undefined, 1)).toEqual([]);
	});

	it("detects signature stamp data URLs", () => {
		expect(isSignatureStampValue(TINY_PNG)).toBe(true);
		expect(isSignatureStampValue("")).toBe(false);
		expect(isSignatureStampValue(true)).toBe(false);
		expect(isSignatureStampValue("hello")).toBe(false);
	});

	it("extracts text, checkbox, and dropdown fields with values", async () => {
		const bytes = await makeSampleFormPdf();
		const { fields, values } = await extractFormFields(bytes);
		expect(fields.length).toBeGreaterThanOrEqual(3);
		expect(values["Applicant.Name"]).toBe("Ada");
		expect(values["Applicant.Agree"]).toBe(true);
		expect(values["Applicant.Color"]).toBe("Green");

		const textField = fields.find((f) => f.name === "Applicant.Name");
		expect(textField?.type).toBe("text");
		expect(textField?.pageNum).toBe(1);
		expect(textField?.width).toBeGreaterThan(0);
		expect(textField?.height).toBeGreaterThan(0);
	});

	it("extracts AcroForm signature fields", async () => {
		const bytes = await makeSignatureFormPdf();
		const { fields, values } = await extractFormFields(bytes);
		const sig = fields.find((f) => f.type === "signature");
		expect(sig).toBeDefined();
		expect(sig?.name).toBe("Signature1");
		expect(sig?.pageNum).toBe(1);
		expect(sig?.width).toBeGreaterThan(0);
		expect(sig?.height).toBeGreaterThan(0);
		expect(values.Signature1).toBe("");
	});

	it("applies values and flattens without throwing", async () => {
		const bytes = await makeSampleFormPdf();
		const doc = await PDFDocument.load(bytes);
		await applyAndFlattenFormValues(doc, {
			"Applicant.Name": "Grace",
			"Applicant.Agree": false,
			"Applicant.Color": "Blue",
		});
		// After flatten, fields are removed — document still saves
		const out = await doc.save();
		expect(out.byteLength).toBeGreaterThan(100);
	});

	it("bakes signature stamp into PDF and removes the Sig field", async () => {
		const bytes = await makeSignatureFormPdf();
		const doc = await PDFDocument.load(bytes);
		await applyAndFlattenFormValues(doc, {
			NameField: "Grace",
			Signature1: TINY_PNG,
		});
		const out = await doc.save();
		expect(out.byteLength).toBeGreaterThan(100);

		// Re-load: signature field should be gone (flattened / removed)
		const reloaded = await PDFDocument.load(out);
		const remaining = reloaded.getForm().getFields();
		const stillHasSig = remaining.some((f) => {
			try {
				return f.getName() === "Signature1";
			} catch {
				return false;
			}
		});
		expect(stillHasSig).toBe(false);

		// And extractFormFields should not report the signature anymore
		const extracted = await extractFormFields(out);
		expect(extracted.fields.some((f) => f.type === "signature")).toBe(false);
	});
});
