import {
	patchSelectedShapes,
	selectionNeedsPropertyUpdate,
} from "./lib/annotation/shapeHelpers";
import {
	clampPx,
	mimeFromFileName,
	resampleImageToBytes,
} from "./lib/annotation/imageResize";
import type { PageComment } from "./lib/comments/comments";
import {
	clampCommentPct,
	createCommentId,
	getCommentAuthor,
	getCommentAuthorFullName,
	sanitizeCommentText,
	setCommentAuthorProfile,
} from "./lib/comments/comments";
import {
	extractFormFields,
	type FormFieldDef,
	type FormFieldValue,
} from "./lib/forms/formFields";
import {
	extractHyperlinks,
	type HyperlinkDef,
} from "./lib/links/hyperlinks";
import { resetMainViewReady } from "./lib/render/mainViewGate";
import { setLowPriorityAllowed } from "./lib/render/pdfRenderQueue";
import { destroySharedWorkspacePdf } from "./lib/render/sharedPdfDocument";
import {
	clearThumbnailInflight,
	invalidatePageThumbnail,
	setThumbnailContentKeyFromBytes,
} from "./lib/render/thumbnailCache";
import {
	contentKeyForBytes,
	persistThumbnailPage,
} from "./lib/render/thumbnailPersist";
import {
	bindHistoryDocument,
	executeRedoAction,
	executeUndoAction,
	pushHistorySnapshot,
	redoStack,
	undoStack,
} from "./lib/stores/history.svelte";
import {
	type ActiveLineEnds,
	type ActiveLineStyle,
	type ActiveTool,
	getActiveColor,
	getActiveLineEnds,
	getActiveLineStyle,
	getActiveThickness,
	getActiveTool,
	setActiveColor,
	setActiveLineEnds,
	setActiveLineStyle,
	setActiveThickness,
	setActiveTool,
} from "./lib/stores/tools.svelte";

export type { CommentReply, PageComment } from "./lib/comments/comments";
export type { FormFieldDef, FormFieldValue } from "./lib/forms/formFields";
export type { HyperlinkDef } from "./lib/links/hyperlinks";

/** Avoid importing the name `PDFWorker` (clashes with pdfjs-dist's class export in some tooling). */
type PdfJsWorker = InstanceType<typeof import("pdfjs-dist")["PDFWorker"]>;

// Re-export tool types for consumers that want them without deep imports.
export type { ActiveLineEnds, ActiveLineStyle, ActiveTool };
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
		| "pen"
		| "line";
	x: number; // Percentage coordinate left (0-100)
	y: number; // Percentage coordinate top (0-100)
	width?: number; // Percentage width layout bounds
	height?: number; // Percentage height layout bounds
	text?: string; // Text payload string (for text boxes)
	dataUrl?: string; // Base64 PNG image stream string (for signatures)
	points?: { x: number; y: number }[]; // Freehand nodes, or line start/end (length 2)
	color?: string; // Captures the unique hexadecimal ink value
	textColor?: string; // Captures the custom text color
	thickness?: number;
	font?: string; // Custom font family name
	size?: number; // Custom font size in points
	style?: "Normal" | "Bold" | "Italic"; // Font style variant
	lineStyle?: "solid" | "dashed" | "dotted" | "dash-dot";
	/** Arrow ends for type "line": plain | end (tip at end point) | both. */
	lineEnds?: "plain" | "end" | "both";
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
	/**
	 * Stable tab/workspace identity. Never changes on Save As (path/name may).
	 * Used as activeDocumentId so remounts and focus loss do not happen on rename.
	 */
	workspaceId: string;
	fileType: "pdf" | "tiff" | "image" | "markdown" | null;
	fileName: string;
	filePath: string | null;
	rawBytes: Uint8Array | null;
	/**
	 * Canonical UTF-8 markdown text for `fileType === "markdown"`.
	 * Source of truth for the document; the workspace view is a pure projection
	 * (parse → sanitize → HTML). Source edits must write back here.
	 */
	markdownSource?: string | null;
	/**
	 * Markdown only: source-left / preview-right split. Default false
	 * (preview-only). Per-tab so switching documents does not leak the mode.
	 */
	markdownSplitView?: boolean;
	pageCount: number;
	pageOrder: number[];
	currentPage: number;
	shapes: Record<number, AnnotationShape[]>;
	bookmarks: Bookmark[];
	/** Per-page threaded comments (document-scoped; not shared across tabs). */
	comments: PageComment[];
	/**
	 * AcroForm field definitions for overlay (text/checkbox/dropdown/signature).
	 * Empty when the PDF has no form or is not a PDF.
	 */
	formFields: FormFieldDef[];
	/**
	 * Current form field values keyed by fully-qualified field name.
	 * Signature fields store stamp data URLs (or empty string when unsigned).
	 */
	formValues: Record<string, FormFieldValue>;
	/**
	 * URI Link annotations (http/https/mailto) for clickable overlay.
	 * Empty for non-PDF or when the document has no external links.
	 */
	hyperlinks: HyperlinkDef[];
	imageRotation?: number;
	imageUrl?: string | null;
	/**
	 * Original pixel size when the image tab was opened (or HEIC-converted).
	 * Used as the Scale (%) baseline for the image resize strip; multi-doc safe.
	 */
	imageNativeWidth?: number;
	imageNativeHeight?: number;
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
	activeLineEnds: ActiveLineEnds;
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
	fileType: "pdf" | "tiff" | "image" | "markdown" | null;
	/** Canonical markdown text when fileType is markdown (see DocumentWorkspace). */
	markdownSource?: string | null;
	/** Markdown source/preview split (per tab; default preview-only). */
	markdownSplitView?: boolean;
	imageUrl?: string | null;
	imageRotation?: number;
	imageNativeWidth?: number;
	imageNativeHeight?: number;
	tiffPages: Uint8Array[];
	flushDocumentState(): void;
	isDirty: boolean;
	bookmarks: Bookmark[];
	comments: PageComment[];
	formFields: FormFieldDef[];
	formValues: Record<string, FormFieldValue>;
	hyperlinks: HyperlinkDef[];
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
	 * Session UI signal: optional thread id to highlight when opening comments.
	 * Consumed with commentsFocusRequest.
	 */
	commentsFocusThreadId: string | null;
	/**
	 * Session UI: pending pin draft after right-click "Add Comment Here".
	 * Compose popout posts with position; null when idle.
	 */
	commentPinDraft: { pageNum: number; x: number; y: number } | null;
	/** Session UI: open thread id for an on-page pin popout. */
	openCommentPinId: string | null;
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
const TEXT_SETTINGS_KEY = "speeddf_text_settings";

type PersistedTextSettings = {
	fontFamily?: string;
	size?: number;
	style?: "Normal" | "Bold" | "Italic";
	alignment?: "left" | "center" | "right";
};

function loadTextSettings(): PersistedTextSettings {
	try {
		const raw = localStorage.getItem(TEXT_SETTINGS_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function persistTextSettings(partial: PersistedTextSettings) {
	try {
		const next = {
			fontFamily: partial.fontFamily ?? activeFontFamily,
			size: partial.size ?? defaultSize,
			style: partial.style ?? defaultStyle,
			alignment: partial.alignment ?? activeTextAlignment,
		};
		localStorage.setItem(TEXT_SETTINGS_KEY, JSON.stringify(next));
	} catch {
		/* ignore quota / private mode */
	}
}

const _savedText = loadTextSettings();
const _validFonts = new Set([
	"Helvetica",
	"Times-Roman",
	"Courier",
	"Inter",
	"JetBrainsMono",
]);
const _initFont = _validFonts.has(String(_savedText.fontFamily || ""))
	? (_savedText.fontFamily as
			| "Helvetica"
			| "Times-Roman"
			| "Courier"
			| "Inter"
			| "JetBrainsMono")
	: "Helvetica";
const _initSize =
	typeof _savedText.size === "number" &&
	_savedText.size >= 6 &&
	_savedText.size <= 200
		? Math.round(_savedText.size)
		: 12;
const _initStyle =
	_savedText.style === "Bold" || _savedText.style === "Italic"
		? _savedText.style
		: "Normal";
const _initAlign =
	_savedText.alignment === "center" || _savedText.alignment === "right"
		? _savedText.alignment
		: "left";

let activeFontFamily = $state<
	"Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono"
>(_initFont);
let activeTextAlignment = $state<"left" | "center" | "right">(_initAlign);
let zoomScale = $state(120);
let defaultFont = $state(_initFont);
let defaultSize = $state(_initSize);
let defaultStyle = $state<"Normal" | "Bold" | "Italic">(_initStyle);
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
/**
 * Sidebar thumbnail JPEGs keyed by workspaceId → { pageIndex → dataUrl }.
 * Kept OUTSIDE DocumentWorkspace / openDocuments so trickle-in updates never
 * reassign openDocuments or re-run main WorkspacePage paint effects.
 */
let sessionPageThumbs = $state<Record<string, Record<number, string>>>({});
/** Session-only: ask PageSidebar to open the comments tab for a page. */
let commentsFocusRequest = $state<number | null>(null);
/** Session-only: scroll/highlight a specific thread when opening the comments tab. */
let commentsFocusThreadId = $state<string | null>(null);
/**
 * Session UI: pending on-page pin placement (compose before commit).
 * Set by right-click "Add Comment Here"; cleared on post or cancel.
 */
let commentPinDraft = $state<{
	pageNum: number;
	x: number;
	y: number;
} | null>(null);
/** Session UI: which placed pin's thread popout is open (thread id). */
let openCommentPinId = $state<string | null>(null);
/** Session-only: workspace is locked while save/flatten runs. */
let isSaving = $state(false);

function findOpenDocument(
	id: string | null | undefined,
): DocumentWorkspace | null {
	if (!id) return null;
	return (
		openDocuments.find(
			(d) => d.workspaceId === id || d.filePath === id || d.fileName === id,
		) || null
	);
}

/**
 * Clear selection + undo/redo when switching or closing documents so history
 * never crosses document boundaries. Also reset text tool defaults for a
 * clean start on each document (Standard Sans / Helvetica).
 */
function resetSessionUiForDocumentSwitch() {
	selectedShape = null;
	selectedShapes = [];
	undoStack.length = 0;
	redoStack.length = 0;
	// Direct assign (selection already cleared)
	activeFontFamily = "Helvetica";
	defaultFont = "Helvetica";
	persistTextSettings({ fontFamily: "Helvetica" });
}

/**
 * Store a static JPEG data URL for one page.
 * Updates session thumb map only — never reassigns `openDocuments` or bumps
 * `thumbnailVersion` (those were re-running main page paints and flashing p1).
 */
export function setPageThumbnailOverride(
	pageIndex: number,
	thumbnailDataUrl: string,
	filePath?: string | null,
) {
	if (pageIndex < 0 || !thumbnailDataUrl) return;
	const target =
		(filePath ? findOpenDocument(filePath) : null) ||
		findOpenDocument(activeDocumentId);
	if (!target) return;
	const wsId = documentKey(target);
	const prev = sessionPageThumbs[wsId] || target.pageThumbnailOverrides || {};
	if (prev[pageIndex] === thumbnailDataUrl) return;

	const nextPages = {
		...prev,
		[pageIndex]: thumbnailDataUrl,
	};
	// Session map: sidebar-only reactivity (no openDocuments identity change)
	sessionPageThumbs = {
		...sessionPageThumbs,
		[wsId]: nextPages,
	};
	// Mirror onto the doc for cleanup/multi-doc without array reassignment
	target.pageThumbnailOverrides = nextPages;

	// Persist to IndexedDB when we have a path (re-open = instant thumbs)
	if (target.filePath && target.rawBytes) {
		const path = target.filePath;
		const bytes = target.rawBytes;
		const key = contentKeyForBytes(bytes);
		void persistThumbnailPage(path, key, pageIndex, thumbnailDataUrl);
	}
}

/** Drop session thumbs for a workspace (on close). */
export function clearSessionPageThumbs(workspaceKey: string): void {
	if (!workspaceKey || !sessionPageThumbs[workspaceKey]) return;
	const next = { ...sessionPageThumbs };
	delete next[workspaceKey];
	sessionPageThumbs = next;
}

/**
 * Post-save thumbnail broadcast:
 * 1) write page-0 override map on the matching open document
 * 2) bump thumbnailVersion / recents for Recent Documents cards
 * 3) Svelte 5-safe recents array reassignment
 */
export function applyLiveThumbnail(
	thumbnailDataUrl: string,
	filePath?: string | null,
	pageIndex = 0,
) {
	setPageThumbnailOverride(pageIndex, thumbnailDataUrl, filePath);
	if (filePath) {
		// Recents / dashboard only — not main workspace paint
		updateRecentThumbnail(filePath, thumbnailDataUrl);
	}
	// Image sidebar uses {#key thumbnailVersion}; bump only on explicit live apply
	// (save / image seed), never on every multi-page PDF thumb trickle.
	if (pageIndex === 0) {
		thumbnailVersion += 1;
	}
}

/** Stable tab id — prefers workspaceId so Save As never remounts the active tab. */
export function documentKey(d: DocumentWorkspace): string {
	return d.workspaceId || d.filePath || d.fileName;
}

/** Switch the active workspace tab. */
export function switchActiveDocument(id: string) {
	if (!id || activeDocumentId === id) return;
	if (!findOpenDocument(id)) return;
	activeDocumentId = id;
	resetSessionUiForDocumentSwitch();
	// Drop the previous tab's shared pdf.js document so memory does not stack.
	// Keep the global worker alive (other tabs may still be open).
	void destroySharedWorkspacePdf({ destroyWorker: false });
	// New tab must re-claim main paint priority before thumbs run
	resetMainViewReady();
	setLowPriorityAllowed(false);
}

/**
 * After a successful Save / Save As:
 * - keep the same open-document object as the active tab (update path/name only)
 * - replace in-memory bytes with the compiled output so the UI matches disk
 * - clear live annotation overlays (they are baked into compiledBytes)
 * - clear dirty and refresh form field defs from the saved PDF
 * - upsert Recent Documents for the saved path (Save As creates a new path)
 *
 * Critical: activeDocumentId is the stable workspaceId — path/name changes must
 * not remount the workspace or resolve `current` to null.
 */
export async function commitActiveDocumentAfterSave(opts: {
	compiledBytes: Uint8Array;
	/** New absolute path (Save As) or existing path (Save). */
	filePath?: string | null;
	fileName?: string;
}): Promise<void> {
	const doc = findOpenDocument(activeDocumentId);
	if (!doc) {
		console.warn("commitActiveDocumentAfterSave: active document not found");
		return;
	}

	// Ensure legacy docs without workspaceId still stay focused
	if (!doc.workspaceId) {
		doc.workspaceId =
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	}

	if (opts.filePath !== undefined) {
		doc.filePath = opts.filePath;
	}
	if (opts.fileName !== undefined) {
		doc.fileName = opts.fileName;
	} else if (opts.filePath) {
		const parts = opts.filePath.split(/[\\/]/);
		doc.fileName = parts[parts.length - 1] || doc.fileName;
	}

	// Prefer a real ArrayBuffer-backed copy (detached views from save can be fragile)
	doc.rawBytes = new Uint8Array(opts.compiledBytes);
	doc.isDirty = false;
	// Markdown: keep source in sync with written bytes (source remains canonical)
	if (doc.fileType === "markdown") {
		try {
			doc.markdownSource = new TextDecoder("utf-8").decode(doc.rawBytes);
		} catch {
			doc.markdownSource = "";
		}
	}
	// Refresh thumbnail content key so IDB entries match the new bytes
	setThumbnailContentKeyFromBytes(doc.rawBytes);

	// Flatten bakes annotations into the written bytes. Drop the live overlay so
	// the canvas does not show duplicate ink (burned-in + editable shapes).
	const priorPageOrder = [...(doc.pageOrder || [])];
	doc.shapes = {};
	selectedShape = null;
	selectedShapes = [];
	undoStack.length = 0;
	redoStack.length = 0;

	// Rotations are applied during flatten — zero them so re-render does not double-rotate.
	doc.rotations = {};
	doc.imageRotation = 0;
	// PDF/TIFF: drop layout cache so warm reload remasures getViewport (includes baked /Rotate).
	// Image flatten writes already-rotated pixels and reuses cachedDimensions as the new native size.
	if (doc.fileType === "pdf" || doc.fileType === "tiff") {
		doc.cachedDimensions = undefined;
	}

	// Flatten writes pages in pageOrder sequence as PDF pages 1..N.
	// Remap session page indices so bookmarks/comments/current page stay correct.
	if (doc.fileType === "pdf" || doc.fileType === "tiff") {
		const n = priorPageOrder.length > 0 ? priorPageOrder.length : doc.pageCount;
		const pageIndexMap = new Map<number, number>();
		for (let i = 0; i < priorPageOrder.length; i++) {
			pageIndexMap.set(priorPageOrder[i], i + 1);
		}
		if (n > 0) {
			doc.pageCount = n;
			doc.pageOrder = Array.from({ length: n }, (_, i) => i + 1);
			const mapPage = (p: number) => pageIndexMap.get(p) ?? p;
			if (doc.bookmarks?.length) {
				doc.bookmarks = doc.bookmarks.map((b) => ({
					...b,
					pageNum: mapPage(b.pageNum),
				}));
			}
			if (doc.comments?.length) {
				doc.comments = doc.comments.map((c) => ({
					...c,
					pageNum: mapPage(c.pageNum),
				}));
			}
			doc.currentPage = mapPage(doc.currentPage) || 1;
		}
		// TIFF Save As writes a PDF; switch the workspace to PDF mode so re-render
		// uses the flattened bytes (with baked annotations) instead of raw tiff pages.
		if (doc.fileType === "tiff") {
			doc.fileType = "pdf";
			doc.tiffPages = [];
		}
	}

	// Image flatten bakes annotations + rotation into pixels — refresh the display URL.
	if (doc.fileType === "image" && doc.rawBytes) {
		try {
			if (doc.imageUrl) {
				URL.revokeObjectURL(doc.imageUrl);
			}
			const lower = (doc.filePath || doc.fileName || "").toLowerCase();
			let mime = "image/jpeg";
			if (lower.endsWith(".png")) mime = "image/png";
			else if (lower.endsWith(".webp")) mime = "image/webp";
			else if (lower.endsWith(".svg")) mime = "image/svg+xml";
			else if (lower.endsWith(".gif")) mime = "image/gif";
			else if (lower.endsWith(".bmp")) mime = "image/bmp";
			const blob = new Blob([doc.rawBytes as BlobPart], { type: mime });
			doc.imageUrl = URL.createObjectURL(blob);
			// After save, the written pixels are the new original — reset Scale (%) baseline
			const dims = doc.cachedDimensions?.[0];
			if (dims) {
				doc.imageNativeWidth = dims.width;
				doc.imageNativeHeight = dims.height;
			}
		} catch (err) {
			console.warn("Post-save image URL refresh failed:", err);
		}
	}

	// Always keep active id on the stable workspace key (path may have changed)
	activeDocumentId = documentKey(doc);

	// Tab strip / multi-doc list reactivity
	openDocuments = [...openDocuments];

	// Rebuild form overlay from the bytes we actually wrote (flattened → no widgets)
	if (doc.fileType === "pdf") {
		try {
			const extracted = await extractFormFields(doc.rawBytes);
			doc.formFields = extracted.fields;
			doc.formValues = extracted.values;
			openDocuments = [...openDocuments];
		} catch (err) {
			console.warn("Post-save form re-extract failed:", err);
			doc.formFields = [];
			doc.formValues = {};
		}
		try {
			doc.hyperlinks = await extractHyperlinks(doc.rawBytes);
			openDocuments = [...openDocuments];
		} catch (err) {
			console.warn("Post-save hyperlink re-extract failed:", err);
			doc.hyperlinks = [];
		}
	}

	// Ensure Save As path appears in Recent Documents (thumbnail may arrive async)
	if (doc.filePath) {
		upsertRecentEntry(doc.filePath, doc.fileName);
	}
}

/**
 * Cycle active tab (Ctrl+Tab / Ctrl+Shift+Tab).
 * @param direction +1 next, -1 previous
 */
export function cycleActiveDocument(direction: 1 | -1) {
	if (openDocuments.length < 2 || activeDocumentId === null) return;
	const ids = openDocuments.map(documentKey);
	const current = Math.max(0, ids.indexOf(activeDocumentId));
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
 * Drop all heavy in-memory payloads on a workspace so GC can reclaim them.
 * Call before removing the document from `openDocuments`.
 */
export function purgeDocumentResources(doc: DocumentWorkspace): void {
	if (doc.imageUrl) {
		try {
			URL.revokeObjectURL(doc.imageUrl);
		} catch {
			/* ignore */
		}
	}
	doc.imageUrl = null;
	// Large PDF/image buffers — explicit null so nothing retains the ArrayBuffer.
	doc.rawBytes = null;
	doc.markdownSource = null;
	doc.markdownSplitView = false;
	doc.tiffPages = [];
	doc.shapes = {};
	doc.pageThumbnailOverrides = {};
	clearSessionPageThumbs(documentKey(doc));
	doc.cachedDimensions = undefined;
	doc.formFields = [];
	doc.formValues = {};
	doc.hyperlinks = [];
	doc.bookmarks = [];
	doc.comments = [];
	doc.rotations = {};
	doc.pageOrder = [];
	doc.pageCount = 0;
	doc.currentPage = 1;
	doc.imageRotation = 0;
	doc.imageNativeWidth = undefined;
	doc.imageNativeHeight = undefined;
	doc.isDirty = false;
	doc.fileType = null;
}

/**
 * Full close + memory reclaim for one workspace tab.
 *
 * - Purges rawBytes, shapes, thumbnails, forms, comments, TIFF pages
 * - Removes the tab from `openDocuments`
 * - Destroys the shared PDFDocumentProxy when the active tab closes
 * - Destroys the global PDFWorker when no documents remain (Wasm heap)
 *
 * Prefer this over filtering `openDocuments` by hand.
 */
export async function cleanupWorkspace(id: string): Promise<void> {
	const doc = findOpenDocument(id);
	if (!doc) return;

	const wasActive =
		activeDocumentId === documentKey(doc) ||
		activeDocumentId === doc.filePath ||
		activeDocumentId === doc.fileName ||
		activeDocumentId === id;

	// 1. Strip heavy payloads while the object is still reachable.
	purgeDocumentResources(doc);

	// 2. Drop the tab so WorkspacePage / thumbnails unmount and release canvases.
	openDocuments = openDocuments.filter(
		(d) =>
			d.workspaceId !== id &&
			d.filePath !== id &&
			d.fileName !== id &&
			d !== doc,
	);

	const noDocsLeft = openDocuments.length === 0;

	if (wasActive) {
		activeDocumentId = openDocuments[0] ? documentKey(openDocuments[0]) : null;
		resetSessionUiForDocumentSwitch();
	} else if (noDocsLeft) {
		activeDocumentId = null;
		resetSessionUiForDocumentSwitch();
	}

	// 3. Tear down pdf.js shared document. Kill the worker only when the last
	//    tab closes so open/close cycles do not stack Wasm heaps.
	if (wasActive || noDocsLeft) {
		await destroySharedWorkspacePdf({ destroyWorker: noDocsLeft });
		resetMainViewReady();
		setLowPriorityAllowed(false);
		clearThumbnailInflight();
	}
}

/**
 * Close one open document by id (path, fileName, or workspaceId).
 * Does not prompt — caller handles dirty confirmation.
 * Delegates to {@link cleanupWorkspace} for full memory reclaim.
 */
export function closeDocumentWorkspace(id: string) {
	void cleanupWorkspace(id);
}

/**
 * Close every open document without dirty prompts (caller must confirm first).
 */
export async function closeAllDocumentWorkspaces() {
	// Copy first — cleanupWorkspace mutates the array
	const ids = openDocuments.map(documentKey);
	for (const id of ids) {
		const doc = findOpenDocument(id);
		if (doc) doc.isDirty = false;
		await cleanupWorkspace(id);
	}
}

/** Upsert a Recent Documents row (used after Save As when path is new). */
export function upsertRecentEntry(
	filePath: string,
	fileName?: string | null,
	thumbnail?: string,
) {
	if (!filePath) return;
	try {
		const name =
			fileName?.trim() || filePath.split(/[\\/]/).pop() || "document.pdf";
		const pathMatch = (item: RecentFile) =>
			item.path === filePath ||
			(!!item.path && item.path.toLowerCase() === filePath.toLowerCase());

		const next = [...(recents || [])];
		const idx = next.findIndex(pathMatch);
		const now = Date.now();
		if (idx !== -1) {
			next[idx] = {
				...next[idx],
				name: name || next[idx].name,
				path: filePath,
				timestamp: now,
				lastOpened: now,
				...(thumbnail ? { thumbnail } : {}),
			};
			// Move to front
			const [row] = next.splice(idx, 1);
			next.unshift(row);
		} else {
			next.unshift({
				name,
				path: filePath,
				timestamp: now,
				lastOpened: now,
				thumbnail: thumbnail || "",
			});
		}
		if (next.length > 10) next.length = 10;
		recents = next;
		localStorage.setItem("speeddf_recents", JSON.stringify(next));
	} catch (err) {
		console.warn("Failed to upsert recent entry:", err);
	}
}

/**
 * Update Recent Documents entry + localStorage. Always bumps thumbnailVersion
 * so PageSidebar redraws even when the path is not (yet) in the recents list.
 * Creates a new recents row when the path is missing (Save As).
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
			} else if (filePath) {
				// Save As / first save — ensure Recent Documents shows the new path
				upsertRecentEntry(
					filePath,
					filePath.split(/[\\/]/).pop() || "document.pdf",
					thumbnailDataUrl,
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
		} else if (filePath && thumbnailDataUrl) {
			// localStorage empty but we just upserted in-memory — persist
			try {
				localStorage.setItem("speeddf_recents", JSON.stringify(recents));
			} catch {
				/* ignore */
			}
		}
	} catch (err) {
		console.warn("Failed to update central dashboard thumbnail arrays:", err);
	}
}

function newWorkspaceId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function initializeNewDocument(
	fileName: string,
	filePath: string | null,
) {
	const existing = openDocuments.find(
		(d) => (filePath && d.filePath === filePath) || d.fileName === fileName,
	);
	if (existing) {
		if (!existing.workspaceId) existing.workspaceId = newWorkspaceId();
		const nextId = documentKey(existing);
		if (activeDocumentId !== nextId) {
			activeDocumentId = nextId;
			resetSessionUiForDocumentSwitch();
		}
		return existing;
	}

	const newDoc: DocumentWorkspace = {
		workspaceId: newWorkspaceId(),
		fileType: null,
		fileName: fileName,
		filePath: filePath,
		rawBytes: null,
		markdownSource: null,
		markdownSplitView: false,
		pageCount: 0,
		pageOrder: [],
		currentPage: 1,
		shapes: {},
		bookmarks: [],
		comments: [],
		formFields: [],
		formValues: {},
		hyperlinks: [],
		imageRotation: 0,
		imageUrl: null,
		imageNativeWidth: undefined,
		imageNativeHeight: undefined,
		isDirty: false,
		tiffPages: [],
		rotations: {},
		pageThumbnailOverrides: {},
	};
	openDocuments.push(newDoc);
	activeDocumentId = documentKey(newDoc);
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

	// The active pointer target locator (workspaceId preferred; path/name fallback)
	get current() {
		return findOpenDocument(activeDocumentId);
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
	get markdownSource() {
		return this.current?.markdownSource ?? null;
	},
	set markdownSource(val) {
		if (this.current) this.current.markdownSource = val;
	},
	get markdownSplitView() {
		return this.current?.markdownSplitView ?? false;
	},
	set markdownSplitView(val) {
		if (this.current) this.current.markdownSplitView = !!val;
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
	get formFields() {
		return this.current?.formFields || [];
	},
	set formFields(val) {
		if (this.current) this.current.formFields = val;
	},
	get formValues() {
		return this.current?.formValues || {};
	},
	set formValues(val) {
		if (this.current) this.current.formValues = val;
	},
	get hyperlinks() {
		return this.current?.hyperlinks || [];
	},
	set hyperlinks(val) {
		if (this.current) this.current.hyperlinks = val;
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
	get imageNativeWidth() {
		return this.current?.imageNativeWidth;
	},
	set imageNativeWidth(val) {
		if (this.current) this.current.imageNativeWidth = val;
	},
	get imageNativeHeight() {
		return this.current?.imageNativeHeight;
	},
	set imageNativeHeight(val) {
		if (this.current) this.current.imageNativeHeight = val;
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
		// After dropping/editing text: switching to any tool other than Select/Text
		// clears text selection (colour changes do not go through this setter).
		if (val === "select" || val === "text") return;
		const isTextSel = (s: { pageNumber: number; index: number } | null) => {
			if (!s) return false;
			return activeDoc.shapes[s.pageNumber]?.[s.index]?.type === "text";
		};
		if (isTextSel(selectedShape) || selectedShapes.some(isTextSel)) {
			selectedShape = null;
			selectedShapes = [];
		}
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
	get activeLineEnds() {
		return getActiveLineEnds();
	},
	set activeLineEnds(val) {
		setActiveLineEnds(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(
				activeDoc.shapes,
				selectedShapes,
				"lineEnds",
				val,
			)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				lineEnds: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeFontFamily() {
		return activeFontFamily;
	},
	set activeFontFamily(val) {
		activeFontFamily = val;
		defaultFont = val;
		persistTextSettings({ fontFamily: val });
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
		persistTextSettings({ alignment: val });
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
		activeFontFamily = val as typeof activeFontFamily;
		persistTextSettings({ fontFamily: val });
	},
	get defaultSize() {
		return defaultSize;
	},
	set defaultSize(val) {
		defaultSize = val;
		persistTextSettings({ size: val });
	},
	get defaultStyle() {
		return defaultStyle;
	},
	set defaultStyle(val) {
		defaultStyle = val;
		persistTextSettings({ style: val });
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
		// Prefer session map (sidebar reactivity) over doc field
		const cur = this.current;
		if (!cur) return {};
		const wsId = documentKey(cur);
		return sessionPageThumbs[wsId] || cur.pageThumbnailOverrides || {};
	},
	set pageThumbnailOverrides(val) {
		const cur = this.current;
		if (!cur) return;
		const wsId = documentKey(cur);
		const pages = val || {};
		cur.pageThumbnailOverrides = pages;
		// Keep session map in sync without touching openDocuments
		if (Object.keys(pages).length === 0) {
			if (sessionPageThumbs[wsId]) {
				const next = { ...sessionPageThumbs };
				delete next[wsId];
				sessionPageThumbs = next;
			}
		} else {
			sessionPageThumbs = { ...sessionPageThumbs, [wsId]: { ...pages } };
		}
	},

	get commentsFocusRequest() {
		return commentsFocusRequest;
	},
	set commentsFocusRequest(val) {
		commentsFocusRequest = val;
	},

	get commentsFocusThreadId() {
		return commentsFocusThreadId;
	},
	set commentsFocusThreadId(val) {
		commentsFocusThreadId = val;
	},

	get commentPinDraft() {
		return commentPinDraft;
	},
	set commentPinDraft(val) {
		commentPinDraft = val;
	},

	get openCommentPinId() {
		return openCommentPinId;
	},
	set openCommentPinId(val) {
		openCommentPinId = val;
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

	/** Close the currently active document (no dirty prompt). Prefer cleanupWorkspace. */
	flushDocumentState() {
		const id = activeDocumentId;
		if (!id) {
			// Still reclaim shared pdf.js if nothing is open
			openDocuments = [];
			activeDocumentId = null;
			resetSessionUiForDocumentSwitch();
			void destroySharedWorkspacePdf({ destroyWorker: true });
			return;
		}
		void cleanupWorkspace(id);
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

/**
 * Resample the active image document to target pixel size.
 * Updates rawBytes, imageUrl, and cachedDimensions; multi-document safe.
 * Scale (%) baseline (imageNative*) is preserved for the session.
 */
export async function applyImageResizeAction(
	targetWidth: number,
	targetHeight: number,
): Promise<boolean> {
	const doc = findOpenDocument(activeDocumentId);
	if (!doc || doc.fileType !== "image" || !doc.imageUrl) return false;

	const w = clampPx(targetWidth);
	const h = clampPx(targetHeight);
	const mime = mimeFromFileName(doc.filePath || doc.fileName);
	const bytes = await resampleImageToBytes(doc.imageUrl, w, h, mime);
	if (!bytes) return false;

	try {
		if (doc.imageUrl) {
			URL.revokeObjectURL(doc.imageUrl);
		}
	} catch {
		/* ignore */
	}

	doc.rawBytes = bytes;
	const blob = new Blob([bytes as BlobPart], { type: mime });
	doc.imageUrl = URL.createObjectURL(blob);
	doc.cachedDimensions = [{ width: w, height: h }];
	// Seed native baseline once if missing (e.g. load race)
	if (!doc.imageNativeWidth || !doc.imageNativeHeight) {
		doc.imageNativeWidth = w;
		doc.imageNativeHeight = h;
	}
	doc.isDirty = true;
	// Bump openDocuments so multi-tab UI re-reads the active slot
	openDocuments = [...openDocuments];
	return true;
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
	// Session rotation is baked into static thumbs — regenerate this page only.
	invalidatePageThumbnail(pageNumber);
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

/**
 * Add a bookmark for a page if missing (does not toggle/remove).
 * Used by the workspace icon compose flow so users type a title before commit.
 */
export function addBookmarkAction(pageNum: number, name = "") {
	if (pageNum < 1) return;
	const existing = activeDoc.bookmarks.findIndex((b) => b.pageNum === pageNum);
	if (existing !== -1) {
		const trimmed = name;
		activeDoc.bookmarks = activeDoc.bookmarks.map((b) =>
			b.pageNum === pageNum ? { ...b, name: trimmed } : b,
		);
		return;
	}
	activeDoc.bookmarks = [
		...activeDoc.bookmarks,
		{ pageNum, name: name ?? "" },
	];
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
export function requestCommentsPanel(
	pageNum: number,
	threadId: string | null = null,
) {
	activeDoc.currentPage = pageNum;
	commentsFocusRequest = pageNum;
	commentsFocusThreadId = threadId;
}

/**
 * Start a compose-before-commit pin placement (right-click "Add Comment Here").
 * Does not create a comment until the user posts text from the pin popout.
 */
export function beginCommentPinDraft(
	pageNum: number,
	x: number,
	y: number,
) {
	if (pageNum < 1) return;
	commentPinDraft = {
		pageNum,
		x: clampCommentPct(x),
		y: clampCommentPct(y),
	};
	openCommentPinId = null;
}

export function clearCommentPinDraft() {
	commentPinDraft = null;
}

export function setOpenCommentPinId(threadId: string | null) {
	openCommentPinId = threadId;
	if (threadId) commentPinDraft = null;
}

/**
 * Add a root comment on a page.
 * Optional `position` (page %) places a yellow flag at that point.
 * Returns the new comment id, or null if text is empty.
 */
export function addCommentAction(
	pageNum: number,
	text: string,
	position?: { x: number; y: number } | null,
): string | null {
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
	if (
		position &&
		typeof position.x === "number" &&
		typeof position.y === "number"
	) {
		next.x = clampCommentPct(position.x);
		next.y = clampCommentPct(position.y);
	}
	activeDoc.comments = [...(activeDoc.comments || []), next];
	activeDoc.isDirty = true;
	return id;
}

/** Update root comment text. Returns false if empty or not found. */
export function updateCommentAction(
	threadId: string,
	text: string,
): boolean {
	const clean = sanitizeCommentText(text);
	if (!clean || !threadId) return false;
	let found = false;
	activeDoc.comments = (activeDoc.comments || []).map((c) => {
		if (c.id !== threadId) return c;
		found = true;
		return { ...c, text: clean };
	});
	if (found) activeDoc.isDirty = true;
	return found;
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
	activeDoc.comments = (activeDoc.comments || []).filter(
		(c) => c.id !== threadId,
	);
	if ((activeDoc.comments?.length || 0) !== before) {
		activeDoc.isDirty = true;
	}
}

/** Update a single reply's text under a root thread. */
export function updateReplyAction(
	threadId: string,
	replyId: string,
	text: string,
): boolean {
	const clean = sanitizeCommentText(text);
	if (!clean || !threadId || !replyId) return false;
	let found = false;
	activeDoc.comments = (activeDoc.comments || []).map((c) => {
		if (c.id !== threadId) return c;
		return {
			...c,
			replies: (c.replies || []).map((r) => {
				if (r.id !== replyId) return r;
				found = true;
				return { ...r, text: clean };
			}),
		};
	});
	if (found) activeDoc.isDirty = true;
	return found;
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

/**
 * Write markdown source on the active tab and mark dirty.
 * No-op when saving, when the tab is not markdown, or when text is unchanged.
 */
export function setMarkdownSourceAction(next: string): boolean {
	if (isSaving) return false;
	const doc = findOpenDocument(activeDocumentId);
	if (!doc || doc.fileType !== "markdown") return false;
	const current = doc.markdownSource ?? "";
	if (current === next) return false;
	doc.markdownSource = next;
	doc.isDirty = true;
	return true;
}

/**
 * Toggle (or force) markdown source/preview split on the active tab.
 * Preview-only is the default. No-op for non-markdown documents.
 */
export function toggleMarkdownSplitView(force?: boolean): boolean {
	const doc = findOpenDocument(activeDocumentId);
	if (!doc || doc.fileType !== "markdown") return false;
	doc.markdownSplitView = force !== undefined ? !!force : !doc.markdownSplitView;
	return true;
}

/** Update a single AcroForm field value (text, checkbox, dropdown, or signature stamp data URL). */
export function setFormFieldValueAction(name: string, value: FormFieldValue) {
	if (!name) return;
	const prev = activeDoc.formValues || {};
	if (prev[name] === value) return;
	activeDoc.formValues = { ...prev, [name]: value };
	activeDoc.isDirty = true;
}

// True global master Wasm worker singleton to survive component unmounts
export const globalPdfWorkerInstance: { current: PdfJsWorker | null } = {
	current: null,
};
