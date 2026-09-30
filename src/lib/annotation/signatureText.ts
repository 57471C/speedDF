/**
 * Typed signature / initials (Caveat). Image scans stay on the same set.
 */

import { signatureSetLabel } from "../comments/comments";
import type { SignatureSet } from "../../pdfStore.svelte";

export const CAVEAT_FAMILY = "Caveat";
/** Dark ink for typed stamps. Not a toolbar colour. */
export const SIGNATURE_INK = "#1a1a1a";

/** First letters of a typed name. "Terry Minett" → "TM". Max 4. */
export function initialsFromTypedName(name: string): string {
	const words = (name || "").trim().split(/\s+/).filter(Boolean);
	let letters = "";
	for (const word of words) {
		const ch = word.charAt(0).toUpperCase();
		if (ch >= "A" && ch <= "Z") letters += ch;
		if (letters.length >= 4) break;
	}
	return letters.slice(0, 4);
}

export function splitTypedName(name: string): {
	firstName: string;
	lastName: string;
} {
	const parts = (name || "").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { firstName: "", lastName: "" };
	if (parts.length === 1) return { firstName: parts[0], lastName: "" };
	return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** True when any pixel in ImageData is non-transparent. */
export function imageDataHasInk(data: Uint8ClampedArray): boolean {
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 0) return true;
	}
	return false;
}

export function isCaveatTextStamp(
	shape:
		| {
				type?: string;
				text?: string;
				fontFamily?: string;
				dataUrl?: string;
		  }
		| null
		| undefined,
): boolean {
	if (!shape) return false;
	if (shape.type !== "signature" && shape.type !== "initial") return false;
	if (shape.dataUrl) return false;
	if (shape.fontFamily !== CAVEAT_FAMILY) return false;
	return !!(shape.text && shape.text.trim());
}

export interface BuildSignatureSetInput {
	id: string;
	existing?: SignatureSet | null;
	signatureText?: string;
	initials?: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	/** Pass only when the signature canvas has new ink. */
	drawnSignatureDataUrl?: string | null;
	/** Pass only when the initials canvas has new ink. */
	drawnInitialDataUrl?: string | null;
}

/**
 * Merge a typed name onto a signature set.
 * A saved scan is kept unless a new drawn data URL is passed.
 */
export function buildSignatureSet(input: BuildSignatureSetInput): SignatureSet {
	const text = (input.signatureText || "").trim();
	const split = text ? splitTypedName(text) : { firstName: "", lastName: "" };
	const firstName = (
		input.firstName ??
		(text ? split.firstName : input.existing?.firstName) ??
		""
	).trim();
	const lastName = (
		input.lastName ??
		(text ? split.lastName : input.existing?.lastName) ??
		""
	).trim();
	const initialsRaw =
		input.initials !== undefined
			? input.initials.trim()
			: text
				? initialsFromTypedName(text)
				: (input.existing?.initials || "").trim();
	const initials = initialsRaw.slice(0, 4);
	const signatureDataUrl = input.drawnSignatureDataUrl
		? input.drawnSignatureDataUrl
		: input.existing?.signatureDataUrl || "";
	const initialDataUrl = input.drawnInitialDataUrl
		? input.drawnInitialDataUrl
		: input.existing?.initialDataUrl || "";
	const email =
		input.email !== undefined
			? input.email.trim() || undefined
			: input.existing?.email;

	return {
		id: input.id,
		signatureDataUrl,
		initialDataUrl,
		firstName: firstName || undefined,
		lastName: lastName || undefined,
		email,
		label: signatureSetLabel(firstName, lastName),
		initials: initials || undefined,
		signatureText: text || undefined,
	};
}
