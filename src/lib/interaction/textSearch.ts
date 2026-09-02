/**
 * Pure helpers for Ctrl+F full-document text search + DOM highlight mapping.
 * Indexing scans pdf.js text items; painting maps occurrences onto text-layer spans.
 */

export type TextSearchMatch = {
	pageNumber: number;
	/** 0-based occurrence index among matches on this page (item-local scan order). */
	occurrenceOnPage: number;
	/** Optional live DOM node for the painted <mark> (bound after highlight). */
	element?: HTMLElement | null;
};

/** Escape a user query for safe RegExp use. */
export function escapeRegExp(query: string): string {
	return query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Global regex that captures each match (for split-based highlight painting). */
export function buildSearchRegex(query: string, caseSensitive: boolean): RegExp {
	const flags = caseSensitive ? "g" : "gi";
	return new RegExp(`(${escapeRegExp(query)})`, flags);
}

/** Non-global test regex (avoids lastIndex side-effects). */
export function buildSearchTestRegex(
	query: string,
	caseSensitive: boolean,
): RegExp {
	return new RegExp(escapeRegExp(query), caseSensitive ? "" : "i");
}

/**
 * Count every non-overlapping match of `query` inside a single text string.
 * Used both for full-doc indexing (per pdf.js text item) and for DOM spans.
 */
export function countMatchesInString(
	text: string,
	query: string,
	caseSensitive: boolean,
): number {
	if (!query || !text) return 0;
	const regex = buildSearchRegex(query, caseSensitive);
	let count = 0;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(text)) !== null) {
		count += 1;
		if (m[0].length === 0) {
			regex.lastIndex += 1;
		}
	}
	return count;
}

/**
 * Build a full-document match list from pdf.js-style text items per page.
 *
 * Matches are counted **per text item string** (not a space-joined page blob)
 * so occurrence indices line up with DOM text-layer spans (one span ≈ one item).
 */
export function collectMatchesFromPageItems(
	pageNumber: number,
	items: ReadonlyArray<{ str?: string } | string | null | undefined>,
	query: string,
	caseSensitive: boolean,
): TextSearchMatch[] {
	if (!query) return [];
	const matches: TextSearchMatch[] = [];
	let occurrenceOnPage = 0;

	for (const raw of items || []) {
		const str =
			typeof raw === "string"
				? raw
				: raw && typeof raw === "object" && typeof raw.str === "string"
					? raw.str
					: "";
		if (!str) continue;
		const n = countMatchesInString(str, query, caseSensitive);
		for (let i = 0; i < n; i++) {
			matches.push({
				pageNumber,
				occurrenceOnPage,
				element: null,
			});
			occurrenceOnPage += 1;
		}
	}
	return matches;
}

/** Escape text for safe insertion into highlight HTML. */
export function escapeHtml(str: string): string {
	return str.replace(/[&<>"']/g, (ch) => {
		const map: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return map[ch] || ch;
	});
}

export type HighlightPaintResult = {
	/** Number of <mark> elements painted on the page. */
	paintedCount: number;
	/** The mark element for the requested occurrence, if found. */
	currentMark: HTMLElement | null;
};

/**
 * Paint yellow marks for every query hit in a page's text-layer spans.
 * Marks the `targetOccurrence` (page-local) with a stronger current class.
 *
 * Returns the current mark element so callers can scroll it into view.
 */
export function paintSearchHighlightsOnRoot(
	pageRoot: HTMLElement,
	query: string,
	caseSensitive: boolean,
	targetOccurrence: number | null,
	originalSpansMap: Map<HTMLElement, string>,
): HighlightPaintResult {
	if (!query) {
		return { paintedCount: 0, currentMark: null };
	}

	const spans = pageRoot.querySelectorAll(".textLayer span");
	const paintRe = buildSearchRegex(query, caseSensitive);
	const testRe = buildSearchTestRegex(query, caseSensitive);

	let occurrenceOnPage = 0;
	let currentMark: HTMLElement | null = null;

	spans.forEach((span) => {
		const el = span as HTMLElement;
		// Prefer cached original so re-paints after clear don't double-wrap
		const originalText = originalSpansMap.has(el)
			? (originalSpansMap.get(el) as string)
			: el.textContent || "";
		if (!originalText || !testRe.test(originalText)) return;

		if (!originalSpansMap.has(el)) {
			originalSpansMap.set(el, originalText);
		}

		// Reset lastIndex after .test on a potentially sticky regex
		testRe.lastIndex = 0;

		const parts = originalText.split(paintRe);
		el.textContent = "";
		for (let i = 0; i < parts.length; i++) {
			if (i % 2 === 0) {
				if (parts[i]) {
					el.appendChild(document.createTextNode(parts[i]));
				}
			} else {
				const isCurrent =
					targetOccurrence != null && occurrenceOnPage === targetOccurrence;
				const cls = isCurrent
					? "sdf-search-hit sdf-search-hit-current"
					: "sdf-search-hit";
				const mark = document.createElement("mark");
				mark.className = cls;
				mark.setAttribute("data-sdf-search-occ", String(occurrenceOnPage));
				mark.appendChild(document.createTextNode(parts[i]));
				el.appendChild(mark);
				occurrenceOnPage += 1;
			}
		}
	});

	if (targetOccurrence != null) {
		const found = pageRoot.querySelector(
			`mark.sdf-search-hit[data-sdf-search-occ="${targetOccurrence}"]`,
		) as HTMLElement | null;
		currentMark = found;
	}

	return { paintedCount: occurrenceOnPage, currentMark };
}
