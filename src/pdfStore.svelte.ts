export interface SharedDocumentState {
  rawBytes: Uint8Array | null;
  pageCount: number;
  currentPage: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isClickScrolling: boolean;
  rotations: Record<number, number>; // Maps pageIndex -> degrees (0, 90, 180, 270)
}

export const activeDoc = $state<SharedDocumentState>({
  rawBytes: null,
  pageCount: 0,
  currentPage: 1,
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
  isClickScrolling: false,
  rotations: {} 
});

export function rotatePageAction(pageNumber: number, direction: "clockwise" | "counter") {
  const currentRotation = activeDoc.rotations[pageNumber] ?? 0;
  const degreeShift = direction === "clockwise" ? 90 : -90;
  
  let targetDegree = (currentRotation + degreeShift) % 360;
  if (targetDegree < 0) targetDegree += 360; 
  
  // ⚡ FIX: Explicitly assign a shallow copy spread so Svelte 5 catches the state update instantly!
  activeDoc.rotations = {
    ...activeDoc.rotations,
    [pageNumber]: targetDegree
  };
}