/** SVG stroke-dasharray presets for annotation line styles. */
export const STROKE_DASHARRAYS = {
	solid: "none",
	dashed: "6,6",
	dotted: "2,4",
	"dash-dot": "6,3,2,3",
} as const;

export type StrokeDashStyle = keyof typeof STROKE_DASHARRAYS;
