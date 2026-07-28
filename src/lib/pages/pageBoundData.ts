/**
 * Pure helpers for page-bound session data when pages are reordered, deleted,
 * or rewritten via merge/insert.
 *
 * Covered: bookmarks, comments, shapes, rotations, hyperlinks, form fields.
 * Form *values* are keyed by field name (not page); they are pruned only when
 * their field definition is dropped (delete). On insert/merge only pageNum
 * on the field defs moves — values stay attached by name.
 *
 * Page identity is the 1-based number in `pageOrder` (and shape map keys).
 * After merge/blank insert the PDF is rewritten as sequential pages 1..N —
 * callers must remap every page-bound structure with the same pre/extra/post
 * slices used for thumbnails.
 */

export type PageBookmark = { pageNum: number; name: string };

/** Minimal page-bound record (bookmarks, comments, hyperlinks, form fields, …). */
export type HasPageNum = { pageNum: number };

/** Form field def surface needed for value pruning after delete. */
export type HasPageNumAndName = HasPageNum & { name: string };

/** Display position (1-based) for a page identity, or 0 if not in order. */
export function displayPagePosition(
	pageOrder: number[] | null | undefined,
	pageNum: number,
): number {
	const idx = (pageOrder || []).indexOf(pageNum);
	return idx >= 0 ? idx + 1 : 0;
}

/** Filter any pageNum-keyed list to pages still present in `pageOrder`. */
export function pruneItemsByPageOrder<T extends HasPageNum>(
	pageOrder: number[] | null | undefined,
	items: T[] | null | undefined,
): T[] {
	const keep = new Set(pageOrder || []);
	return (items || []).filter((item) => keep.has(item.pageNum));
}

/**
 * Drop page-bound session lists whose page is no longer in `pageOrder`
 * (after delete or batch delete). Also strips formValues for dropped fields.
 */
export function prunePageBoundToOrder<
	B extends HasPageNum,
	C extends HasPageNum,
	H extends HasPageNum,
	F extends HasPageNumAndName,
>(
	pageOrder: number[],
	bookmarks: B[] | null | undefined,
	comments: C[] | null | undefined,
	hyperlinks?: H[] | null,
	formFields?: F[] | null,
	formValues?: Record<string, unknown> | null,
): {
	bookmarks: B[];
	comments: C[];
	hyperlinks: H[];
	formFields: F[];
	formValues: Record<string, unknown>;
} {
	const nextBookmarks = pruneItemsByPageOrder(pageOrder, bookmarks);
	const nextComments = pruneItemsByPageOrder(pageOrder, comments);
	const nextLinks = pruneItemsByPageOrder(pageOrder, hyperlinks);
	const nextFields = pruneItemsByPageOrder(pageOrder, formFields);
	const keepNames = new Set(nextFields.map((f) => f.name));
	const prevValues = formValues || {};
	const nextValues: Record<string, unknown> = {};
	for (const [name, val] of Object.entries(prevValues)) {
		// Keep values for surviving fields; also keep orphan keys only if we
		// had no field list to compare against (defensive).
		if (formFields == null || keepNames.has(name)) {
			nextValues[name] = val;
		}
	}
	return {
		bookmarks: nextBookmarks,
		comments: nextComments,
		hyperlinks: nextLinks,
		formFields: nextFields,
		formValues: nextValues,
	};
}

/**
 * Build old-page → new sequential page map after insert/merge rewrite.
 * Same layout as thumbnail remap: pre pages, then extra blank/merged pages,
 * then post pages → new numbers 1..N.
 */
export function buildPageRemapAfterInsert(
	prePagesOrder: number[],
	extraPageCount: number,
	postPagesOrder: number[],
): Map<number, number> {
	const map = new Map<number, number>();
	let next = 1;
	for (const oldPage of prePagesOrder || []) {
		map.set(oldPage, next);
		next += 1;
	}
	next += Math.max(0, extraPageCount | 0);
	for (const oldPage of postPagesOrder || []) {
		map.set(oldPage, next);
		next += 1;
	}
	return map;
}

function mapPageNum(map: Map<number, number>, pageNum: number): number | null {
	const n = map.get(pageNum);
	return n !== undefined && n > 0 ? n : null;
}

/** Remap any `{ pageNum }` list through an old→new page map (drops unmapped). */
export function remapPageNumItems<T extends HasPageNum>(
	items: T[] | null | undefined,
	pageMap: Map<number, number>,
): T[] {
	const out: T[] = [];
	for (const item of items || []) {
		const pageNum = mapPageNum(pageMap, item.pageNum);
		if (pageNum == null) continue;
		out.push({ ...item, pageNum });
	}
	return out;
}

/** Remap bookmarks through an old→new page map (drops unmapped). */
export function remapBookmarksAfterInsert<B extends HasPageNum>(
	bookmarks: B[] | null | undefined,
	pageMap: Map<number, number>,
): B[] {
	return remapPageNumItems(bookmarks, pageMap);
}

/** Remap comments through an old→new page map (drops unmapped). */
export function remapCommentsAfterInsert<C extends HasPageNum>(
	comments: C[] | null | undefined,
	pageMap: Map<number, number>,
): C[] {
	return remapPageNumItems(comments, pageMap);
}

/** Remap hyperlinks through an old→new page map (drops unmapped). */
export function remapHyperlinksAfterInsert<H extends HasPageNum>(
	hyperlinks: H[] | null | undefined,
	pageMap: Map<number, number>,
): H[] {
	return remapPageNumItems(hyperlinks, pageMap);
}

/** Remap form field defs through an old→new page map (drops unmapped). */
export function remapFormFieldsAfterInsert<F extends HasPageNum>(
	formFields: F[] | null | undefined,
	pageMap: Map<number, number>,
): F[] {
	return remapPageNumItems(formFields, pageMap);
}

/** Remap shape map keys (1-based page numbers) through an old→new page map. */
export function remapShapesAfterInsert<T>(
	shapes: Record<number, T[]> | null | undefined,
	pageMap: Map<number, number>,
): Record<number, T[]> {
	const next: Record<number, T[]> = {};
	for (const [key, list] of Object.entries(shapes || {})) {
		const oldPage = Number(key);
		if (!Number.isFinite(oldPage)) continue;
		const newPage = mapPageNum(pageMap, oldPage);
		if (newPage == null || !list) continue;
		next[newPage] = list;
	}
	return next;
}

/** Remap rotation map keys through an old→new page map. */
export function remapRotationsAfterInsert(
	rotations: Record<number, number> | null | undefined,
	pageMap: Map<number, number>,
): Record<number, number> {
	const next: Record<number, number> = {};
	for (const [key, deg] of Object.entries(rotations || {})) {
		const oldPage = Number(key);
		if (!Number.isFinite(oldPage)) continue;
		const newPage = mapPageNum(pageMap, oldPage);
		if (newPage == null) continue;
		next[newPage] = deg;
	}
	return next;
}

/**
 * Full session remap after merge / blank insert rewrites rawBytes as pages 1..N.
 * formValues are returned unchanged (keyed by field name, not page).
 */
export function remapSessionAfterPageInsert<
	B extends HasPageNum,
	C extends HasPageNum,
	S,
	H extends HasPageNum = HasPageNum,
	F extends HasPageNum = HasPageNum,
>(opts: {
	prePagesOrder: number[];
	extraPageCount: number;
	postPagesOrder: number[];
	bookmarks: B[] | null | undefined;
	comments: C[] | null | undefined;
	shapes: Record<number, S[]> | null | undefined;
	rotations: Record<number, number> | null | undefined;
	currentPage: number;
	hyperlinks?: H[] | null;
	formFields?: F[] | null;
	/** Passed through unchanged (name-keyed, not page-keyed). */
	formValues?: Record<string, unknown> | null;
}): {
	bookmarks: B[];
	comments: C[];
	shapes: Record<number, S[]>;
	rotations: Record<number, number>;
	currentPage: number;
	hyperlinks: H[];
	formFields: F[];
	formValues: Record<string, unknown>;
} {
	const pageMap = buildPageRemapAfterInsert(
		opts.prePagesOrder,
		opts.extraPageCount,
		opts.postPagesOrder,
	);
	const currentPage = mapPageNum(pageMap, opts.currentPage) ?? 1;
	return {
		bookmarks: remapBookmarksAfterInsert(opts.bookmarks, pageMap),
		comments: remapCommentsAfterInsert(opts.comments, pageMap),
		shapes: remapShapesAfterInsert(opts.shapes, pageMap),
		rotations: remapRotationsAfterInsert(opts.rotations, pageMap),
		currentPage,
		hyperlinks: remapHyperlinksAfterInsert(opts.hyperlinks, pageMap),
		formFields: remapFormFieldsAfterInsert(opts.formFields, pageMap),
		formValues: { ...(opts.formValues || {}) },
	};
}
