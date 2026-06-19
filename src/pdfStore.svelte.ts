export interface AnnotationShape {
  type: "rect" | "text" | "tick" | "dash" | "signature" | "initial" | "highlight"; 
  x: number;                            // Percentage coordinate left (0-100)
  y: number;                            // Percentage coordinate top (0-100)
  width?: number;                       // Percentage width layout bounds
  height?: number;                      // Percentage height layout bounds
  text?: string;                        // Text payload string (for text boxes)
  dataUrl?: string;                     // Base64 PNG image stream string (for signatures)
  points?: { x: number; y: number }[];  // Array of percentage nodes tracking freehand highlighters
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
  activeTool: "select" | "text" | "rect" | "tick" | "dash" | "signature" | "initial" | "highlight" | "rotate" | null; 
  shapes: Record<number, AnnotationShape[]>; 
  selectedShape: { pageNumber: number; index: number } | null;
  savedSignatureSets: SignatureSet[];
  activeStampDataUrl: string | null;
  pageOrder: number[];
  fileName: string | null;
}

// Safely pull previous signature profiles from disk storage map on startup
const loadSavedSets = (): SignatureSet[] => {
  try {
    const raw = localStorage.getItem("speeddf_signature_sets");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

// Global reactive single-source of truth state engine
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
  fileName: null
});

/**
 * Commits a newly drawn signature set template profile straight to reactive state and local disk storage memory
 */
export function saveSignatureSetAction(newSet: SignatureSet) {
  activeDoc.savedSignatureSets = [...activeDoc.savedSignatureSets, newSet];
  localStorage.setItem("speeddf_signature_sets", JSON.stringify(activeDoc.savedSignatureSets));
}

/**
 * Applies or advances rotation attributes matching target page numbers dynamically
 */
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