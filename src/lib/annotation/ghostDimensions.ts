/**
 * Ghost/cursor preview sizes for stamp tools (signature, initial, tick, dash).
 * Reads last-resized dimensions from localStorage when present.
 */

export type GhostSize = { w: number; h: number };

const DEFAULTS: Record<string, GhostSize> = {
	signature: { w: 18, h: 8 },
	initial: { w: 6, h: 6 },
	tick: { w: 4, h: 4 },
	dash: { w: 6, h: 2 },
};

/** Typed Caveat stamps. Separate from PNG sizes so a resize does not overwrite a scan. */
const TEXT_DEFAULTS: Record<string, GhostSize> = {
	signature: { w: 32, h: 8 },
	initial: { w: 8, h: 5 },
};

/** Stamp tools that show a follow-cursor ghost preview. */
export const GHOST_STAMP_TOOLS = [
	"signature",
	"initial",
	"tick",
	"dash",
] as const;

export function getGhostDimensions(
	tool: string | null | undefined,
	opts?: { text?: boolean },
): GhostSize {
	if (!tool || !(tool in DEFAULTS)) return { w: 0, h: 0 };

	if (opts?.text && tool in TEXT_DEFAULTS) {
		const cachedWidth = localStorage.getItem(`speeddf_stamp_${tool}_text_w`);
		const cachedHeight = localStorage.getItem(`speeddf_stamp_${tool}_text_h`);
		if (cachedWidth && cachedHeight) {
			return { w: parseFloat(cachedWidth), h: parseFloat(cachedHeight) };
		}
		return TEXT_DEFAULTS[tool];
	}

	const cachedWidth = localStorage.getItem(`speeddf_stamp_${tool}_w`);
	const cachedHeight = localStorage.getItem(`speeddf_stamp_${tool}_h`);
	if (cachedWidth && cachedHeight) {
		return { w: parseFloat(cachedWidth), h: parseFloat(cachedHeight) };
	}
	return DEFAULTS[tool] ?? { w: 0, h: 0 };
}

/** Persist stamp dimensions after resize (used by drag handler). */
export function cacheStampDimensions(
	type: string,
	width: number,
	height: number,
	opts?: { text?: boolean },
): void {
	const textKey = opts?.text ? "_text" : "";
	localStorage.setItem(
		`speeddf_stamp_${type}${textKey}_w`,
		width.toString(),
	);
	localStorage.setItem(
		`speeddf_stamp_${type}${textKey}_h`,
		height.toString(),
	);
}
