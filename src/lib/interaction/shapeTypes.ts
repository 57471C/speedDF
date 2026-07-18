/** Drawable box-style annotation tools (drag-to-create). */
export const SHAPE_TYPES_LIST = [
	"rect",
	"round-rect",
	"oval",
	"rect-fill",
	"round-rect-fill",
	"oval-fill",
] as const;

export type BoxShapeTool = (typeof SHAPE_TYPES_LIST)[number];

export function isBoxShapeTool(tool: string | null | undefined): boolean {
	return !!tool && (SHAPE_TYPES_LIST as readonly string[]).includes(tool);
}
