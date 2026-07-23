<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import WorkspacePage from "./WorkspacePage.svelte";
  import { activeDoc, FONT_MAP, pushHistorySnapshot } from "../pdfStore.svelte";
  import { debounceLeadingLatest } from "../lib/render/pdfRenderQueue";

  // Debounced auto-fit handler to prevent layout thrashing.
  // It guarantees the layout is updated at most once per timeframe.
  const debouncedShrink = debounceLeadingLatest(() => {
    if (typeof shrinkToWindow === "function") {
      shrinkToWindow();
    }
  }, 150);

  // Auto-fit every newly opened document (PDF / TIFF / image) to the viewport,
  // respecting the page container's actual orientation after layout settles.
  $effect(() => {
    const bytes = activeDoc.rawBytes;
    const fileKey = activeDoc.filePath || activeDoc.fileName || "";
    // Touch fileType so orientation/type switches re-trigger fit
    void activeDoc.fileType;
    if (!bytes || !fileKey) return;

    // Retry a few times so page shells (and image natural size) have painted.
    // By keeping the delays, we cover slow-rendering documents.
    // By delegating to debouncedShrink, we coalesce clustered paints and avoid layout thrashing.
    let cancelled = false;
    const delays = [80, 200, 450, 900];
    for (const ms of delays) {
      setTimeout(() => {
        if (cancelled) return;
        debouncedShrink.schedule();
      }, ms);
    }

    return () => {
      cancelled = true;
      debouncedShrink.cancel();
    };
  });

  let {
    zoomScale = $bindable(120),
    isSystemPrinting = false,
    onShowNotification,
    openDurationMs = null,
  } = $props<{
    zoomScale: number;
    isSystemPrinting: boolean;
    onShowNotification?: (message: string) => void;
    /** Perceived open latency (ms) for the active document; null hides burn-in. */
    openDurationMs?: number | null;
  }>();
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollObserver = $state<IntersectionObserver | null>(null);

  // "Document loaded in Xms" burn-in (active tab only; parent gates the value).
  // Stays visible: full brightness briefly, then settles to slight transparency.
  let showLoadBurnIn = $state(false);
  let loadBurnInSettled = $state(false);
  let loadBurnInTimer: ReturnType<typeof setTimeout> | null = null;

  function clearLoadBurnInTimers() {
    if (loadBurnInTimer) {
      clearTimeout(loadBurnInTimer);
      loadBurnInTimer = null;
    }
  }

  function settleLoadBurnIn() {
    if (!showLoadBurnIn || loadBurnInSettled) return;
    loadBurnInSettled = true;
    clearLoadBurnInTimers();
  }

  $effect(() => {
    const ms = openDurationMs;
    clearLoadBurnInTimers();
    if (ms == null || ms < 0) {
      showLoadBurnIn = false;
      loadBurnInSettled = false;
      return;
    }
    // Fresh open — bright first, then soft settle after ~3s (does not hide)
    showLoadBurnIn = true;
    loadBurnInSettled = false;
    loadBurnInTimer = setTimeout(() => {
      settleLoadBurnIn();
    }, 3000);
    return () => {
      clearLoadBurnInTimers();
    };
  });

  $effect(() => {
    if (!scrollContainer) return;

    scrollObserver = new IntersectionObserver(
      (entries) => {
        // Block updates if the application is executing an explicit click-to-scroll navigation anchor sweep
        if ((activeDoc as any).isClickScrolling) return;

        // Filter for live intersecting entries
        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length === 0) return;

        // Sort multiple concurrent entries by their vertical layout coordinates to prevent frame jitters
        visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        // The top-most element crossing our horizon window takes state dominance
        const targetEntry = visibleEntries[0];
        const pageNumAttr = targetEntry.target.getAttribute("data-page-number");

        if (pageNumAttr) {
          const pageNum = parseInt(pageNumAttr, 10);
          if (activeDoc.currentPage !== pageNum) {
            activeDoc.currentPage = pageNum;
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: "-10% 0px -85% 0px", // 🎯 Horizons focal scanning line near the upper third
        threshold: 0.0,
      }
    );

    const handleViewportScroll = () => {
      if (!scrollContainer) return;
      (activeDoc as any).scrollTop = scrollContainer.scrollTop;
      (activeDoc as any).scrollHeight = scrollContainer.scrollHeight;
      (activeDoc as any).clientHeight = scrollContainer.clientHeight;
    };

    // Use passive true to ensure the browser thread never drops rendering frames
    scrollContainer.addEventListener("scroll", handleViewportScroll, { passive: true });

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleViewportScroll);
      }
      if (scrollObserver) {
        scrollObserver.disconnect();
        scrollObserver = null;
      }
    };
  });

  // ⚡ FIXED: Automatically measures the total height of the document when zoom scales or pages change
  $effect(() => {
    if (scrollContainer && activeDoc.pageOrder.length > 0 && zoomScale) {
      setTimeout(() => {
        if (scrollContainer) {
          activeDoc.scrollHeight = scrollContainer.scrollHeight;
          activeDoc.clientHeight = scrollContainer.clientHeight;
        }
      }, 150);
    }
  });

  // Bind zoomScale to activeDoc.zoomScale
  $effect(() => {
    activeDoc.zoomScale = Math.max(5, Math.abs(zoomScale));
  });

  // Reactively track changes to your annotations database layer
  $effect(() => {
    // Stringify or access the deep shapes map to trigger Svelte tracking dependencies
    const shapeCount = Object.values(activeDoc.shapes || {}).reduce((acc: number, curr: any) => acc + (curr?.length || 0), 0);
    if (shapeCount > 0 && activeDoc.rawBytes) {
      activeDoc.isDirty = true;
    }
  });

  // Derived state to determine when to show the floating menu capsule
  const activeTextShape = $derived.by(() => {
    if (activeDoc.selectedShape) {
      const shape = activeDoc.shapes[activeDoc.selectedShape.pageNumber]?.[activeDoc.selectedShape.index];
      if (shape && shape.type === "text") return shape;
    }
    return null;
  });

  const showFloatingMenu = $derived.by(() => {
    if (activeDoc.activeTool === "text") return true;
    if (activeDoc.activeTool === "select" && activeTextShape) return true;
    return false;
  });

  let selectedFont = $state("Helvetica");
  let selectedSize = $state(12);
  let selectedStyle = $state("Normal");

  // Sync with selected shape or defaults
  $effect(() => {
    if (activeTextShape) {
      selectedFont = activeTextShape.fontFamily || activeTextShape.font || "Helvetica";
      selectedSize = activeTextShape.size || 12;
      selectedStyle = activeTextShape.style || "Normal";
      // Keep Align dropdown in sync with the selected/editing text box
      const align = activeTextShape.alignment || "left";
      if (activeDoc.activeTextAlignment !== align) {
        activeDoc.activeTextAlignment = align;
      }
    } else {
      selectedFont = activeDoc.activeFontFamily || activeDoc.defaultFont || "Helvetica";
      selectedSize = activeDoc.defaultSize;
      selectedStyle = activeDoc.defaultStyle || "Normal";
    }
  });

  function handleFontChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    selectedFont = val;
    activeDoc.activeFontFamily = val as any;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.font = val;
      activeTextShape.fontFamily = val as any;
      activeDoc.shapes = { ...activeDoc.shapes };
    } else {
      activeDoc.defaultFont = val;
    }
  }

  /** Scale text box height with font size so the textarea bounds stay tight. */
  function applyFontSizeToTextShape(shape: { size?: number; height?: number }, nextSize: number) {
    const oldSize = Math.max(1, shape.size || 12);
    const ratio = nextSize / oldSize;
    shape.size = nextSize;
    if (shape.height != null && shape.height > 0) {
      shape.height = Math.max(0.4, shape.height * ratio);
    }
  }

  function handleSizeChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value) || 12;
    selectedSize = val;
    if (activeTextShape) {
      pushHistorySnapshot();
      applyFontSizeToTextShape(activeTextShape, val);
      activeDoc.shapes = { ...activeDoc.shapes };
    } else {
      activeDoc.defaultSize = val;
    }
  }

  function handleStyleChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value as "Normal" | "Bold" | "Italic";
    selectedStyle = val;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.style = val;
      activeDoc.shapes = { ...activeDoc.shapes };
    } else {
      activeDoc.defaultStyle = val;
    }
  }

  function handleAlignmentChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value as
      | "left"
      | "center"
      | "right";
    activeDoc.activeTextAlignment = val;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.alignment = val;
      activeDoc.shapes = { ...activeDoc.shapes };
    }
  }

  // ⚡ CUSTOM SIZE COMBOBOX STATE & HANDLERS
  let showSizeDropdown = $state(false);

  function selectCustomSize(sz: number) {
    selectedSize = sz;
    if (activeTextShape) {
      pushHistorySnapshot();
      applyFontSizeToTextShape(activeTextShape, sz);
      activeDoc.shapes = { ...activeDoc.shapes };
    } else {
      activeDoc.defaultSize = sz;
    }
    showSizeDropdown = false;
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".size-combobox-wrapper")) {
      showSizeDropdown = false;
    }
  }



  function setupWheelZoom(node: HTMLElement) {
    let zoomRaf: number | null = null;
    let pendingZoom: number | null = null;
    /** Cursor position in viewport coords of the scroller (for post-layout re-anchor). */
    let pendingCursor: { x: number; y: number; contentX: number; contentY: number; oldW: number; oldH: number } | null =
      null;

    const applyPendingZoom = () => {
      zoomRaf = null;
      if (pendingZoom == null) return;
      const next = pendingZoom;
      const cursor = pendingCursor;
      pendingZoom = null;
      pendingCursor = null;

      // Disable smooth scrolling so zoom re-anchor never animates as a pan
      const prevBehavior = node.style.scrollBehavior;
      node.style.scrollBehavior = "auto";
      node.classList.add("workspace-zooming");

      activeDoc.zoomScale = next;
      zoomScale = next;

      // After page shells reflow, keep the content under the cursor stable
      // (uses measured scroll size — safer than zoom ratio with mx-auto + multipage).
      requestAnimationFrame(() => {
        if (cursor && cursor.oldW > 0 && cursor.oldH > 0) {
          const scaleX = node.scrollWidth / cursor.oldW;
          const scaleY = node.scrollHeight / cursor.oldH;
          node.scrollLeft = Math.max(0, cursor.contentX * scaleX - cursor.x);
          node.scrollTop = Math.max(0, cursor.contentY * scaleY - cursor.y);
        }
        node.style.scrollBehavior = prevBehavior;
        node.classList.remove("workspace-zooming");
      });
    };

    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd+wheel = zoom only. Always kill native scroll/pinch pan.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      // Also stop other listeners on the same path (settleLoadBurnIn, etc.)
      e.stopImmediatePropagation?.();

      const oldZoom = Math.max(10, Math.abs(zoomScale || activeDoc.zoomScale || 100));
      // Continuous, delta-sensitive zoom (smoother than fixed ±10 steps)
      const intensity = Math.min(48, Math.abs(e.deltaY));
      const step = Math.max(1.5, intensity * 0.35);
      const direction = e.deltaY < 0 ? 1 : -1;
      const nextZoom = Math.max(10, Math.min(500, Math.round(oldZoom + direction * step)));
      if (nextZoom === oldZoom) return;

      const rect = node.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      pendingZoom = nextZoom;
      pendingCursor = {
        x,
        y,
        contentX: node.scrollLeft + x,
        contentY: node.scrollTop + y,
        oldW: node.scrollWidth,
        oldH: node.scrollHeight,
      };

      if (zoomRaf == null) {
        zoomRaf = requestAnimationFrame(applyPendingZoom);
      }
    };

    // Capture phase so we beat bubbling scroll handlers and can always preventDefault
    node.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    return {
      destroy() {
        node.removeEventListener("wheel", handleWheel, { capture: true } as EventListenerOptions);
        if (zoomRaf != null) cancelAnimationFrame(zoomRaf);
      }
    };
  }

  // Spacebar + Left-Click Drag Panning
  let isSpacePressed = $state(false);
  let isDragging = $state(false);
  let startX = 0;
  let startY = 0;
  let scrollLeftStart = 0;
  let scrollTopStart = 0;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space') {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );
      if (!isInput) {
        e.preventDefault();
        isSpacePressed = true;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      window.print();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      isSpacePressed = false;
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (isSpacePressed && scrollContainer) {
      isDragging = true;
      scrollContainer.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      scrollLeftStart = scrollContainer.scrollLeft;
      scrollTopStart = scrollContainer.scrollTop;
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (isDragging && scrollContainer) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      scrollContainer.scrollLeft = scrollLeftStart - dx;
      scrollContainer.scrollTop = scrollTopStart - dy;
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (isDragging) {
      isDragging = false;
      if (scrollContainer) {
        try {
          scrollContainer.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
    }
  }

  function handlePointerLeave(e: PointerEvent) {
    if (isDragging) {
      isDragging = false;
    }
  }

  function shrinkToWindow() {
    if (!scrollContainer) return;

    const availableWidth = Math.max(1, scrollContainer.clientWidth - 48);
    const availableHeight = Math.max(1, scrollContainer.clientHeight - 48);
    const pageEl = scrollContainer.querySelector(
      ".bg-white.relative.rounded-sm",
    ) as HTMLElement | null;

    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        // Fit both axes so landscape and portrait pages fill the window correctly.
        const widthScale = (availableWidth / rect.width) * zoomScale;
        const heightScale = (availableHeight / rect.height) * zoomScale;
        const newScale = Math.round(Math.min(widthScale, heightScale));
        zoomScale = Math.max(5, Math.min(400, Math.abs(newScale)));
        return;
      }
    }
    zoomScale = 100;
  }

  let isDrawingMarquee = $state(false);
  let marqueeStart = $state({ x: 0, y: 0 });
  let marqueeCurrent = $state({ x: 0, y: 0 });

  let screenStart = $state({ x: 0, y: 0 });
  let screenCurrent = $state({ x: 0, y: 0 });

  async function handleExecuteCropCapture(e: MouseEvent) {
    if (!isDrawingMarquee) return;
    isDrawingMarquee = false;
    activeDoc.activeTool = 'select'; // Dismiss crosshair tool profile

    // 1. Establish absolute screen bounding limits
    const clientX1 = Math.min(screenStart.x, screenCurrent.x);
    const clientY1 = Math.min(screenStart.y, screenCurrent.y);
    const clientWidth = Math.abs(screenStart.x - screenCurrent.x);
    const clientHeight = Math.abs(screenStart.y - screenCurrent.y);

    if (clientWidth < 5 || clientHeight < 5) return; // Ignore accidental micro clicks

    // Temporarily hide marquee to find the underlying element
    const currentTarget = e.currentTarget as HTMLElement;
    const originalDisplay = currentTarget.style.display;
    currentTarget.style.display = 'none';

    // Find the element at the midpoint screen position
    const startScreenX = (screenStart.x + screenCurrent.x) / 2;
    const startScreenY = (screenStart.y + screenCurrent.y) / 2;
    
    const underElement = document.elementFromPoint(startScreenX, startScreenY);
    currentTarget.style.display = originalDisplay;

    // Locate the closest canvas element
    let activeCanvas = underElement as HTMLCanvasElement | null;
    if (activeCanvas && activeCanvas.tagName !== 'CANVAS') {
      activeCanvas = activeCanvas.closest('canvas') || activeCanvas.querySelector('canvas');
    }
    if (!activeCanvas) {
      activeCanvas = document.querySelector('.workspace-scroll-container canvas') as HTMLCanvasElement;
    }

    if (!activeCanvas) return;

    // 3. Map screen-to-pixel metrics directly using identical coordinate fields
    const displayRect = activeCanvas.getBoundingClientRect();
    
    // Derive local canvas coordinates directly from raw screen differentials
    const cropLocalX = clientX1 - displayRect.left;
    const cropLocalY = clientY1 - displayRect.top;

    // Density scale map linking visible DOM sizing parameters to internal pixel backstores
    const scaleX = activeCanvas.width / displayRect.width;
    const scaleY = activeCanvas.height / displayRect.height;

    // 4. Initialize offscreen capture layout
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = clientWidth * scaleX;
    cropCanvas.height = clientHeight * scaleY;
    const cropCtx = cropCanvas.getContext('2d');

    if (cropCtx) {
      // Blit out pixel arrays directly mapping from original source boundaries
      cropCtx.drawImage(
        activeCanvas,
        cropLocalX * scaleX,
        cropLocalY * scaleY,
        clientWidth * scaleX,
        clientHeight * scaleY,
        0, 0, cropCanvas.width, cropCanvas.height
      );

      // 5. Package as PNG data payload and send straight to operating system clipboard
      cropCanvas.toBlob(async (blob) => {
        if (blob) {
          try {
            const clipboardItem = typeof ClipboardItem !== 'undefined'
              ? new ClipboardItem({ [blob.type]: blob })
              : new (window as any).ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([clipboardItem]);
            console.log('speedDF: Scaled snippet captured cleanly to system clipboard!');
            if (typeof onShowNotification === 'function') {
              onShowNotification("image copied to clipboard");
            }
          } catch (err) {
            console.error('speedDF: Clipboard write operation encountered an error:', err);
          }
        }
      }, 'image/png');
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  bind:this={scrollContainer}
  use:setupWheelZoom
  onpointerdown={(e) => {
    settleLoadBurnIn();
    handlePointerDown(e);
  }}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerLeave}
  onwheel={() => settleLoadBurnIn()}
  class="flex-1 min-w-0 h-full overflow-auto bg-[#070a12] flex flex-col pt-8 px-4 relative workspace-scroll-container transition-colors duration-200
    {isDragging ? '' : 'scroll-smooth'}
    [&::-webkit-scrollbar]:w-2 
    [&::-webkit-scrollbar-track]:bg-transparent 
    [&::-webkit-scrollbar-thumb]:bg-slate-800/80 
    [&::-webkit-scrollbar-thumb]:rounded-full 
    hover:[&::-webkit-scrollbar-thumb]:bg-slate-700"
  style={(isSpacePressed ? (isDragging ? 'cursor: grabbing;' : 'cursor: grab;') : '') + ' touch-action: pan-x pan-y;'}
>
  {#if showLoadBurnIn && openDurationMs != null}
    <!-- Viewport-fixed background layer: stays under document pages (z-0 vs pages z-10) -->
    <div
      class="load-burn-in absolute top-2 right-3 z-0 pointer-events-none select-none
        {loadBurnInSettled ? 'load-burn-in--settled' : 'load-burn-in--bright'}"
      aria-live="polite"
    >
      <span
        class="inline-block font-mono text-[10px] font-semibold tracking-wider uppercase text-right
          drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]
          {loadBurnInSettled ? 'text-slate-400/80' : 'text-slate-200'}"
      >
        Document loaded in
        <span
          class="font-bold tabular-nums
            {loadBurnInSettled ? 'text-cyan-400/70' : 'text-cyan-300'}"
          >{openDurationMs}ms</span
        >
      </span>
    </div>
  {/if}
  {#if activeDoc.activeTool === 'snapshot'}
    <div 
      class="absolute inset-0 bg-black/25 z-[90] cursor-crosshair select-none"
      onmousedown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        isDrawingMarquee = true;
        marqueeStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        marqueeCurrent = { ...marqueeStart };
        
        // Lock down global screen origin coordinates
        screenStart = { x: e.clientX, y: e.clientY };
        screenCurrent = { x: e.clientX, y: e.clientY };
      }}
      onmousemove={(e) => {
        if (!isDrawingMarquee) return;
        const rect = e.currentTarget.getBoundingClientRect();
        marqueeCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        
        // Continually map current global screen pointers
        screenCurrent = { x: e.clientX, y: e.clientY };
      }}
      onmouseup={handleExecuteCropCapture}
    >
      {#if isDrawingMarquee}
        <div 
          class="absolute border border-dashed border-cyan-400 bg-cyan-400/15 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
          style="
            left: {Math.min(marqueeStart.x, marqueeCurrent.x)}px;
            top: {Math.min(marqueeStart.y, marqueeCurrent.y)}px;
            width: {Math.abs(marqueeStart.x - marqueeCurrent.x)}px;
            height: {Math.abs(marqueeStart.y - marqueeCurrent.y)}px;
          "
        ></div>
      {/if}
    </div>
  {/if}

  {#if showFloatingMenu}
    <div
      class="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#090d16]/95 border border-slate-800/80 px-4 py-2 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-center gap-3 backdrop-blur-md select-none pointer-events-auto transition-all duration-200"
    >
      <div class="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold tracking-wider uppercase border-r border-slate-800 pr-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-cyan-400"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
        <span>Text Style</span>
      </div>

      <div class="flex items-center gap-1.5 font-sans">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Font</span>
        <select
          value={selectedFont}
          onchange={handleFontChange}
          class="bg-slate-900 border border-slate-800 text-slate-200 rounded px-2 py-1 text-xs font-medium outline-none focus:border-cyan-500 transition-colors cursor-pointer"
        >
          <option value="Helvetica" style="font-family: Helvetica, Arial, sans-serif;">Standard Sans (Helvetica)</option>
          <option value="Times-Roman" style="font-family: 'Times New Roman', serif;">Standard Serif (Times)</option>
          <option value="Courier" style="font-family: 'Courier New', monospace;">Standard Mono (Courier)</option>
          <option value="Inter" style="font-family: 'Inter', sans-serif;">Modern Corporate (Inter)</option>
          <option value="JetBrainsMono" style="font-family: 'JetBrains Mono', monospace;">Technical Grid (JetBrains)</option>
        </select>
      </div>

      <div class="flex items-center gap-1.5 border-l border-slate-800 pl-3">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Size</span>
        <div class="relative flex items-center size-combobox-wrapper">
          <input
            type="number"
            value={selectedSize}
            oninput={handleSizeChange}
            onfocus={() => showSizeDropdown = true}
            min="6"
            max="120"
            class="bg-slate-900 border border-slate-800 text-slate-200 rounded-l px-2 pr-6 py-1 text-xs font-medium outline-none focus:border-cyan-500 transition-colors w-16 text-center font-mono appearance-none"
          />
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              showSizeDropdown = !showSizeDropdown;
            }}
            class="absolute right-0 top-0 bottom-0 px-1.5 flex items-center justify-center text-slate-400 hover:text-white border-l border-slate-800 bg-slate-900 rounded-r focus:outline-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="transition-transform duration-200 {showSizeDropdown ? 'rotate-180' : ''}"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          
          {#if showSizeDropdown}
            <div
              class="absolute top-full left-0 mt-1 max-h-48 overflow-y-auto z-50 bg-slate-900 border border-slate-800 rounded shadow-xl w-16 text-center font-mono size-dropdown-menu"
            >
              {#each [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as sz}
                <button
                  type="button"
                  onclick={() => selectCustomSize(sz)}
                  class="w-full block py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors border-b border-slate-900/60 last:border-0"
                >
                  {sz}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-1.5 border-l border-slate-800 pl-3">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Align</span>
        <select
          value={activeDoc.activeTextAlignment}
          onchange={handleAlignmentChange}
          class="bg-slate-800 text-slate-200 text-xs border border-slate-700 rounded px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 mx-1 font-sans"
        >
          <option value="left">≡ Left</option>
          <option value="center">≢ Center</option>
          <option value="right">≣ Right</option>
        </select>
      </div>

      <div class="flex items-center gap-1.5 border-l border-slate-800 pl-3">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Style</span>
        <select
          value={selectedStyle}
          onchange={handleStyleChange}
          class="bg-slate-900 border border-slate-800 text-slate-200 rounded px-2 py-1 text-xs font-medium outline-none focus:border-cyan-500 transition-colors cursor-pointer"
        >
          <option value="Normal">Normal</option>
          <option value="Bold">Bold</option>
          <option value="Italic">Italic</option>
        </select>
      </div>
    </div>
  {/if}

  {#if activeDoc.rawBytes && activeDoc.pageOrder.length > 0}
    <!--
      Horizontal centering via w-max + mx-auto (not parent items-center).
      Flex items-center on an overflow-auto scroller clips left overflow so
      scrollLeft cannot reach the page's left edge when zoomed in.
      mx-auto collapses to 0 when content is wider than the viewport, so both
      edges remain pan-able.
    -->
    <div
      class="relative z-10 w-max max-w-none mx-auto flex flex-col items-center gap-6 pb-24 origin-top"
    >
      {#each activeDoc.pageOrder || [] as pageNumber (pageNumber)}
        <WorkspacePage bytes={activeDoc.rawBytes} {pageNumber} {zoomScale} {isSystemPrinting} {scrollObserver} />
      {/each}
    </div>
  {/if}

  {#if activeDoc.rawBytes && activeDoc.pageOrder.length > 0}
    <div
      class="fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-[#090d16]/90 border border-slate-900 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md z-40 select-none pointer-events-auto"
    >
      <button
        onclick={() => (zoomScale = Math.max(5, zoomScale - 10))}
        class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors"
        >—</button
      >
      <span class="text-[10px] font-bold text-slate-300 w-10 text-center tracking-wider uppercase">{zoomScale}%</span>
      <button
        onclick={shrinkToWindow}
        class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
        title="Shrink to Window"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
      <button
        onclick={() => (zoomScale = Math.min(400, zoomScale + 10))}
        class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors"
        >+</button
      >
    </div>
  {/if}
</div>

<style>
  .load-burn-in {
    transition: opacity 0.45s ease;
  }
  /* Full-contrast after open */
  .load-burn-in--bright {
    opacity: 1;
  }
  /* After ~3s / interaction: slight transparency only (still readable, not gone) */
  .load-burn-in--settled {
    opacity: 0.72;
  }
  /* While Ctrl-zooming: no CSS smooth-scroll so re-anchor never pans visibly */
  :global(.workspace-scroll-container.workspace-zooming) {
    scroll-behavior: auto !important;
  }

  /* Dark Cyber Scrollbar Custom Webkit Injectors */
  .workspace-scroll-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .workspace-scroll-container::-webkit-scrollbar-track {
    background: transparent;
  }
  .workspace-scroll-container::-webkit-scrollbar-thumb {
    background: rgba(30, 41, 59, 0.8);
    border-radius: 9999px;
  }
  .workspace-scroll-container::-webkit-scrollbar-thumb:hover {
    background: rgba(51, 65, 85, 1);
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  @media print {
    :global(body), :global(#app), .fixed, .absolute, button, select, input {
      display: none !important;
    }
    .workspace-scroll-container {
      overflow: visible !important;
      position: static !important;
      width: 100% !important;
      height: auto !important;
    }
  }
</style>
