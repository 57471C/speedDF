<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import {
    activeDoc,
    pushHistorySnapshot,
    updateBookmarkNameAction,
    deleteBookmarkAction,
    addBookmarkAction,
    addCommentAction,
    requestCommentsPanel,
  } from "../pdfStore.svelte";
  import {
    createPageInteraction,
    isBoxShapeTool,
    SHAPE_TYPES_LIST,
  } from "../lib/interaction/dragHandler.svelte";
  import { createPageRenderer } from "../lib/render/pageRenderer";
  import {
    cleanupPdfPage,
    getSharedWorkspacePdf,
  } from "../lib/render/sharedPdfDocument";
  import { getGhostDimensions } from "../lib/annotation/ghostDimensions";
  import { STROKE_DASHARRAYS } from "../lib/annotation/strokeStyles";
  import { pageHasComments, countComments, commentsForPage, formatCommentTime } from "../lib/comments/comments";
  import { autoGrowTextarea } from "../lib/interaction/autoGrowTextarea";
  import AnnotationLayer from "./AnnotationLayer.svelte";
  import FormLayer from "./FormLayer.svelte";
  import LinkLayer from "./LinkLayer.svelte";

  let { bytes, pageNumber, zoomScale, isSystemPrinting = false, scrollObserver } = $props<{
    bytes: Uint8Array;
    pageNumber: number;
    zoomScale: number;
    isSystemPrinting?: boolean;
    scrollObserver: IntersectionObserver | null;
  }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let pageContainer = $state<HTMLDivElement | null>(null);
  let textLayerElement = $state<HTMLDivElement | null>(null);

  const strokeDasharrays = STROKE_DASHARRAYS;

  let isPreloaded = $state(false); // Tracks metadata visibility (Wide)
  let isRendered = $state(false);  // Tracks canvas paint visibility (Tight)

  // Seed from cached layout dimensions for instant skeleton hydration, fallback to standard letter/A4
  const cachedDim = $derived.by(() => activeDoc.current?.cachedDimensions?.[pageNumber - 1]);
  let basePageWidth = $state<number>(612);
  let basePageHeight = $state<number>(792);
  let loadedDimensions = $state(false);

  // Apply cached dimensions on initialization if available; also re-sync when
  // image resize updates cachedDimensions for the active image document.
  $effect(() => {
    if (cachedDim) {
      basePageWidth = cachedDim.width;
      basePageHeight = cachedDim.height;
      if (!loadedDimensions) loadedDimensions = true;
    }
  });

  // Calculate the current expected width and height (CSS pixels)
  // based on current zoomScale and rotations
  const expectedDimensions = $derived.by(() => {
    const scale = Math.max(0.1, zoomScale / 100);
    const rotationAngle = activeDoc.fileType === "image"
      ? (activeDoc.imageRotation ?? 0)
      : (activeDoc.rotations[pageNumber] ?? 0);
    const totalRotation = rotationAngle % 360;
    
    // If rotated by 90 or 270 degrees, swap width and height
    const isStandardPortrait = (totalRotation / 90) % 2 === 0;
    const w = isStandardPortrait ? basePageWidth : basePageHeight;
    const h = isStandardPortrait ? basePageHeight : basePageWidth;
    
    return {
      width: w * scale,
      height: h * scale,
      aspectRatio: Math.max(0.1, w / Math.max(0.1, Math.abs(h)))
    };
  });

  const rotation = $derived(activeDoc.fileType === 'image' ? (activeDoc.imageRotation || 0) : 0);
  const isRotated90 = $derived(rotation === 90 || rotation === 270);
  const currentWidth = $derived(isRotated90 ? basePageHeight : basePageWidth);
  const currentHeight = $derived(isRotated90 ? basePageWidth : basePageHeight);
  const scaleFactor = $derived(zoomScale / 100);

  // Load page dimensions initially to get aspect ratio
  $effect(() => {
    if (bytes && pageNumber && !loadedDimensions) {
      if (activeDoc.fileType === "image") {
        if (activeDoc.imageUrl) {
          const img = new Image();
          img.onload = () => {
            basePageWidth = img.naturalWidth || img.width;
            basePageHeight = img.naturalHeight || img.height;
            loadedDimensions = true;
          };
          img.src = activeDoc.imageUrl;
        }
        return;
      }
      if (activeDoc.fileType === "tiff") {
        const pageData = activeDoc.tiffPages[pageNumber - 1];
        if (pageData) {
          const blob = new Blob([pageData as any], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            basePageWidth = img.width;
            basePageHeight = img.height;
            loadedDimensions = true;
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }
        return;
      }
      if (isPreloaded) {
        // Prefer shared workspace PDF — never getDocument() per page for layout.
        let cancelled = false;
        void getSharedWorkspacePdf(bytes)
          .then(async (pdfDocument) => {
            if (cancelled || !pdfDocument || loadedDimensions) return;
            const page = await pdfDocument.getPage(pageNumber);
            try {
              if (cancelled || loadedDimensions) return;
              const viewport = page.getViewport({ scale: 1 });
              basePageWidth = viewport.width;
              basePageHeight = viewport.height;
              loadedDimensions = true;
            } finally {
              cleanupPdfPage(page);
            }
          })
          .catch((err) => {
            if (!cancelled) {
              console.error("Failed to load page dimensions:", err);
            }
          });
        return () => {
          cancelled = true;
        };
      }
    }
  });

  // Short-circuit the page observers/render state during printing
  $effect(() => {
    if (isSystemPrinting) {
      isPreloaded = true;
      isRendered = true;
    }
  });

  // Local shadow cache variables to isolate toolbar modification actions
  let lastToolbarColor = activeDoc.activeColor;
  let lastToolbarThickness = activeDoc.activeThickness;

  $effect(() => {
    const currentColor = activeDoc.activeColor;
    const currentThickness = activeDoc.activeThickness;

    // Execute updates ONLY if a tool value has explicitly changed in the toolbar
    if (currentColor !== lastToolbarColor || currentThickness !== lastToolbarThickness) {
      if (activeDoc.selectedShape && activeDoc.selectedShape.pageNumber === pageNumber) {
        const index = activeDoc.selectedShape.index;
        const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
        const shape = shapesList[index];

        if (shape) {
          let isUpdated = false;

          // Update color if supported by the shape type and it changed
          if (currentColor !== lastToolbarColor) {
            if (shape.type === "text") {
              shape.color = currentColor;
              shape.textColor = currentColor;
              isUpdated = true;
            } else if ('color' in shape || shape.type === "tick" || shape.type === "dash" || shape.type === "pen" || shape.type.includes("rect") || shape.type.includes("oval")) {
              shape.color = currentColor;
              isUpdated = true;
            }
          }

          // Update line thickness if supported by the shape type and it changed
          if (currentThickness !== lastToolbarThickness && 'thickness' in shape) {
            shape.thickness = currentThickness;
            isUpdated = true;
          }

          // Commit changes to the global Svelte store proxy array if modified
          if (isUpdated) {
            activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
          }
        }
      }
    }

    // Synchronize caches to track the next interaction loop
    // Wrapped in untrack to prevent these write-backs from re-triggering this effect
    untrack(() => {
      lastToolbarColor = currentColor;
      lastToolbarThickness = currentThickness;
    });
  });

  const shapeTypesList = SHAPE_TYPES_LIST as readonly string[];

  let ghostDimensions = $derived.by(() => getGhostDimensions(activeDoc.activeTool));

  let pageHasCommentThreads = $derived(pageHasComments(activeDoc.comments, pageNumber));
  let pageComments = $derived(commentsForPage(activeDoc.comments, pageNumber));
  let pageCommentCount = $derived(countComments(pageComments));

  // Comment popout (mirrors bookmark hover/edit popout next to the icon)
  let commentHovered = $state(false);
  let commentComposing = $state(false);
  let commentDraft = $state("");

  // Bookmark rail: click-to-compose for empty; hover only when a bookmark exists
  let bookmarkHovered = $state(false);
  let bookmarkComposing = $state(false);
  let bookmarkDraft = $state("");
  let bookmarkInputEl = $state<HTMLInputElement | null>(null);

  let pageHasBookmark = $derived(
    (activeDoc.bookmarks || []).some((b) => b.pageNum === pageNumber),
  );
  let pageBookmark = $derived(
    (activeDoc.bookmarks || []).find((b) => b.pageNum === pageNumber) ?? null,
  );

  function submitPageComment() {
    const id = addCommentAction(pageNumber, commentDraft);
    if (id) {
      commentDraft = "";
      commentComposing = false;
    }
  }

  /** Open compose popout and focus the title field (does not commit yet). */
  async function openBookmarkCompose(seedName = "") {
    bookmarkComposing = true;
    bookmarkHovered = true;
    bookmarkDraft = seedName;
    await tick();
    bookmarkInputEl?.focus();
    bookmarkInputEl?.select();
  }

  function saveBookmarkCompose() {
    const name = bookmarkDraft.trim();
    if (pageHasBookmark) {
      updateBookmarkNameAction(pageNumber, name);
    } else {
      addBookmarkAction(pageNumber, name);
    }
    bookmarkComposing = false;
    bookmarkDraft = "";
  }

  function cancelBookmarkCompose() {
    bookmarkComposing = false;
    bookmarkDraft = "";
    if (!pageHasBookmark) {
      bookmarkHovered = false;
    }
  }

  // Drag / selection / pointer interaction (extracted; behaviour unchanged)
  const ix = createPageInteraction({
    getPageNumber: () => pageNumber,
    getPageContainer: () => pageContainer,
    getBasePageWidth: () => basePageWidth,
    getBasePageHeight: () => basePageHeight,
    getZoomScale: () => zoomScale,
    getGhostDimensions: () => ghostDimensions,
  });

  // PDF.js canvas + text layer paint pipeline (extracted; behaviour unchanged)
  const pageRenderer = createPageRenderer({
    getPageNumber: () => pageNumber,
    getZoomScale: () => zoomScale,
    getBasePageWidth: () => basePageWidth,
    getBasePageHeight: () => basePageHeight,
    getIsSystemPrinting: () => isSystemPrinting,
    setCanvasElement: (el) => {
      canvasElement = el;
    },
    getTextLayerElement: () => textLayerElement,
  });
  const canvasLifecycle = pageRenderer.canvasLifecycle;

  // Lifecycle protection for animation frames in Svelte 5
  $effect(() => {
    return () => {
      ix.cancelAnimation();
    };
  });

  // Leaving Select/Text tools ends in-page text edit sessions (selection is cleared in the store)
  $effect(() => {
    const tool = activeDoc.activeTool;
    if (tool !== "select" && tool !== "text" && ix.activelyEditingIndex !== null) {
      ix.activelyEditingIndex = null;
    }
  });

  $effect(() => {
    const degrees = activeDoc.fileType === "image"
      ? (activeDoc.imageRotation ?? 0)
      : (activeDoc.rotations[pageNumber] ?? 0);
    // Read textLayerElement here so the effect re-runs once the overlay mounts
    const textLayer = textLayerElement;
    if (isRendered && bytes && canvasElement && zoomScale) {
      void pageRenderer.renderPageSheet(
        bytes,
        pageNumber,
        zoomScale,
        canvasElement,
        degrees,
        textLayer,
      );
    }
    // Cancel in-flight pdf.js paint when zoom/rotation/bytes/canvas deps change or unmount.
    return () => {
      void pageRenderer.cancelInFlight();
    };
  });

  $effect(() => {
    if (!isRendered && !isSystemPrinting) {
      void pageRenderer.releaseWhenUnrendered();
    }
  });

  // Interaction API (pointer events — mouse, touch, and Surface Pen / stylus)
  const handlePointerDown = ix.handlePointerDown;
  const handlePointerMove = ix.handlePointerMove;
  const handlePointerUp = ix.handlePointerUp;
  const handlePointerLeave = ix.handlePointerLeave;
  const handlePointerEnter = ix.handlePointerEnter;
  const initShapeMove = ix.initShapeMove;
  const startTextDrag = ix.startTextDrag;
  const initHandleDrag = ix.initHandleDrag;
  const finalizeTextEdit = ix.finalizeTextEdit;
  const getDisplayCoords = ix.getDisplayCoords;
  const getDisplayPoints = ix.getDisplayPoints;

  /** Freehand / draw tools need touch-action:none so WebView2 does not pan on pen/touch. */
  let isInkTool = $derived(
    activeDoc.activeTool === "pen" ||
      activeDoc.activeTool === "highlight" ||
      activeDoc.activeTool === "line" ||
      isBoxShapeTool(activeDoc.activeTool),
  );


  onMount(() => {
    if (!pageContainer) return;
    const trueScrollViewport = pageContainer.parentElement?.parentElement;
    function handleDeletionShortcuts(event: KeyboardEvent): boolean {
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        activeDoc.selectedShape
      ) {
        // Never steal Backspace/Delete from text editing (textarea) or form inputs
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el?.isContentEditable
        ) {
          return false;
        }
        // Also skip while a text annotation edit session is open on this page
        if (ix.activelyEditingIndex !== null) return false;

        pushHistorySnapshot();
        const { pageNumber: targetPage, index: targetIdx } =
          activeDoc.selectedShape;
        const existingList = [...(activeDoc.shapes[targetPage] || [])];
        if (existingList[targetIdx]) {
          activeDoc.selectedShape = null;
          activeDoc.selectedShapes = [];
          existingList.splice(targetIdx, 1);
          activeDoc.shapes = {
            ...activeDoc.shapes,
            [targetPage]: existingList,
          };
        }
        return true;
      }
      return false;
    }

    function handlePageNavigationShortcuts(event: KeyboardEvent): boolean {
      return false;
    }

    function handleViewZoomShortcuts(event: KeyboardEvent): boolean {
      return false;
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (handleDeletionShortcuts(event)) return;
      if (handlePageNavigationShortcuts(event)) return;
      if (handleViewZoomShortcuts(event)) return;
    }
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (isSystemPrinting || !entries.length) return;
        isPreloaded = entries[entries.length - 1].isIntersecting;
      },
      {
        root: null,
        rootMargin: '3500px 0px 3500px 0px',
        threshold: 0.01
      }
    );

    const paintObserver = new IntersectionObserver(
      (entries) => {
        if (isSystemPrinting || !entries.length) return;
        isRendered = entries[entries.length - 1].isIntersecting;
      },
      {
        root: null,
        rootMargin: '1200px 0px 1200px 0px',
        threshold: 0.01
      }
    );

    window.addEventListener("keydown", handleGlobalKeyDown);
    preloadObserver.observe(pageContainer);
    paintObserver.observe(pageContainer);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      preloadObserver.disconnect();
      paintObserver.disconnect();
      ix.cancelAnimation();
      void pageRenderer.releaseWhenUnrendered();
    };
  });

  $effect(() => {
    // Self-register to the centralized parent scroll loop upon painting
    if (pageContainer && scrollObserver) {
      scrollObserver.observe(pageContainer);
    }
    return () => {
      if (pageContainer && scrollObserver) {
        scrollObserver.unobserve(pageContainer);
      }
    };
  });

  $effect(() => {
    if (activeDoc.currentPage === pageNumber && pageContainer) {
      if ((activeDoc as any).isClickScrolling) {
        pageContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        // Break the feedback loop: writing isClickScrolling inside an effect that reads it
        // would re-schedule this effect infinitely without untrack
        setTimeout(() => {
          untrack(() => {
            (activeDoc as any).isClickScrolling = false;
          });
        }, 500);
      }
    }
  });
</script>

<div
  bind:this={pageContainer}
  data-page-number={pageNumber}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
  class="bg-white relative rounded-sm mb-12 select-none page-shell {isInkTool ? 'touch-none' : ''}"
  style="box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.65);
         {activeDoc.fileType === 'image'
           ? `width: ${currentWidth * scaleFactor}px; height: ${currentHeight * scaleFactor}px;`
           : `width: ${expectedDimensions.width}px; min-height: ${expectedDimensions.height}px; aspect-ratio: ${expectedDimensions.aspectRatio};`}"
>
  {#if isRendered}
    <canvas use:canvasLifecycle class="block max-w-full h-auto rounded-sm" data-page-index={pageNumber - 1}
    ></canvas>
    <!-- PDF.js text layer: sits above canvas; spans capture selection, empty areas pass through -->
    <div
      bind:this={textLayerElement}
      class="textLayer absolute inset-0 overflow-hidden rounded-sm z-[35]"
      class:textLayer--interactive={activeDoc.activeTool === "select"}
      aria-hidden="true"
    ></div>
  {/if}

  <!-- AcroForm fill layer (text / checkbox / dropdown) — above canvas, below freehand SVG ink -->
  {#if activeDoc.fileType === "pdf"}
    <FormLayer {pageNumber} />
  {/if}

  <!-- URI Link annotations: underline/hover + confirm-to-open (select tool only) -->
  {#if activeDoc.fileType === "pdf"}
    <LinkLayer {pageNumber} />
  {/if}

  <AnnotationLayer
    {pageNumber}
    {zoomScale}
    {strokeDasharrays}
    {shapeTypesList}
    {ghostDimensions}
    {ix}
    {initShapeMove}
    {startTextDrag}
    {initHandleDrag}
    {finalizeTextEdit}
    {getDisplayCoords}
    {getDisplayPoints}
  />

  <!-- Light highlight when this page has comments -->
  {#if pageHasCommentThreads && activeDoc.fileType !== 'image'}
    <div
      class="absolute inset-0 pointer-events-none rounded-sm z-[25] ring-1 ring-amber-400/25 shadow-[inset_0_0_40px_rgba(251,191,36,0.06)]"
      aria-hidden="true"
    ></div>
  {/if}

  <!-- Page chrome: bookmarks (top), then comments.
       Fixed icon rail + absolute popouts so hover never shifts the stack. -->
  <div class="absolute top-2 left-[calc(100%+8px)] z-30 flex flex-col items-start gap-1.5">
    {#if activeDoc.fileType === 'image'}
      <!-- Bookmarks / comments are not available for image documents -->
    {:else}
      <!-- 1. Bookmark (top)
           - Empty: click opens compose popout (focused input) — no hover Add trap
           - Existing: hover shows title / rename / delete -->
      {#if pageHasBookmark && pageBookmark}
        <div
          onmouseenter={() => (bookmarkHovered = true)}
          onmouseleave={() => {
            if (!bookmarkComposing) bookmarkHovered = false;
          }}
          class="relative w-5 h-[26px] bg-transparent select-none"
        >
          <button
            type="button"
            onclick={() => (activeDoc.currentPage = pageNumber)}
            class="absolute inset-0 flex items-start justify-start text-cyan-400 hover:text-cyan-300 drop-shadow-lg transition-transform active:scale-95"
            aria-label="Bookmark"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 24 24" fill="currentColor" class="block">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          {#if bookmarkHovered || bookmarkComposing}
            <div
              class="absolute left-full top-0 ml-1.5 flex items-center gap-2 rounded-lg px-2 py-1 shadow-2xl backdrop-blur-sm z-50 whitespace-nowrap pointer-events-auto"
              style="background: var(--sdf-overlay-bg); border: 1px solid var(--sdf-overlay-border);"
              onmousedown={(e) => e.stopPropagation()}
            >
              {#if bookmarkComposing}
                <input
                  bind:this={bookmarkInputEl}
                  type="text"
                  bind:value={bookmarkDraft}
                  placeholder="Bookmark title…"
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveBookmarkCompose();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelBookmarkCompose();
                    }
                  }}
                  class="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-cyan-500 max-w-[130px] font-sans"
                style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
                />
                <button
                  type="button"
                  onclick={saveBookmarkCompose}
                  class="p-0.5 rounded text-emerald-400 hover:bg-slate-800"
                  aria-label="Save bookmark name"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              {:else}
                <span class="text-[10px] font-medium max-w-[130px] truncate font-sans" style="color: var(--sdf-text-secondary);">
                  {pageBookmark.name || "Untitled reference"}
                </span>
                <button
                  type="button"
                  onclick={() => void openBookmarkCompose(pageBookmark.name || "")}
                  class="p-0.5 rounded hover:text-amber-400"
                  style="color: var(--sdf-text-muted);"
                  aria-label="Rename bookmark"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
              {/if}

              <button
                type="button"
                onclick={() => {
                  deleteBookmarkAction(pageNumber);
                  bookmarkComposing = false;
                  bookmarkHovered = false;
                  bookmarkDraft = "";
                }}
                class="p-0.5 rounded hover:text-red-400"
                style="color: var(--sdf-text-muted);"
                aria-label="Remove bookmark"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <!-- Empty bookmark: click-to-compose only (no hover popout to chase) -->
        <div class="relative w-5 h-[26px] bg-transparent select-none">
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              void openBookmarkCompose("");
            }}
            class="absolute inset-0 flex items-start justify-start text-slate-500 hover:text-slate-300 drop-shadow-md transition-colors active:scale-95"
            aria-label="Add bookmark"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="block">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {#if bookmarkComposing}
            <div
              class="absolute left-full top-0 ml-1.5 flex items-center gap-2 rounded-lg px-2 py-1 shadow-2xl backdrop-blur-sm z-50 whitespace-nowrap pointer-events-auto"
              style="background: var(--sdf-overlay-bg); border: 1px solid var(--sdf-overlay-border);"
              onmousedown={(e) => e.stopPropagation()}
            >
              <input
                bind:this={bookmarkInputEl}
                type="text"
                bind:value={bookmarkDraft}
                placeholder="Bookmark title…"
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveBookmarkCompose();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelBookmarkCompose();
                  }
                }}
                class="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-cyan-500 max-w-[130px] font-sans"
                style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
              />
              <button
                type="button"
                onclick={saveBookmarkCompose}
                class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-500/30"
              >
                Add
              </button>
              <button
                type="button"
                onclick={cancelBookmarkCompose}
                class="p-0.5 rounded"
                style="color: var(--sdf-text-muted);"
                aria-label="Cancel bookmark"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 2. Comments — same 20px rail as bookmark; +1px nudge for stroke-edge alignment -->
      <div
        onmouseenter={() => (commentHovered = true)}
        onmouseleave={() => {
          if (!commentComposing) commentHovered = false;
        }}
        class="relative w-5 min-h-[18px] bg-transparent select-none"
      >
        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            commentComposing = true;
            commentHovered = true;
          }}
          class="flex items-center gap-0.5 drop-shadow-md transition-colors active:scale-95
            ml-px
            {pageHasCommentThreads
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-slate-500 hover:text-slate-300'}"
          aria-label={pageHasCommentThreads
            ? `Comments (${pageCommentCount})`
            : "Add comment on this page"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={pageHasCommentThreads ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="block shrink-0"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {#if pageHasCommentThreads && pageCommentCount > 0}
            <span class="text-[9px] font-bold font-mono text-amber-400/90">{pageCommentCount}</span>
          {/if}
        </button>

        {#if commentHovered || commentComposing}
          <div
            class="absolute left-full top-0 ml-1.5 flex flex-col gap-1.5 rounded-lg px-2 py-1.5 shadow-2xl backdrop-blur-sm z-50 min-w-[180px] max-w-[240px] pointer-events-auto"
            style="background: var(--sdf-overlay-bg); border: 1px solid var(--sdf-overlay-border);"
            onmousedown={(e) => e.stopPropagation()}
          >
            {#if pageHasCommentThreads}
              <div class="flex items-center justify-between gap-1.5">
                <span class="text-[8px] font-bold uppercase tracking-widest" style="color: var(--sdf-text-muted);">
                  Page notes
                  <span class="ml-1 font-mono text-amber-500/80 normal-case tracking-normal">{pageCommentCount}</span>
                </span>
                <button
                  onclick={(e) => {
                    e.stopPropagation();
                    requestCommentsPanel(pageNumber);
                    commentComposing = false;
                    commentHovered = false;
                  }}
                  class="p-0.5 rounded hover:text-amber-400 shrink-0"
                  style="color: var(--sdf-text-muted);"
                  aria-label="Open comments panel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
              </div>

              <div class="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-0.5">
                {#each pageComments as thread (thread.id)}
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span
                        class="text-[9px] font-semibold truncate"
                      style="color: var(--sdf-text-secondary);"
                        title={thread.authorFullName || thread.author}
                      >{thread.author}</span>
                      <span class="text-[8px] font-mono shrink-0" style="color: var(--sdf-text-faint);">{formatCommentTime(thread.createdAt)}</span>
                    </div>
                    <span class="text-[10px] font-medium block whitespace-pre-wrap break-words font-sans mt-0.5 leading-snug" style="color: var(--sdf-text-secondary);">
                      {thread.text || "Untitled note"}
                    </span>
                    {#if (thread.replies || []).length > 0}
                      <div class="mt-1 ml-1.5 pl-1.5 space-y-1" style="border-left: 1px solid var(--sdf-border);">
                        {#each thread.replies || [] as reply (reply.id)}
                          <div class="min-w-0">
                            <div class="flex items-center gap-1.5">
                              <span
                                class="text-[8px] font-semibold truncate"
                              style="color: var(--sdf-text-muted);"
                                title={reply.authorFullName || reply.author}
                              >{reply.author}</span>
                              <span class="text-[7px] font-mono shrink-0" style="color: var(--sdf-text-faint);">{formatCommentTime(reply.createdAt)}</span>
                            </div>
                            <span class="text-[9px] block whitespace-pre-wrap break-words font-sans leading-snug" style="color: var(--sdf-text-muted);">
                              {reply.text}
                            </span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
              <div style="border-top: 1px solid var(--sdf-border);"></div>
            {/if}

            <div class="flex items-start gap-1.5">
              <textarea
                use:autoGrowTextarea={{ minRows: 2, maxRows: 12 }}
                bind:value={commentDraft}
                rows="2"
                placeholder={pageHasCommentThreads ? "Add another note…" : "Add a note…"}
                onfocus={() => (commentComposing = true)}
                onkeydown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitPageComment();
                  } else if (e.key === "Escape") {
                    commentDraft = "";
                    commentComposing = false;
                    commentHovered = false;
                  }
                }}
                class="rounded px-1.5 py-0.5 text-[10px] placeholder-slate-600 focus:outline-none focus:border-amber-500/50 flex-1 min-w-0 font-sans resize-none leading-relaxed overflow-hidden"
              style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
              ></textarea>
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  submitPageComment();
                }}
                disabled={!commentDraft.trim()}
                class="p-0.5 rounded shrink-0 transition-colors mt-0.5
                  {commentDraft.trim()
                    ? 'text-emerald-400 hover:bg-slate-800'
                    : 'text-slate-600 cursor-not-allowed'}"
                aria-label="Post comment (Ctrl+Enter)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Smooth CSS box resize while zooming (canvas repaints on their own cadence) */
  .page-shell {
    transition: width 0.12s ease-out, min-height 0.12s ease-out, height 0.12s ease-out;
  }

  /* Minimal PDF.js text layer styles — characters are invisible but selectable.
     :global() is required because TextLayer injects spans at runtime. */
  .textLayer {
    pointer-events: none;
    line-height: 1;
    text-align: initial;
    opacity: 1;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
    transform-origin: 0 0;
    caret-color: transparent;
    --text-scale-factor: calc(var(--total-scale-factor, 1) * var(--min-font-size, 1));
    --min-font-size-inv: calc(1 / var(--min-font-size, 1));
  }

  .textLayer :global(:is(span, br)) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    -webkit-user-select: text;
    user-select: text;
    pointer-events: none;
  }

  /* Only capture pointer events on glyphs when the select tool is active.
     Overrides parent select-none so the browser can form a selection. */
  .textLayer.textLayer--interactive {
    -webkit-user-select: text;
    user-select: text;
  }

  .textLayer.textLayer--interactive :global(:is(span, br)) {
    pointer-events: auto;
  }

  .textLayer :global(> :not(.markedContent)),
  .textLayer :global(.markedContent span:not(.markedContent)) {
    z-index: 1;
    font-size: calc(var(--text-scale-factor) * var(--font-height, 0));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x))
      scale(var(--min-font-size-inv));
  }

  .textLayer :global(.markedContent) {
    display: contents;
  }

  .textLayer :global(::selection) {
    background: rgba(0, 100, 255, 0.28);
    color: transparent;
  }

  .textLayer :global(::-moz-selection) {
    background: rgba(0, 100, 255, 0.28);
    color: transparent;
  }

  /*
   * Ctrl+F search marks — soft Safari-style yellow wash over the canvas text.
   * Text-layer glyphs stay color:transparent; the PDF canvas shows through
   * translucent backgrounds so keywords remain legible.
   */
  .textLayer :global(mark.sdf-search-hit) {
    /* ~20% yellow — soft wash, not a solid box */
    background-color: rgba(250, 204, 21, 0.2) !important;
    color: transparent !important;
    border-radius: 1px;
    padding: 0 0.5px;
    border: none;
    outline: none;
    box-shadow: none;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    position: relative;
    z-index: 2;
  }

  .textLayer :global(mark.sdf-search-hit-current) {
    /* ~50% yellow + thin outline for the focused match */
    background-color: rgba(250, 204, 21, 0.5) !important;
    /* 1px amber outline (outline doesn't eat layout; visible over canvas) */
    outline: 1px solid rgba(202, 138, 4, 0.85);
    outline-offset: 0px;
    border-radius: 1px;
    box-shadow: none;
    z-index: 5;
  }
</style>
