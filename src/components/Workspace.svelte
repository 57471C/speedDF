<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import WorkspacePage from "./WorkspacePage.svelte";
  import { activeDoc, FONT_MAP, pushHistorySnapshot } from "../pdfStore.svelte";

  interface RecentFile {
    name: string;
    path: string;
    timestamp: number;
    thumbnail: string;
  }

  let recentFiles = $state<RecentFile[]>([]);
  let fileStatusMap = $state<Record<string, boolean>>({});

  onMount(() => {
    const stored = localStorage.getItem("speeddf_recents");
    if (stored) {
      try {
        recentFiles = JSON.parse(stored);
        const paths = recentFiles.map(f => f.path);
        if (paths.length > 0) {
          invoke<Record<string, boolean>>("check_files_exist", { paths })
            .then(res => { fileStatusMap = res; })
            .catch(err => console.error(err));
        }
      } catch (e) {}
    }
  });

  $effect(() => {
    if (activeDoc.rawBytes && activeDoc.fileName && activeDoc.filePath) {
      registerRecentFile(activeDoc.fileName, activeDoc.filePath, activeDoc.rawBytes);
    }
  });

  async function registerRecentFile(name: string, path: string, bytes: Uint8Array) {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(1);
      const viewport = page.getViewport({ scale: 0.3 });
      
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport } as any).promise;
        const dataUrl = canvas.toDataURL("image/png");
        
        let currentList: RecentFile[] = [];
        const stored = localStorage.getItem("speeddf_recents");
        if (stored) currentList = JSON.parse(stored);
        
        currentList = currentList.filter(f => f.path !== path);
        currentList.unshift({ name, path, timestamp: Date.now(), thumbnail: dataUrl });
        if (currentList.length > 10) currentList = currentList.slice(0, 10);
        
        localStorage.setItem("speeddf_recents", JSON.stringify(currentList));
        recentFiles = currentList;
      }
    } catch (err) {}
  }

  async function loadRecentFile(file: RecentFile) {
    try {
      const bytesVec = await invoke<number[] | Uint8Array>("read_file_binary", { path: file.path });
      const typedBytes = new Uint8Array(bytesVec);
      
      const loadingTask = pdfjsLib.getDocument({
        data: typedBytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/",
      });
      const pdfDocument = await loadingTask.promise;

      activeDoc.rawBytes = typedBytes;
      activeDoc.pageCount = pdfDocument.numPages;
      activeDoc.pageOrder = Array.from({ length: pdfDocument.numPages }, (_, idx) => idx + 1);
      activeDoc.currentPage = 1;
      activeDoc.shapes = {};
      activeDoc.fileName = file.name;
      activeDoc.filePath = file.path;
    } catch (err) {
      alert("Could not open this file. It may have been moved or deleted.");
    }
  }

  let { zoomScale = $bindable(120), isSystemPrinting = false } = $props<{ zoomScale: number; isSystemPrinting: boolean }>();
  let scrollContainer = $state<HTMLDivElement | null>(null);

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
    activeDoc.zoomScale = zoomScale;
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
      selectedFont = activeTextShape.font || "Helvetica";
      selectedSize = activeTextShape.size || 12;
      selectedStyle = activeTextShape.style || "Normal";
    } else {
      selectedFont = activeDoc.defaultFont;
      selectedSize = activeDoc.defaultSize;
      selectedStyle = activeDoc.defaultStyle || "Normal";
    }
  });

  function handleFontChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    selectedFont = val;
    if (activeTextShape) {
      pushHistorySnapshot();
      activeTextShape.font = val;
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

  // ⚡ FIXED: Broadcasts exact live pixel coordinates straight to the global store on every mouse wheel tick
  function handleScroll(e: Event) {
    const target = e.currentTarget as HTMLDivElement;
    activeDoc.scrollTop = target.scrollTop;
    activeDoc.scrollHeight = target.scrollHeight;
    activeDoc.clientHeight = target.clientHeight;
  }

  // Ctrl + Mouse Wheel Zooming
  $effect(() => {
    if (!scrollContainer) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomScale = Math.min(200, zoomScale + 10);
        } else if (e.deltaY > 0) {
          zoomScale = Math.max(50, zoomScale - 10);
        }
      }
    };
    scrollContainer.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      scrollContainer?.removeEventListener("wheel", handleWheel);
    };
  });

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
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  bind:this={scrollContainer}
  onscroll={handleScroll}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerLeave}
  class="flex-1 h-full overflow-auto bg-[#070a12] flex flex-col items-center pt-8 px-4 relative workspace-scroll-container transition-colors duration-200
    {isDragging ? '' : 'scroll-smooth'}
    [&::-webkit-scrollbar]:w-2 
    [&::-webkit-scrollbar-track]:bg-transparent 
    [&::-webkit-scrollbar-thumb]:bg-slate-800/80 
    [&::-webkit-scrollbar-thumb]:rounded-full 
    hover:[&::-webkit-scrollbar-thumb]:bg-slate-700"
  style={isSpacePressed ? (isDragging ? 'cursor: grabbing;' : 'cursor: grab;') : ''}
>
  {#if showFloatingMenu}
    <div
      class="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[#090d16]/95 border border-slate-800/80 px-4 py-2 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-center gap-3 backdrop-blur-md select-none pointer-events-auto transition-all duration-200"
    >
      <div class="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold tracking-wider uppercase border-r border-slate-800 pr-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-cyan-400"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
        <span>Text Style</span>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Font</span>
        <select
          value={selectedFont}
          onchange={handleFontChange}
          class="bg-slate-900 border border-slate-800 text-slate-200 rounded px-2 py-1 text-xs font-medium outline-none focus:border-cyan-500 transition-colors cursor-pointer"
        >
          <option value="Helvetica">Helvetica</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier">Courier</option>
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
        <WorkspacePage bytes={activeDoc.rawBytes} {pageNumber} {zoomScale} {isSystemPrinting} />
      {/each}
    </div>
  {/if}

  {#if activeDoc.rawBytes && activeDoc.pageOrder.length > 0}
    <div
      class="fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-[#090d16]/90 border border-slate-900 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md z-40 select-none pointer-events-auto"
    >
      <button
        onclick={() => (zoomScale = Math.max(50, zoomScale - 10))}
        class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors"
        >—</button
      >
      <span class="text-[10px] font-bold text-slate-300 w-10 text-center tracking-wider uppercase">{zoomScale}%</span>
      <button
        onclick={() => (zoomScale = Math.min(200, zoomScale + 10))}
        class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors"
        >+</button
      >
    </div>
  {/if}
</div>

<style>
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
