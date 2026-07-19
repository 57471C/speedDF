import {
	patchSelectedShapes,
	selectionNeedsPropertyUpdate,
} from "./lib/annotation/shapeHelpers";
import type { PageComment } from "./lib/comments/comments";
import {
	createCommentId,
	getCommentAuthor,
	getCommentAuthorFullName,
	sanitizeCommentText,
	setCommentAuthorProfile,
} from "./lib/comments/comments";
import {
	bindHistoryDocument,
	executeRedoAction,
	executeUndoAction,
	pushHistorySnapshot,
	redoStack,
	undoStack,
} from "./lib/stores/history.svelte";
import {
	type ActiveLineStyle,
	type ActiveTool,
	getActiveColor,
	getActiveLineStyle,
	getActiveThickness,
	getActiveTool,
	setActiveColor,
	setActiveLineStyle,
	setActiveThickness,
	setActiveTool,
} from "./lib/stores/tools.svelte";

export type { CommentReply, PageComment } from "./lib/comments/comments";

/** Avoid importing the name `PDFWorker` (clashes with pdfjs-dist's class export in some tooling). */
type PdfJsWorker = InstanceType<typeof import("pdfjs-dist")["PDFWorker"]>;

// Re-export tool types for consumers that want them without deep imports.
export type { ActiveLineStyle, ActiveTool };
// Re-export history API so existing `from "../pdfStore.svelte"` imports keep working.
export {
	executeRedoAction,
	executeUndoAction,
	pushHistorySnapshot,
	redoStack,
	undoStack,
};

export interface TextShape {
	id: string;
	type: "text";
	text: string;
	x: number;
	y: number;
	fontSize: number;
	fontFamily:
		| "Helvetica"
		| "Times-Roman"
		| "Courier"
		| "Inter"
		| "JetBrainsMono";
	color: string;
	opacity: number;
	alignment?: "left" | "center" | "right";
}

export interface RecentFile {
	name: string;
	path: string;
	timestamp: number;
	thumbnail: string;
	orientation?: string;
	lastOpened?: number;
}

export interface AnnotationShape {
	type:
		| "rect"
		| "text"
		| "tick"
		| "dash"
		| "signature"
		| "initial"
		| "highlight"
		| "round-rect"
		| "oval"
		| "rect-fill"
		| "round-rect-fill"
		| "oval-fill"
		| "pen";
	x: number; // Percentage coordinate left (0-100)
	y: number; // Percentage coordinate top (0-100)
	width?: number; // Percentage width layout bounds
	height?: number; // Percentage height layout bounds
	text?: string; // Text payload string (for text boxes)
	dataUrl?: string; // Base64 PNG image stream string (for signatures)
	points?: { x: number; y: number }[]; // Array of percentage nodes tracking freehand highlighters
	color?: string; // Captures the unique hexadecimal ink value
	textColor?: string; // Captures the custom text color
	thickness?: number;
	font?: string; // Custom font family name
	size?: number; // Custom font size in points
	style?: "Normal" | "Bold" | "Italic"; // Font style variant
	lineStyle?: "solid" | "dashed" | "dotted" | "dash-dot";
	fontFamily?:
		| "Helvetica"
		| "Times-Roman"
		| "Courier"
		| "Inter"
		| "JetBrainsMono";
	alignment?: "left" | "center" | "right";
}

export interface Bookmark {
	pageNum: number;
	name: string;
}

export interface DocumentWorkspace {
	fileType: "pdf" | "tiff" | "image" | null;
	fileName: string;
	filePath: string | null;
	rawBytes: Uint8Array | null;
	pageCount: number;
	pageOrder: number[];
	currentPage: number;
	shapes: Record<number, AnnotationShape[]>;
	bookmarks: Bookmark[];
	/** Per-page threaded comments (document-scoped; not shared across tabs). */
	comments: PageComment[];
	imageRotation?: number;
	imageUrl?: string | null;
	isDirty: boolean;
	tiffPages: Uint8Array[];
	rotations: Record<number, number>;
	cachedDimensions?: { width: number; height: number }[];
	/** Per-document sidebar/save thumbnail overrides (not shared across open tabs). */
	pageThumbnailOverrides?: Record<number, string>;
}

export interface SignatureSet {
	id: string;
	signatureDataUrl: string;
	initialDataUrl: string;
	/** Profile first name (optional on legacy sets). */
	firstName?: string;
	/** Profile last name (optional on legacy sets). */
	lastName?: string;
	/** Optional contact for future signature-use notifications. */
	email?: string;
	/** Display label e.g. "Terry Minett:" */
	label?: string;
	/** Short initials e.g. "TM" — also used as comment author badge. */
	initials?: string;
}

export interface SharedDocumentState {
	rawBytes: Uint8Array | null;
	pageCount: number;
	currentPage: number;
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	isClickScrolling: boolean;
	rotations: Record<number, number>;
	activeTool: ActiveTool;
	shapes: Record<number, AnnotationShape[]>;
	selectedShape: { pageNumber: number; index: number } | null;
	selectedShapes: { pageNumber: number; index: number }[];
	savedSignatureSets: SignatureSet[];
	activeStampDataUrl: string | null;
	pageOrder: number[];
	fileName: string | null;
	filePath: string | null;
	activeColor: string;
	activeThickness: number;
	activeLineStyle: ActiveLineStyle;
	activeFontFamily:
		| "Helvetica"
		| "Times-Roman"
		| "Courier"
		| "Inter"
		| "JetBrainsMono";
	activeTextAlignment: "left" | "center" | "right";
	zoomScale: number;
	defaultFont: string;
	defaultSize: number;
	defaultStyle: "Normal" | "Bold" | "Italic";
	fileType: "pdf" | "tiff" | "image" | null;
	imageUrl?: string | null;
	imageRotation?: number;
	tiffPages: Uint8Array[];
	flushDocumentState(): void;
	isDirty: boolean;
	bookmarks: Bookmark[];
	comments: PageComment[];
	openDocuments: DocumentWorkspace[];
	activeDocumentId: string | null;
	readonly current: DocumentWorkspace | null;
	recents: RecentFile[];
	thumbnailVersion: number;
	pageThumbnailOverrides: Record<number, string>;
	/**
	 * Session UI signal: when set, PageSidebar switches to the comments tab
	 * and focuses this page number. Consumed (cleared) by the sidebar.
	 */
	commentsFocusRequest: number | null;
	/**
	 * Session UI: true while the active document is being flattened/written.
	 * Blocks workspace edits so the dirty flag cannot flip during save lag.
	 */
	isSaving: boolean;
	updateRecentThumbnail(filePath: string, thumbnailDataUrl: string): void;
}

export const FONT_MAP: Record<
	string,
	{
		css: string;
		pdf: {
			Normal: string;
			Bold: string;
			Italic: string;
		};
	}
> = {
	Helvetica: {
		css: "Helvetica, Arial, sans-serif",
		pdf: {
			Normal: "Helvetica",
			Bold: "Helvetica-Bold",
			Italic: "Helvetica-Oblique",
		},
	},
	"Times New Roman": {
		css: "'Times New Roman', Times, serif",
		pdf: {
			Normal: "Times-Roman",
			Bold: "Times-Bold",
			Italic: "Times-Italic",
		},
	},
	"Times-Roman": {
		css: "'Times New Roman', Times, serif",
		pdf: {
			Normal: "Times-Roman",
			Bold: "Times-Bold",
			Italic: "Times-Italic",
		},
	},
	Courier: {
		css: "'Courier New', Courier, monospace",
		pdf: {
			Normal: "Courier",
			Bold: "Courier-Bold",
			Italic: "Courier-Oblique",
		},
	},
	Inter: {
		css: "Inter, sans-serif",
		pdf: {
			Normal: "Inter-Regular",
			Bold: "Inter-Bold",
			Italic: "Inter-Italic",
		},
	},
	JetBrainsMono: {
		css: "'JetBrains Mono', monospace",
		pdf: {
			Normal: "JetBrainsMono-Regular",
			Bold: "JetBrainsMono-Bold",
			Italic: "JetBrainsMono-Italic",
		},
	},
};

export const loadSavedSets = (): SignatureSet[] => {
	try {
		const raw = localStorage.getItem("speeddf_signature_sets");
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
};

let openDocuments = $state<DocumentWorkspace[]>([]);
let activeDocumentId = $state<string | null>(null);

let selectedShape = $state<SharedDocumentState["selectedShape"]>(null);
let selectedShapes = $state<SharedDocumentState["selectedShapes"]>([]);
let activeFontFamily = $state<
	"Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono"
>("Helvetica");
let activeTextAlignment = $state<"left" | "center" | "right">("left");
let zoomScale = $state(120);
let defaultFont = $state("Helvetica");
let defaultSize = $state(12);
let defaultStyle = $state<"Normal" | "Bold" | "Italic">("Normal");
let scrollTop = $state(0);
let scrollHeight = $state(0);
let clientHeight = $state(0);
let isClickScrolling = $state(false);
let activeStampDataUrl = $state<string | null>(null);
let savedSignatureSets = $state<SignatureSet[]>(loadSavedSets());

function loadRecents(): RecentFile[] {
	try {
		const stored = localStorage.getItem("speeddf_recents");
		if (stored) return JSON.parse(stored);
	} catch {
		/* ignore corrupt recents JSON */
	}
	return [];
}
let recents = $state<RecentFile[]>(loadRecents());
let thumbnailVersion = $state(0);
/** Session-only: ask PageSidebar to open the comments tab for a page. */
let commentsFocusRequest = $state<number | null>(null);
/** Session-only: workspace is locked while save/flatten runs. */
let isSaving = $state(false);

function findOpenDocument(id: string | null | undefined): DocumentWorkspace | null {
	if (!id) return null;
	return (
		openDocuments.find((d) => d.filePath === id || d.fileName === id) || null
	);
}

/**
 * Clear selection + undo/redo when switching or closing documents so history
 * never crosses document boundaries.
 */
function resetSessionUiForDocumentSwitch() {
	selectedShape = null;
	selectedShapes = [];
	undoStack.length = 0;
	redoStack.length = 0;
}

/**
 * Post-save thumbnail broadcast:
 * 1) write page-0 override map on the matching open document
 * 2) bump thumbnailVersion so `use:renderThumbnail` / $effect re-run
 * 3) Svelte 5-safe recents array reassignment for Recent Documents cards
 */
export function applyLiveThumbnail(
	thumbnailDataUrl: string,
	filePath?: string | null,
	pageIndex = 0,
) {
	const target =
		(filePath ? findOpenDocument(filePath) : null) ||
		findOpenDocument(activeDocumentId);
	if (target) {
		target.pageThumbnailOverrides = {
			...(target.pageThumbnailOverrides || {}),
			[pageIndex]: thumbnailDataUrl,
		};
		// Ensure array consumers re-read nested mutation
		openDocuments = [...openDocuments];
	}
	if (filePath) {
		// Bumps thumbnailVersion + updates recents/localStorage
		updateRecentThumbnail(filePath, thumbnailDataUrl);
	} else {
		// No recents path — still invalidate sidebar canvases
		thumbnailVersion += 1;
	}
}

function documentKey(d: DocumentWorkspace): string {
	return d.filePath || d.fileName;
}

/** Switch the active workspace tab. */
export function switchActiveDocument(id: string) {
	if (!id || activeDocumentId === id) return;
	if (!findOpenDocument(id)) return;
	activeDocumentId = id;
	resetSessionUiForDocumentSwitch();
}

/**
 * Cycle active tab (Ctrl+Tab / Ctrl+Shift+Tab).
 * @param direction +1 next, -1 previous
 */
export function cycleActiveDocument(direction: 1 | -1) {
	if (openDocuments.length < 2) return;
	const ids = openDocuments.map(documentKey);
	const current = Math.max(
		0,
		ids.findIndex(
			(id) => id === activeDocumentId,
		),
	);
	const next =
		(current + direction + openDocuments.length) % openDocuments.length;
	switchActiveDocument(ids[next]);
}

/**
 * Drag-reorder open document tabs. Indices are positions in `openDocuments`.
 */
export function reorderOpenDocuments(fromIndex: number, toIndex: number) {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= openDocuments.length ||
		toIndex >= openDocuments.length
	) {
		return;
	}
	const next = [...openDocuments];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	openDocuments = next;
}

/**
 * Close one open document by id (path or fileName).
 * Does not prompt — caller handles dirty confirmation.
 */
export function closeDocumentWorkspace(id: string) {
	const doc = findOpenDocument(id);
	if (!doc) return;

	if (doc.imageUrl) {
		try {
			URL.revokeObjectURL(doc.imageUrl);
		} catch {
			/* ignore */
		}
	}

	const wasActive =
		activeDocumentId === doc.filePath || activeDocumentId === doc.fileName;

	openDocuments = openDocuments.filter(
		(d) => d.filePath !== id && d.fileName !== id && d !== doc,
	);

	if (wasActive) {
		activeDocumentId =
			openDocuments[0]?.filePath || openDocuments[0]?.fileName || null;
		resetSessionUiForDocumentSwitch();
	}
}

/**
 * Close every open document without dirty prompts (caller must confirm first).
 */
export function closeAllDocumentWorkspaces() {
	// Copy first — closeDocumentWorkspace mutates the array
	const ids = openDocuments.map(documentKey);
	for (const id of ids) {
		const doc = findOpenDocument(id);
		if (doc) doc.isDirty = false;
		closeDocumentWorkspace(id);
	}
}

/**
 * Update Recent Documents entry + localStorage. Always bumps thumbnailVersion
 * so PageSidebar redraws even when the path is not (yet) in the recents list.
 */
export function updateRecentThumbnail(
	filePath: string,
	thumbnailDataUrl: string,
) {
	try {
		// Invalidate navigation thumbnails (renderThumbnail action + ThumbnailCanvas $effect)
		thumbnailVersion += 1;

		if (Array.isArray(recents)) {
			const targetIndex = recents.findIndex(
				(item: RecentFile) =>
					item.path === filePath ||
					(item.path &&
						filePath &&
						item.path.toLowerCase() === filePath.toLowerCase()),
			);
			if (targetIndex !== -1) {
				// 1. Replace the slot with a new object reference
				// 2. Reassign the array pointer for Svelte 5 list reactivity
				const next = [...recents];
				next[targetIndex] = {
					...next[targetIndex],
					thumbnail: thumbnailDataUrl,
					lastOpened: Date.now(),
					timestamp: Date.now(),
				};
				recents = next;
				console.log(
					`🚀 Reactive store array reassigned. Thumbnail version bumped to: ${thumbnailVersion}`,
				);
			}
		}

		// Mirror updates cleanly down to localStorage persistence sync
		const globalRecentsRaw = localStorage.getItem("speeddf_recents");
		if (globalRecentsRaw) {
			let recentsList = JSON.parse(globalRecentsRaw);
			if (Array.isArray(recentsList)) {
				const dbIndex = recentsList.findIndex(
					(item: RecentFile) =>
						item.path === filePath ||
						(item.path &&
							filePath &&
							item.path.toLowerCase() === filePath.toLowerCase()),
				);
				if (dbIndex !== -1) {
					recentsList[dbIndex].thumbnail = thumbnailDataUrl;
					recentsList[dbIndex].lastOpened = Date.now();
					recentsList[dbIndex].timestamp = Date.now();
					localStorage.setItem("speeddf_recents", JSON.stringify(recentsList));
					console.log("🚀 Persistent localStorage dashboard sync verified.");
				}
			}
		}
	} catch (err) {
		console.warn("Failed to update central dashboard thumbnail arrays:", err);
	}
}

export function initializeNewDocument(
	fileName: string,
	filePath: string | null,
) {
	const existing = openDocuments.find(
		(d) => (filePath && d.filePath === filePath) || d.fileName === fileName,
	);
	if (existing) {
		const nextId = existing.filePath || existing.fileName;
		if (activeDocumentId !== nextId) {
			activeDocumentId = nextId;
			resetSessionUiForDocumentSwitch();
		}
		return existing;
	}

	const newDoc: DocumentWorkspace = {
		fileType: null,
		fileName: fileName,
		filePath: filePath,
		rawBytes: null,
		pageCount: 0,
		pageOrder: [],
		currentPage: 1,
		shapes: {},
		bookmarks: [],
		comments: [],
		imageRotation: 0,
		imageUrl: null,
		isDirty: false,
		tiffPages: [],
		rotations: {},
		pageThumbnailOverrides: {},
	};
	openDocuments.push(newDoc);
	activeDocumentId = filePath || fileName;
	resetSessionUiForDocumentSwitch();
	return newDoc;
}

export const activeDoc: SharedDocumentState = {
	get openDocuments() {
		return openDocuments;
	},
	set openDocuments(val) {
		openDocuments = val;
	},
	get activeDocumentId() {
		return activeDocumentId;
	},
	set activeDocumentId(val) {
		activeDocumentId = val;
	},

	// The active pointer target locator
	get current() {
		return (
			openDocuments.find(
				(d) =>
					d.filePath === activeDocumentId || d.fileName === activeDocumentId,
			) || null
		);
	},

	// Proxy all existing properties safely to prevent breaking views
	get fileType() {
		return this.current?.fileType || null;
	},
	set fileType(val) {
		if (this.current) this.current.fileType = val;
	},
	get fileName() {
		return this.current?.fileName || "";
	},
	set fileName(val) {
		if (this.current) this.current.fileName = val;
	},
	get filePath() {
		return this.current?.filePath || null;
	},
	set filePath(val) {
		if (this.current) this.current.filePath = val;
	},
	get rawBytes() {
		return this.current?.rawBytes || null;
	},
	set rawBytes(val) {
		if (this.current) this.current.rawBytes = val;
	},
	get pageCount() {
		return this.current?.pageCount || 0;
	},
	set pageCount(val) {
		if (this.current) this.current.pageCount = val;
	},
	get pageOrder() {
		return this.current?.pageOrder || [];
	},
	set pageOrder(val) {
		if (this.current) this.current.pageOrder = val;
	},
	get currentPage() {
		return this.current?.currentPage || 1;
	},
	set currentPage(val) {
		if (this.current) this.current.currentPage = val;
	},
	get shapes() {
		return this.current?.shapes || {};
	},
	set shapes(val) {
		if (this.current) this.current.shapes = val;
	},
	get bookmarks() {
		return this.current?.bookmarks || [];
	},
	set bookmarks(val) {
		if (this.current) this.current.bookmarks = val;
	},
	get comments() {
		return this.current?.comments || [];
	},
	set comments(val) {
		if (this.current) this.current.comments = val;
	},
	get imageRotation() {
		return this.current?.imageRotation || 0;
	},
	set imageRotation(val) {
		if (this.current) this.current.imageRotation = val;
	},
	get imageUrl() {
		return this.current?.imageUrl || "";
	},
	set imageUrl(val) {
		if (this.current) this.current.imageUrl = val;
	},
	get isDirty() {
		return this.current?.isDirty || false;
	},
	set isDirty(val) {
		if (this.current) this.current.isDirty = val;
	},
	get tiffPages() {
		return this.current?.tiffPages || [];
	},
	set tiffPages(val) {
		if (this.current) this.current.tiffPages = val;
	},
	get rotations() {
		return this.current?.rotations || {};
	},
	set rotations(val) {
		if (this.current) this.current.rotations = val;
	},

	// Global / session-wide tool + stroke style (lib/stores/tools.svelte.ts)
	get activeTool() {
		return getActiveTool();
	},
	set activeTool(val) {
		setActiveTool(val);
	},
	get selectedShape() {
		return selectedShape;
	},
	set selectedShape(val) {
		selectedShape = val;
	},
	get selectedShapes() {
		return selectedShapes;
	},
	set selectedShapes(val) {
		selectedShapes = val;
	},
	get activeColor() {
		return getActiveColor();
	},
	set activeColor(val) {
		setActiveColor(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"color",
				val,
			)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				color: val,
				textColor: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeThickness() {
		return getActiveThickness();
	},
	set activeThickness(val) {
		setActiveThickness(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"thickness",
				val,
			)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				thickness: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeLineStyle() {
		return getActiveLineStyle();
	},
	set activeLineStyle(val) {
		setActiveLineStyle(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"lineStyle",
				val,
			)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				lineStyle: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeFontFamily() {
		return activeFontFamily;
	},
	set activeFontFamily(val) {
		activeFontFamily = val;
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"fontFamily",
				val,
			)
		) {
			pushHistorySnapshot();
			// Keep font in sync for compatibility
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				fontFamily: val,
				font: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeTextAlignment() {
		return activeTextAlignment;
	},
	set activeTextAlignment(val) {
		activeTextAlignment = val;
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"alignment",
				val,
			)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				alignment: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get zoomScale() {
		return zoomScale;
	},
	set zoomScale(val) {
		zoomScale = val;
	},
	get defaultFont() {
		return defaultFont;
	},
	set defaultFont(val) {
		defaultFont = val;
	},
	get defaultSize() {
		return defaultSize;
	},
	set defaultSize(val) {
		defaultSize = val;
	},
	get defaultStyle() {
		return defaultStyle;
	},
	set defaultStyle(val) {
		defaultStyle = val;
	},
	get scrollTop() {
		return scrollTop;
	},
	set scrollTop(val) {
		scrollTop = val;
	},
	get scrollHeight() {
		return scrollHeight;
	},
	set scrollHeight(val) {
		scrollHeight = val;
	},
	get clientHeight() {
		return clientHeight;
	},
	set clientHeight(val) {
		clientHeight = val;
	},
	get isClickScrolling() {
		return isClickScrolling;
	},
	set isClickScrolling(val) {
		isClickScrolling = val;
	},
	get activeStampDataUrl() {
		return activeStampDataUrl;
	},
	set activeStampDataUrl(val) {
		activeStampDataUrl = val;
	},
	get savedSignatureSets() {
		return savedSignatureSets;
	},
	set savedSignatureSets(val) {
		savedSignatureSets = val;
	},

	get recents() {
		return recents;
	},
	set recents(val) {
		recents = val;
	},

	get thumbnailVersion() {
		return thumbnailVersion;
	},
	set thumbnailVersion(val) {
		thumbnailVersion = val;
	},

	get pageThumbnailOverrides() {
		return this.current?.pageThumbnailOverrides || {};
	},
	set pageThumbnailOverrides(val) {
		if (this.current) this.current.pageThumbnailOverrides = val;
	},

	get commentsFocusRequest() {
		return commentsFocusRequest;
	},
	set commentsFocusRequest(val) {
		commentsFocusRequest = val;
	},

	get isSaving() {
		return isSaving;
	},
	set isSaving(val) {
		isSaving = !!val;
	},

	updateRecentThumbnail(filePath: string, thumbnailDataUrl: string) {
		// Delegate to module-level helper so $state writes are never lost via `this` binding.
		updateRecentThumbnail(filePath, thumbnailDataUrl);
	},

	/** Close the currently active document (no dirty prompt). Prefer closeDocumentWorkspace. */
	flushDocumentState() {
		const id = activeDocumentId;
		if (!id) {
			openDocuments = [];
			activeDocumentId = null;
			resetSessionUiForDocumentSwitch();
			return;
		}
		closeDocumentWorkspace(id);
	},
};

// Bind undo/redo to the active document facade (must run after activeDoc exists).
bindHistoryDocument(activeDoc);

function syncCommentAuthorFromSignatureSet(set: SignatureSet) {
	if (!(set.initials || set.firstName || set.lastName)) return;
	const fullName =
		`${set.firstName || ""} ${set.lastName || ""}`.trim() ||
		set.label?.replace(/:$/, "") ||
		set.initials ||
		"You";
	setCommentAuthorProfile({
		initials: set.initials || fullName.slice(0, 2).toUpperCase() || "You",
		fullName,
		email: set.email,
	});
}

function persistSignatureSets(sets: SignatureSet[]) {
	activeDoc.savedSignatureSets = sets;
	localStorage.setItem("speeddf_signature_sets", JSON.stringify(sets));
}

export function saveSignatureSetAction(newSet: SignatureSet) {
	persistSignatureSets([...activeDoc.savedSignatureSets, newSet]);
	syncCommentAuthorFromSignatureSet(newSet);
}

/** Replace an existing signature set by id (edit flow). Falls back to append if id missing. */
export function updateSignatureSetAction(updated: SignatureSet) {
	const list = activeDoc.savedSignatureSets || [];
	const idx = list.findIndex((s) => s.id === updated.id);
	if (idx < 0) {
		saveSignatureSetAction(updated);
		return;
	}
	const next = [...list];
	next[idx] = updated;
	persistSignatureSets(next);
	syncCommentAuthorFromSignatureSet(updated);
}

export function rotatePageAction(
	pageNumber: number,
	direction: "clockwise" | "counter",
) {
	if (activeDoc.fileType === "image") {
		const currentRotation = activeDoc.imageRotation ?? 0;
		const degreeShift = direction === "clockwise" ? 90 : -90;
		let targetDegree = (currentRotation + degreeShift) % 360;
		if (targetDegree < 0) targetDegree += 360;
		activeDoc.imageRotation = targetDegree;
		return;
	}
	const currentRotation = activeDoc.rotations[pageNumber] ?? 0;
	const degreeShift = direction === "clockwise" ? 90 : -90;
	let targetDegree = (currentRotation + degreeShift) % 360;
	if (targetDegree < 0) targetDegree += 360;

	activeDoc.rotations = {
		...activeDoc.rotations,
		[pageNumber]: targetDegree,
	};
}

export function addOrToggleBookmarkAction(pageNum: number) {
	const index = activeDoc.bookmarks.findIndex((b) => b.pageNum === pageNum);
	if (index !== -1) {
		activeDoc.bookmarks = activeDoc.bookmarks.filter(
			(b) => b.pageNum !== pageNum,
		);
	} else {
		activeDoc.bookmarks = [...activeDoc.bookmarks, { pageNum, name: "" }];
	}
}

export function deleteBookmarkAction(pageNum: number) {
	activeDoc.bookmarks = activeDoc.bookmarks.filter(
		(b) => b.pageNum !== pageNum,
	);
}

export function updateBookmarkNameAction(pageNum: number, newName: string) {
	activeDoc.bookmarks = activeDoc.bookmarks.map((b) =>
		b.pageNum === pageNum ? { ...b, name: newName } : b,
	);
}

/** Open the comments sidebar panel focused on a page (session UI signal). */
export function requestCommentsPanel(pageNum: number) {
	activeDoc.currentPage = pageNum;
	commentsFocusRequest = pageNum;
}

/** Add a root comment on a page. Returns the new comment id, or null if text empty. */
export function addCommentAction(pageNum: number, text: string): string | null {
	const clean = sanitizeCommentText(text);
	if (!clean || pageNum < 1) return null;
	const id = createCommentId();
	const next: PageComment = {
		id,
		pageNum,
		author: getCommentAuthor(),
		authorFullName: getCommentAuthorFullName(),
		text: clean,
		createdAt: Date.now(),
		replies: [],
	};
	activeDoc.comments = [...(activeDoc.comments || []), next];
	activeDoc.isDirty = true;
	return id;
}

/** Reply to a root comment thread. */
export function replyToCommentAction(
	threadId: string,
	text: string,
): string | null {
	const clean = sanitizeCommentText(text);
	if (!clean || !threadId) return null;
	const replyId = createCommentId();
	let found = false;
	activeDoc.comments = (activeDoc.comments || []).map((c) => {
		if (c.id !== threadId) return c;
		found = true;
		return {
			...c,
			replies: [
				...(c.replies || []),
				{
					id: replyId,
					author: getCommentAuthor(),
					authorFullName: getCommentAuthorFullName(),
					text: clean,
					createdAt: Date.now(),
				},
			],
		};
	});
	if (!found) return null;
	activeDoc.isDirty = true;
	return replyId;
}

/** Delete an entire root thread (including replies). */
export function deleteCommentAction(threadId: string) {
	const before = activeDoc.comments?.length || 0;
	activeDoc.comments = (activeDoc.comments || []).filter((c) => c.id !== threadId);
	if ((activeDoc.comments?.length || 0) !== before) {
		activeDoc.isDirty = true;
	}
}

/** Delete a single reply under a root thread. */
export function deleteReplyAction(threadId: string, replyId: string) {
	activeDoc.comments = (activeDoc.comments || []).map((c) => {
		if (c.id !== threadId) return c;
		return {
			...c,
			replies: (c.replies || []).filter((r) => r.id !== replyId),
		};
	});
	activeDoc.isDirty = true;
}

// True global master Wasm worker singleton to survive component unmounts
export const globalPdfWorkerInstance: { current: PdfJsWorker | null } = {
	current: null,
};
