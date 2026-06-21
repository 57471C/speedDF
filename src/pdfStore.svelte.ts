export interface AnnotationShape {
  type: "rect" | "text" | "tick" | "dash" | "signature" | "initial" | "highlight" | "round-rect" | "oval" | "rect-fill" | "round-rect-fill" | "oval-fill";
  x: number;                            // Percentage coordinate left (0-100)
  y: number;                            // Percentage coordinate top (0-100)
  width?: number;                       // Percentage width layout bounds
  height?: number;                      // Percentage height layout bounds
  text?: string;                        // Text payload string (for text boxes)
  dataUrl?: string;                     // Base64 PNG image stream string (for signatures)
  points?: { x: number; y: number }[];  // Array of percentage nodes tracking freehand highlighters
  color?: string;                       // Captures the unique hexadecimal ink value
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
  activeTool: "select" | "text" | "rect" | "tick" | "dash" | "signature" | "initial" | "highlight" | "rotate" | "round-rect" | "oval" | "rect-fill" | "round-rect-fill" | "oval-fill" | null;
  shapes: Record<number, AnnotationShape[]>;
  selectedShape: { pageNumber: number; index: number } | null;
  savedSignatureSets: SignatureSet[];
  activeStampDataUrl: string | null;
  pageOrder: number[];
  fileName: string | null;
  filePath: string | null;
  activeColor: string;
}

const loadSavedSets = (): SignatureSet[] => {
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
  savedSignatureSets: loadSavedSets(),
  activeStampDataUrl: null,
  pageOrder: [],
  fileName: null,
  filePath: null,
  activeColor: "#000000"
});

// ⚡ SURGICAL INSERTION: Append this directly below your "export const activeDoc = ..." declaration block

interface HistorySnapshot {
  shapes: Record<number, AnnotationShape[]>;
  pageOrder: number[];
}

// Memory-tracked transaction arrays
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];

/**
 * ⏳ Commits a deep-cloned historical snapshot of the current canvas layout state onto the undo stack.
 * Call this immediately BEFORE executing any document mutation (drawing, deleting, reordering).
 */
export function pushHistorySnapshot() {
  const snapshot: HistorySnapshot = {
    shapes: JSON.parse(JSON.stringify(activeDoc.shapes)),
    pageOrder: [...activeDoc.pageOrder]
  };
  undoStack.push(snapshot);
  
  // A new user action always invalidates and clears the forward redo stack path
  if (redoStack.length > 0) {
    redoStack = [];
  }
}

/**
 * 🔄 Pops the last committed snapshot out of the undo stack and restores it safely.
 */
export function executeUndoAction() {
  if (undoStack.length === 0) return;

  const currentStatus: HistorySnapshot = {
    shapes: JSON.parse(JSON.stringify(activeDoc.shapes)),
    pageOrder: [...activeDoc.pageOrder]
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
    shapes: JSON.parse(JSON.stringify(activeDoc.shapes)),
    pageOrder: [...activeDoc.pageOrder]
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
  localStorage.setItem("speeddf_signature_sets", JSON.stringify(activeDoc.savedSignatureSets));
}

export function rotatePageAction(pageNumber: number, direction: "clockwise" | "counter") {
  const currentRotation = activeDoc.rotations[pageNumber] ?? 0;
  const degreeShift = direction === "clockwise" ? 90 : -90;
  let targetDegree = (currentRotation + degreeShift) % 360;
  if (targetDegree < 0) targetDegree += 360;

  activeDoc.rotations = {
    ...activeDoc.rotations,
    [pageNumber]: targetDegree
  };
}