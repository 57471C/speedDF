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
	activeTool:
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
	activeLineStyle: "solid" | "dashed" | "dotted" | "dash-dot";
	activeFontFamily: "Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono";
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

let activeTool = $state<SharedDocumentState["activeTool"]>("select");
let selectedShape = $state<SharedDocumentState["selectedShape"]>(null);
let selectedShapes = $state<SharedDocumentState["selectedShapes"]>([]);
let activeColor = $state("#000000");
let activeThickness = $state(3);
let activeLineStyle = $state<"solid" | "dashed" | "dotted" | "dash-dot">("solid");
let activeFontFamily = $state<"Helvetica" | "Times-Roman" | "Courier" | "Inter" | "JetBrainsMono">("Helvetica");
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

	// Global / session-wide properties
	get activeTool() { return activeTool; },
	set activeTool(val) { activeTool = val; },
	get selectedShape() { return selectedShape; },
	set selectedShape(val) { selectedShape = val; },
	get selectedShapes() { return selectedShapes; },
	set selectedShapes(val) { selectedShapes = val; },
	get activeColor() { return activeColor; },
	set activeColor(val) {
		activeColor = val;
		if (selectedShapes.length > 0) {
			const needsUpdate = selectedShapes.some((s) => {
				const shape = activeDoc.shapes[s.pageNumber]?.[s.index];
				return shape && shape.color !== val;
			});
			if (needsUpdate) {
				pushHistorySnapshot();
				selectedShapes.forEach((s) => {
					const list = [...(activeDoc.shapes[s.pageNumber] || [])];
					if (list[s.index]) {
						list[s.index] = {
							...list[s.index],
							color: val,
							textColor: val,
						};
						activeDoc.shapes = {
							...activeDoc.shapes,
							[s.pageNumber]: list,
						};
					}
				});
				activeDoc.isDirty = true;
			}
		}
	},
	get activeThickness() { return activeThickness; },
	set activeThickness(val) {
		activeThickness = val;
		if (selectedShapes.length > 0) {
			const needsUpdate = selectedShapes.some((s) => {
				const shape = activeDoc.shapes[s.pageNumber]?.[s.index];
				return shape && shape.thickness !== val;
			});
			if (needsUpdate) {
				pushHistorySnapshot();
				selectedShapes.forEach((s) => {
					const list = [...(activeDoc.shapes[s.pageNumber] || [])];
					if (list[s.index]) {
						list[s.index] = {
							...list[s.index],
							thickness: val,
						};
						activeDoc.shapes = {
							...activeDoc.shapes,
							[s.pageNumber]: list,
						};
					}
				});
				activeDoc.isDirty = true;
			}
		}
	},
	get activeLineStyle() { return activeLineStyle; },
	set activeLineStyle(val) {
		activeLineStyle = val;
		if (selectedShapes.length > 0) {
			const needsUpdate = selectedShapes.some((s) => {
				const shape = activeDoc.shapes[s.pageNumber]?.[s.index];
				return shape && shape.lineStyle !== val;
			});
			if (needsUpdate) {
				pushHistorySnapshot();
				selectedShapes.forEach((s) => {
					const list = [...(activeDoc.shapes[s.pageNumber] || [])];
					if (list[s.index]) {
						list[s.index] = {
							...list[s.index],
							lineStyle: val,
						};
						activeDoc.shapes = {
							...activeDoc.shapes,
							[s.pageNumber]: list,
						};
					}
				});
				activeDoc.isDirty = true;
			}
		}
	},
	get activeFontFamily() { return activeFontFamily; },
	set activeFontFamily(val) {
		activeFontFamily = val;
		if (selectedShapes.length > 0) {
			const needsUpdate = selectedShapes.some((s) => {
				const shape = activeDoc.shapes[s.pageNumber]?.[s.index];
				return shape && shape.fontFamily !== val;
			});
			if (needsUpdate) {
				pushHistorySnapshot();
				selectedShapes.forEach((s) => {
					const list = [...(activeDoc.shapes[s.pageNumber] || [])];
					if (list[s.index]) {
						list[s.index] = {
							...list[s.index],
							fontFamily: val,
							font: val, // Keep in sync for compatibility
						};
						activeDoc.shapes = {
							...activeDoc.shapes,
							[s.pageNumber]: list,
						};
					}
				});
				activeDoc.isDirty = true;
			}
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

	flushDocumentState() {
		if (this.imageUrl) {
			URL.revokeObjectURL(this.imageUrl);
		}
		openDocuments = openDocuments.filter(d => d.filePath !== activeDocumentId && d.fileName !== activeDocumentId);
		activeDocumentId = openDocuments[0]?.filePath || openDocuments[0]?.fileName || null;
	}
};

// ⚡ SURGICAL INSERTION: Append this directly below your "export const activeDoc = ..." declaration block

interface HistorySnapshot {
	shapes: Record<number, AnnotationShape[]>;
	pageOrder: number[];
}

// Memory-tracked transaction arrays
export const undoStack = $state<HistorySnapshot[]>([]);
export const redoStack = $state<HistorySnapshot[]>([]);

/**
 * ⏳ Commits a deep-cloned historical snapshot of the current canvas layout state onto the undo stack.
 * Call this immediately BEFORE executing any document mutation (drawing, deleting, reordering).
 */
export function pushHistorySnapshot() {
	activeDoc.isDirty = true;
	const snapshot: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes)),
		pageOrder: [...activeDoc.pageOrder],
	};
	undoStack.push(snapshot);

	// A new user action always invalidates and clears the forward redo stack path
	if (redoStack.length > 0) {
		redoStack.length = 0;
	}
}

/**
 * 🔄 Pops the last committed snapshot out of the undo stack and restores it safely.
 */
export function executeUndoAction() {
	if (undoStack.length === 0) return;

	const currentStatus: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes)),
		pageOrder: [...activeDoc.pageOrder],
	};
	redoStack.push(currentStatus);

	const previousState = undoStack.pop();
	if (previousState) {
		activeDoc.shapes = previousState.shapes;
		activeDoc.pageOrder = previousState.pageOrder;
		activeDoc.selectedShape = null;
	}
}

/**
 * ➡️ Pops the last state out of the redo stack and shifts the application forward.
 */
export function executeRedoAction() {
	if (redoStack.length === 0) return;

	const currentStatus: HistorySnapshot = {
		shapes: structuredClone($state.snapshot(activeDoc.shapes)),
		pageOrder: [...activeDoc.pageOrder],
	};
	undoStack.push(currentStatus);

	const nextState = redoStack.pop();
	if (nextState) {
		activeDoc.shapes = nextState.shapes;
		activeDoc.pageOrder = nextState.pageOrder;
		activeDoc.selectedShape = null;
	}
}

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
