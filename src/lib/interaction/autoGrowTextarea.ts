/**
 * Svelte action: grow a textarea's height downward with its content.
 * Uses scrollHeight so new lines expand the box instead of scrolling content up.
 */

export type AutoGrowOptions = {
	/** Minimum rows worth of height (default 2). */
	minRows?: number;
	/** Cap growth; scroll after this many rows (default 12). */
	maxRows?: number;
};

function measureLineHeight(node: HTMLTextAreaElement): number {
	const cs = getComputedStyle(node);
	const lh = parseFloat(cs.lineHeight);
	if (Number.isFinite(lh) && lh > 0) return lh;
	const fs = parseFloat(cs.fontSize);
	return Number.isFinite(fs) && fs > 0 ? fs * 1.4 : 14;
}

function verticalPad(node: HTMLTextAreaElement): number {
	const cs = getComputedStyle(node);
	return (
		(parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
	);
}

export function autoGrowTextarea(
	node: HTMLTextAreaElement,
	opts: AutoGrowOptions = {},
) {
	let minRows = opts.minRows ?? 2;
	let maxRows = opts.maxRows ?? 12;

	function resize() {
		const line = measureLineHeight(node);
		const pad = verticalPad(node);
		const minH = line * minRows + pad;
		const maxH = line * maxRows + pad;

		// Collapse first so scrollHeight reflects content (grows downward from top)
		node.style.height = "0px";
		node.style.overflowY = "hidden";
		const needed = Math.max(node.scrollHeight, minH);
		const next = Math.min(maxH, needed);
		node.style.height = `${next}px`;
		node.style.overflowY = needed > maxH ? "auto" : "hidden";
	}

	const onInput = () => resize();
	node.addEventListener("input", onInput);

	// Initial size after layout / bind:value
	requestAnimationFrame(resize);

	return {
		update(nextOpts: AutoGrowOptions = {}) {
			minRows = nextOpts.minRows ?? 2;
			maxRows = nextOpts.maxRows ?? 12;
			resize();
		},
		destroy() {
			node.removeEventListener("input", onInput);
		},
	};
}
