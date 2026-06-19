export interface AnnotationShape {
  type: "rect" | "text" | "tick" | "dash" | "signature" | "initial"; 
  x: number;       // Percentage coordinate left (0-100)
  y: number;       // Percentage coordinate top (0-100)
  width?: number;  // Percentage width 
  height?: number; // Percentage height 
  text?: string;   // Text payload (for text boxes)
  dataUrl?: string; // ⚡ Base64 Image Payload (for signatures & initials)
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
  activeTool: "select" | "text" | "rect" | "tick" | "dash" | "signature" | "initial" | "rotate" | null; 
  shapes: Record<number, AnnotationShape[]>; 
  selectedShape: { pageNumber: number; index: number } | null;
  savedSignatureSets: SignatureSet[];
  activeStampDataUrl: string | null;
  pageOrder: number[];
  fileName: string | null;
}

// Helper tracking wrapper to safely populate baseline memory slots from localStorage on boot
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
  fileName: null
});

// Watcher method to persist signature data slots onto disk space dynamically
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