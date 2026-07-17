/**
 * Session-wide drawing tool + stroke/style defaults (not per-document).
 * Document-bound side effects (selection patches, history) stay on activeDoc.
 */

export type ActiveTool =
	| "select"
	| "text"
	| "rect"
	| "tick"
	| "dash"
	| "signature"
	| "initial"
	| "highlight"
	| "rotate"
	| "round-rect"
	| "oval"
	| "rect-fill"
	| "round-rect-fill"
	| "oval-fill"
	| "pen"
	| "snapshot"
	| null;

export type ActiveLineStyle = "solid" | "dashed" | "dotted" | "dash-dot";

let activeTool = $state<ActiveTool>("select");
let activeColor = $state("#000000");
let activeThickness = $state(3);
let activeLineStyle = $state<ActiveLineStyle>("solid");

export function getActiveTool(): ActiveTool {
	return activeTool;
}

export function setActiveTool(val: ActiveTool) {
	activeTool = val;
}

export function getActiveColor(): string {
	return activeColor;
}

export function setActiveColor(val: string) {
	activeColor = val;
}

export function getActiveThickness(): number {
	return activeThickness;
}

export function setActiveThickness(val: number) {
	activeThickness = val;
}

export function getActiveLineStyle(): ActiveLineStyle {
	return activeLineStyle;
}

export function setActiveLineStyle(val: ActiveLineStyle) {
	activeLineStyle = val;
}
