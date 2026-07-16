<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import WorkspacePage from "./WorkspacePage.svelte";
  import { activeDoc, FONT_MAP, pushHistorySnapshot } from "../pdfStore.svelte";

  $effect(() => {
    if (activeDoc.rawBytes && activeDoc.fileType === "tiff") {
      // Auto-execute your window fitting routine once layout parameters are set
      setTimeout(() => {
        if (typeof shrinkToWindow === "function") {
          shrinkToWindow();
        }
      }, 150);
    }
  });

  let { zoomScale = $bindable(120), isSystemPrinting = false, onShowNotification } = $props<{
    zoomScale: number;
    isSystemPrinting: boolean;
    onShowNotification?: (message: string) => void;
  }>();
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollObserver = $state<IntersectionObserver | null>(null);

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

  function handleSizeChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value) || 12;
    selectedSize = val;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.size = val;
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

  // ⚡ CUSTOM SIZE COMBOBOX STATE & HANDLERS
  let showSizeDropdown = $state(false);

  function selectCustomSize(sz: number) {
    selectedSize = sz;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.size = sz;
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
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 10 : -10;
        const nextZoom = activeDoc.zoomScale + delta;
        activeDoc.zoomScale = Math.max(10, Math.min(500, Math.abs(nextZoom)));
        zoomScale = activeDoc.zoomScale;
      }
    };

    node.addEventListener("wheel", handleWheel, { passive: false });

    return {
      destroy() {
        node.removeEventListener("wheel", handleWheel);
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
    if (scrollContainer) {
      const availableWidth = scrollContainer.clientWidth - 48;
      const pageEl = scrollContainer.querySelector(".bg-white.relative.rounded-sm");
      if (pageEl) {
        const currentWidth = pageEl.getBoundingClientRect().width;
        if (currentWidth > 0) {
          const newScale = Math.round((availableWidth / currentWidth) * zoomScale);
          zoomScale = Math.max(5, Math.min(400, newScale));
          return;
        }
      }
      zoomScale = 100;
    }
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
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerLeave}
  class="flex-1 min-w-0 h-full overflow-auto bg-[#070a12] flex flex-col items-center pt-8 px-4 relative workspace-scroll-container transition-colors duration-200
    {isDragging ? '' : 'scroll-smooth'}
    [&::-webkit-scrollbar]:w-2 
    [&::-webkit-scrollbar-track]:bg-transparent 
    [&::-webkit-scrollbar-thumb]:bg-slate-800/80 
    [&::-webkit-scrollbar-thumb]:rounded-full 
    hover:[&::-webkit-scrollbar-thumb]:bg-slate-700"
  style={(isSpacePressed ? (isDragging ? 'cursor: grabbing;' : 'cursor: grab;') : '') + ' touch-action: pan-x pan-y;'}
>
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
          <option value="Helvetica" style="font-family: Arial, sans-serif;">Standard Sans (Arial)</option>
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
          bind:value={activeDoc.activeTextAlignment} 
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
    <div class="flex flex-col items-center gap-6 pb-24 origin-top transition-transform duration-150">
      {#each activeDoc.pageOrder as pageNumber (pageNumber)}
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
