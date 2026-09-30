/**
 * Typed signature / initials (Caveat). Image scans stay on the same set.
 */

import { signatureSetLabel } from "../comments/comments";
import type { SignatureSet } from "../../pdfStore.svelte";

export const CAVEAT_FAMILY = "Caveat";
/** Dark ink for typed stamps. Not a toolbar colour. */
export const SIGNATURE_INK = "#1a1a1a";

function collapseSpaces(value: string): string {
	return (value || "").trim().replace(/\s+/g, " ");
}

/** Profile line used when Written as is empty. "Terry" + "Minett" → "Terry Minett". */
export function caveatStringFromName(firstName: string, lastName: string): string {
	return collapseSpaces(`${firstName || ""} ${lastName || ""}`);
}

/**
 * Caveat stamp string. A non-empty Written as replaces the line only.
 * Empty or whitespace uses First Last.
 */
export function resolveCaveatString(
	firstName: string,
	lastName: string,
	writtenAs?: string,
): string {
	const override = collapseSpaces(writtenAs || "");
	return override || caveatStringFromName(firstName, lastName);
}

/** First letter of first name + first letter of last name. Uppercase A–Z. */
export function initialsFromIdentity(firstName: string, lastName: string): string {
	const a = (firstName || "").trim().charAt(0).toUpperCase();
	const b = (lastName || "").trim().charAt(0).toUpperCase();
	let letters = "";
	if (a >= "A" && a <= "Z") letters += a;
	if (b >= "A" && b <= "Z") letters += b;
	return letters;
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
 * Merge profile identity and an optional Written-as line onto a signature set.
 * Identity stays on firstName / lastName. signatureText is the Caveat line:
 * a non-empty signatureText (Written as) wins, otherwise First Last.
 * A saved scan is kept unless a new drawn data URL is passed.
 */
export function buildSignatureSet(input: BuildSignatureSetInput): SignatureSet {
	const firstName = (input.firstName ?? input.existing?.firstName ?? "").trim();
	const lastName = (input.lastName ?? input.existing?.lastName ?? "").trim();
	const text =
		collapseSpaces(input.signatureText || "") ||
		caveatStringFromName(firstName, lastName);
	const initialsRaw =
		input.initials !== undefined
			? input.initials.trim()
			: initialsFromIdentity(firstName, lastName) ||
				(input.existing?.initials || "").trim();
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
