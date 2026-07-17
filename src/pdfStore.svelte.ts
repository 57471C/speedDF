import {
	bindHistoryDocument,
	pushHistorySnapshot,
	executeUndoAction,
	executeRedoAction,
	undoStack,
	redoStack,
} from "./lib/stores/history.svelte";
import {
	getActiveTool,
	setActiveTool,
	getActiveColor,
	setActiveColor,
	getActiveThickness,
	setActiveThickness,
	getActiveLineStyle,
	setActiveLineStyle,
	type ActiveTool,
	type ActiveLineStyle,
} from "./lib/stores/tools.svelte";
import {
	selectionNeedsPropertyUpdate,
	patchSelectedShapes,
} from "./lib/annotation/shapeHelpers";

// Re-export history API so existing `from "../pdfStore.svelte"` imports keep working.
export {
	pushHistorySnapshot,
	executeUndoAction,
	executeRedoAction,
	undoStack,
	redoStack,
};

// Re-export tool types for consumers that want them without deep imports.
export type { ActiveTool, ActiveLineStyle };

export interface TextShape {
	id: string;
	type: "text";
	text: string;
	x: number;
	y: number;
	fontSize: number;
	fontFamily: "Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono";
	color: string;
	opacity: number;
	alignment?: 'left' | 'center' | 'right';
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
	fontFamily?: "Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono";
	alignment?: 'left' | 'center' | 'right';
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
	imageRotation?: number;
	imageUrl?: string | null;
	isDirty: boolean;
	tiffPages: Uint8Array[];
	rotations: Record<number, number>;
	cachedDimensions?: { width: number; height: number }[];
}

export interface SignatureSet {
	id: string;
	signatureDataUrl: string;
	initialDataUrl: string;
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
	activeFontFamily: "Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono";
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
	openDocuments: DocumentWorkspace[];
	activeDocumentId: string | null;
	readonly current: DocumentWorkspace | null;
	recents: RecentFile[];
	thumbnailVersion: number;
	pageThumbnailOverrides: Record<number, string>;
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
let activeFontFamily = $state<"Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono">("Helvetica");
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
	} catch (e) {}
	return [];
}
let recents = $state<RecentFile[]>(loadRecents());
let thumbnailVersion = $state(0);
let pageThumbnailOverrides = $state<Record<number, string>>({});

export function initializeNewDocument(fileName: string, filePath: string | null) {
	const existing = openDocuments.find(d => (filePath && d.filePath === filePath) || d.fileName === fileName);
	if (existing) {
		activeDocumentId = existing.filePath || existing.fileName;
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
		imageRotation: 0,
		imageUrl: null,
		isDirty: false,
		tiffPages: [],
		rotations: {}
	};
	openDocuments.push(newDoc);
	activeDocumentId = filePath || fileName;
	pageThumbnailOverrides = {};
	return newDoc;
}

export const activeDoc: SharedDocumentState = {
	get openDocuments() { return openDocuments; },
	set openDocuments(val) { openDocuments = val; },
	get activeDocumentId() { return activeDocumentId; },
	set activeDocumentId(val) { activeDocumentId = val; },

	// The active pointer target locator
	get current() {
		return openDocuments.find(d => d.filePath === activeDocumentId || d.fileName === activeDocumentId) || null;
	},

	// Proxy all existing properties safely to prevent breaking views
	get fileType() { return this.current?.fileType || null; },
	set fileType(val) { if (this.current) this.current.fileType = val; },
	get fileName() { return this.current?.fileName || ""; },
	set fileName(val) { if (this.current) this.current.fileName = val; },
	get filePath() { return this.current?.filePath || null; },
	set filePath(val) { if (this.current) this.current.filePath = val; },
	get rawBytes() { return this.current?.rawBytes || null; },
	set rawBytes(val) { if (this.current) this.current.rawBytes = val; },
	get pageCount() { return this.current?.pageCount || 0; },
	set pageCount(val) { if (this.current) this.current.pageCount = val; },
	get pageOrder() { return this.current?.pageOrder || []; },
	set pageOrder(val) { if (this.current) this.current.pageOrder = val; },
	get currentPage() { return this.current?.currentPage || 1; },
	set currentPage(val) { if (this.current) this.current.currentPage = val; },
	get shapes() { return this.current?.shapes || {}; },
	set shapes(val) { if (this.current) this.current.shapes = val; },
	get bookmarks() { return this.current?.bookmarks || []; },
	set bookmarks(val) { if (this.current) this.current.bookmarks = val; },
	get imageRotation() { return this.current?.imageRotation || 0; },
	set imageRotation(val) { if (this.current) this.current.imageRotation = val; },
	get imageUrl() { return this.current?.imageUrl || ""; },
	set imageUrl(val) { if (this.current) this.current.imageUrl = val; },
	get isDirty() { return this.current?.isDirty || false; },
	set isDirty(val) { if (this.current) this.current.isDirty = val; },
	get tiffPages() { return this.current?.tiffPages || []; },
	set tiffPages(val) { if (this.current) this.current.tiffPages = val; },
	get rotations() { return this.current?.rotations || {}; },
	set rotations(val) { if (this.current) this.current.rotations = val; },

	// Global / session-wide tool + stroke style (lib/stores/tools.svelte.ts)
	get activeTool() { return getActiveTool(); },
	set activeTool(val) { setActiveTool(val); },
	get selectedShape() { return selectedShape; },
	set selectedShape(val) { selectedShape = val; },
	get selectedShapes() { return selectedShapes; },
	set selectedShapes(val) { selectedShapes = val; },
	get activeColor() { return getActiveColor(); },
	set activeColor(val) {
		setActiveColor(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(activeDoc.shapes, selectedShapes, "color", val)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				color: val,
				textColor: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeThickness() { return getActiveThickness(); },
	set activeThickness(val) {
		setActiveThickness(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(activeDoc.shapes, selectedShapes, "thickness", val)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				thickness: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeLineStyle() { return getActiveLineStyle(); },
	set activeLineStyle(val) {
		setActiveLineStyle(val);
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(activeDoc.shapes, selectedShapes, "lineStyle", val)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				lineStyle: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get activeFontFamily() { return activeFontFamily; },
	set activeFontFamily(val) {
		activeFontFamily = val;
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(activeDoc.shapes, selectedShapes, "fontFamily", val)
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
	get activeTextAlignment() { return activeTextAlignment; },
	set activeTextAlignment(val) {
		activeTextAlignment = val;
		if (
			selectedShapes.length > 0 &&
			selectionNeedsPropertyUpdate(activeDoc.shapes, selectedShapes, "alignment", val)
		) {
			pushHistorySnapshot();
			activeDoc.shapes = patchSelectedShapes(activeDoc.shapes, selectedShapes, {
				alignment: val,
			});
			activeDoc.isDirty = true;
		}
	},
	get zoomScale() { return zoomScale; },
	set zoomScale(val) { zoomScale = val; },
	get defaultFont() { return defaultFont; },
	set defaultFont(val) { defaultFont = val; },
	get defaultSize() { return defaultSize; },
	set defaultSize(val) { defaultSize = val; },
	get defaultStyle() { return defaultStyle; },
	set defaultStyle(val) { defaultStyle = val; },
	get scrollTop() { return scrollTop; },
	set scrollTop(val) { scrollTop = val; },
	get scrollHeight() { return scrollHeight; },
	set scrollHeight(val) { scrollHeight = val; },
	get clientHeight() { return clientHeight; },
	set clientHeight(val) { clientHeight = val; },
	get isClickScrolling() { return isClickScrolling; },
	set isClickScrolling(val) { isClickScrolling = val; },
	get activeStampDataUrl() { return activeStampDataUrl; },
	set activeStampDataUrl(val) { activeStampDataUrl = val; },
	get savedSignatureSets() { return savedSignatureSets; },
	set savedSignatureSets(val) { savedSignatureSets = val; },

	get recents() { return recents; },
	set recents(val) { recents = val; },

	get thumbnailVersion() { return thumbnailVersion; },
	set thumbnailVersion(val) { thumbnailVersion = val; },

	get pageThumbnailOverrides() { return pageThumbnailOverrides; },
	set pageThumbnailOverrides(val) { pageThumbnailOverrides = val; },

	updateRecentThumbnail(filePath: string, thumbnailDataUrl: string) {
		try {
			if (this.recents && Array.isArray(this.recents)) {
				const targetIndex = this.recents.findIndex((item: any) => item.path === filePath);
				if (targetIndex !== -1) {
					// 1. Completely replace the object slot reference with a spread clone copy
					this.recents[targetIndex] = {
						...this.recents[targetIndex],
						thumbnail: thumbnailDataUrl,
						lastOpened: Date.now(),
						timestamp: Date.now()
					};
					
					// 2. Force-reassign the array pointer to trigger Svelte 5 template updates instantly
					this.recents = [...this.recents];
					
					// 3. Increment our global version token to tell the side navigation to repaint
					this.thumbnailVersion++;
					
					console.log(`🚀 Reactive store array reassigned. Thumbnail version bumped to: ${this.thumbnailVersion}`);
				}
			}

			// Mirror updates cleanly down to localStorage persistence sync
			const globalRecentsRaw = localStorage.getItem('speeddf_recents');
			if (globalRecentsRaw) {
				let recentsList = JSON.parse(globalRecentsRaw);
				if (Array.isArray(recentsList)) {
					const dbIndex = recentsList.findIndex((item: any) => item.path === filePath);
					if (dbIndex !== -1) {
						recentsList[dbIndex].thumbnail = thumbnailDataUrl;
						recentsList[dbIndex].lastOpened = Date.now();
						recentsList[dbIndex].timestamp = Date.now();
						localStorage.setItem('speeddf_recents', JSON.stringify(recentsList));
						console.log("🚀 Persistent localStorage dashboard sync verified.");
					}
				}
			}
		} catch (err) {
			console.warn("Failed to update central dashboard thumbnail arrays:", err);
		}
	},

	flushDocumentState() {
		if (this.imageUrl) {
			URL.revokeObjectURL(this.imageUrl);
		}
		openDocuments = openDocuments.filter(d => d.filePath !== activeDocumentId && d.fileName !== activeDocumentId);
		activeDocumentId = openDocuments[0]?.filePath || openDocuments[0]?.fileName || null;
		pageThumbnailOverrides = {};
	}
};

// Bind undo/redo to the active document facade (must run after activeDoc exists).
bindHistoryDocument(activeDoc);

export function saveSignatureSetAction(newSet: SignatureSet) {
	activeDoc.savedSignatureSets = [...activeDoc.savedSignatureSets, newSet];
	localStorage.setItem(
		"speeddf_signature_sets",
		JSON.stringify(activeDoc.savedSignatureSets),
	);
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
	const index = activeDoc.bookmarks.findIndex(b => b.pageNum === pageNum);
	if (index !== -1) {
		activeDoc.bookmarks = activeDoc.bookmarks.filter(b => b.pageNum !== pageNum);
	} else {
		activeDoc.bookmarks = [...activeDoc.bookmarks, { pageNum, name: "" }];
	}
}

export function deleteBookmarkAction(pageNum: number) {
	activeDoc.bookmarks = activeDoc.bookmarks.filter(b => b.pageNum !== pageNum);
}

export function updateBookmarkNameAction(pageNum: number, newName: string) {
	activeDoc.bookmarks = activeDoc.bookmarks.map(b =>
		b.pageNum === pageNum ? { ...b, name: newName } : b
	);
}

// True global master Wasm worker singleton to survive component unmounts
export const globalPdfWorkerInstance = {
	current: null as any
};
