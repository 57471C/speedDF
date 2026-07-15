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
}

export interface Bookmark {
	pageNum: number;
	name: string;
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
	zoomScale: number;
	defaultFont: string;
	defaultSize: number;
	defaultStyle: "Normal" | "Bold" | "Italic";
	fileType: "pdf" | "tiff" | "image" | null;
	imageUrl?: string | null;
	tiffPages: Uint8Array[];
	flushDocumentState(): void;
	isDirty: boolean;
	bookmarks: Bookmark[];
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
	Courier: {
		css: "'Courier New', Courier, monospace",
		pdf: {
			Normal: "Courier",
			Bold: "Courier-Bold",
			Italic: "Courier-Oblique",
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

export const activeDoc = $state<SharedDocumentState>({
	rawBytes: null,
	pageCount: 0,
	currentPage: 1,
	scrollTop: 0,
	scrollHeight: 0,
	clientHeight: 0,
	isClickScrolling: false,
	rotations: {},
	activeTool: "select",
	shapes: {},
	selectedShape: null,
	selectedShapes: [],
	savedSignatureSets: loadSavedSets(),
	activeStampDataUrl: null,
	pageOrder: [],
	fileName: null,
	filePath: null,
	activeColor: "#000000",
	activeThickness: 3, // Default stroke width for pens and shape borders
	zoomScale: 120,
	defaultFont: "Helvetica",
	defaultSize: 12,
	defaultStyle: "Normal",
	fileType: "pdf",
	imageUrl: null,
	tiffPages: [],
	isDirty: false,
	bookmarks: [],
	flushDocumentState() {
		if (this.imageUrl) {
			URL.revokeObjectURL(this.imageUrl);
			this.imageUrl = null;
		}
		this.rawBytes = null;
		this.fileType = null;
		this.fileName = "";
		this.filePath = "";
		this.pageCount = 0;
		this.tiffPages = [];
		this.pageOrder = [];
		this.rotations = {};
		this.shapes = {};
		this.selectedShape = null;
		this.selectedShapes = [];
		this.isDirty = false;
		this.bookmarks = [];
		console.log(
			"Global Store: Flushed old document structures. Ready for clean initialization.",
		);
	},
});

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
