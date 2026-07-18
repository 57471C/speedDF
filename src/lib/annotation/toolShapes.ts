/**
 * Pure factories for tool-created annotation shapes.
 * No store ownership — callers commit shapes to activeDoc.
 */

import type { AnnotationShape } from "../../pdfStore.svelte";
import { getGhostDimensions } from "./ghostDimensions";

export function createSignatureOrInitialShape(
	toolType: "signature" | "initial",
	mousePctX: number,
	mousePctY: number,
	opts: {
		ghostW: number;
		ghostH: number;
		dataUrl: string | null | undefined;
	},
): AnnotationShape {
	return {
		type: toolType,
		x: mousePctX - opts.ghostW / 2,
		y: mousePctY - opts.ghostH / 2,
		width: opts.ghostW,
		height: opts.ghostH,
		dataUrl: opts.dataUrl ?? undefined,
	};
}

export function createTickOrDashShape(
	toolType: "tick" | "dash",
	mousePctX: number,
	mousePctY: number,
	color: string,
): AnnotationShape {
	const dims = getGhostDimensions(toolType);
	return {
		type: toolType,
		x: mousePctX - dims.w / 2,
		y: mousePctY - dims.h / 2,
		width: dims.w,
		height: dims.h,
		color,
	};
}

export function createTextShape(
	mousePctX: number,
	mousePctY: number,
	opts: {
		fontFamily: AnnotationShape["fontFamily"] | string | undefined;
		size: number | undefined;
		style: AnnotationShape["style"] | string | undefined;
		color: string;
	},
): AnnotationShape {
	return {
		type: "text",
		x: mousePctX,
		y: mousePctY,
		text: "",
		font: opts.fontFamily as AnnotationShape["font"],
		fontFamily: opts.fontFamily as AnnotationShape["fontFamily"],
		size: opts.size,
		style: (opts.style as AnnotationShape["style"]) || "Normal",
		color: opts.color,
		textColor: opts.color,
	};
}

export function createBoxShape(
	toolType: AnnotationShape["type"],
	startPct: { x: number; y: number },
	endPct: { x: number; y: number },
	opts: {
		color: string;
		thickness: number;
		lineStyle: AnnotationShape["lineStyle"];
	},
): AnnotationShape {
	return {
		type: toolType,
		x: Math.min(startPct.x, endPct.x),
		y: Math.min(startPct.y, endPct.y),
		width: Math.abs(endPct.x - startPct.x),
		height: Math.abs(endPct.y - startPct.y),
		color: opts.color,
		thickness: opts.thickness,
		lineStyle: opts.lineStyle,
	};
}

export function createFreehandShape(
	toolType: "highlight" | "pen",
	points: { x: number; y: number }[],
	opts: { color: string; thickness: number },
): AnnotationShape {
	return {
		type: toolType,
		x: points[0].x,
		y: points[0].y,
		points: [...points],
		color: opts.color,
		thickness: opts.thickness,
	};
}

/** True when page has an empty draft text box that should be cleared before placing another. */
export function hasEmptyTextDraft(
	shapes: AnnotationShape[] | undefined,
): boolean {
	return (shapes || []).some(
		(s) =>
			s && s.type === "text" && (!s.text || s.text.trim().length === 0),
	);
}

export function withoutEmptyTextDrafts(
	shapes: AnnotationShape[],
): AnnotationShape[] {
	return shapes.filter(
		(s) =>
			!(s && s.type === "text" && (!s.text || s.text.trim().length === 0)),
	);
}
