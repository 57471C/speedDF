<script lang="ts">
  import WorkspacePage from "./WorkspacePage.svelte";
  import { activeDoc, FONT_MAP, pushHistorySnapshot } from "../pdfStore.svelte";

  let { zoomScale = $bindable(120) } = $props<{ zoomScale: number }>();
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
</script>

<svelte:window onclick={handleWindowClick} />

<div
  bind:this={scrollContainer}
  onscroll={handleScroll}
  class="flex-1 h-full overflow-y-auto bg-[#0b0f19] flex flex-col items-center pt-8 px-4 relative scroll-smooth"
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
    {#each activeDoc.pageOrder as pageNumber (pageNumber)}
      <WorkspacePage bytes={activeDoc.rawBytes} {pageNumber} {zoomScale} />
    {/each}
  {:else}
    <div
      class="m-auto flex flex-col items-center justify-center text-center max-w-sm pointer-events-none select-none animate-fade-in"
    >
      <svg
        width="112"
        height="112"
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        class="block mb-5 drop-shadow-[0_0_25px_rgba(6,182,212,0.25)]"
      >
        <defs>
          <linearGradient
            id="dashboard-bg-grad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stop-color="#0f172a"></stop>
            <stop offset="100%" stop-color="#1a2744"></stop>
          </linearGradient>
          <linearGradient
            id="dashboard-bolt-grad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="100%" stop-color="#06b6d4"></stop>
          </linearGradient>
          <filter
            id="dashboard-bolt-glow"
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
          >
            <feGaussianBlur stdDeviation="8" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
              <feMergeNode in="SourceGraphic"></feMergeNode>
            </feMerge>
          </filter>
          <filter
            id="dashboard-glow-soft"
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
          >
            <feGaussianBlur stdDeviation="18" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
            </feMerge>
          </filter>
        </defs>
        <rect
          x="0"
          y="0"
          width="512"
          height="512"
          rx="108"
          ry="108"
          fill="url(#dashboard-bg-grad)"
        ></rect>
        <g opacity="0.28">
          <line
            x1="52"
            y1="218"
            x2="128"
            y2="218"
            stroke="#06b6d4"
            stroke-width="6"
            stroke-linecap="round"
          ></line>
          <line
            x1="38"
            y1="244"
            x2="118"
            y2="244"
            stroke="#06b6d4"
            stroke-width="5"
            stroke-linecap="round"
          ></line>
          <line
            x1="52"
            y1="270"
            x2="108"
            y2="270"
            stroke="#06b6d4"
            stroke-width="4"
            stroke-linecap="round"
          ></line>
        </g>
        <g transform="translate(256, 264) rotate(-4) translate(-256, -264)">
          <polygon
            points="168,118 338,118 338,128 348,138 348,420 168,420"
            fill="#0a1628"
            opacity="0.5"
            transform="translate(8, 8)"
          ></polygon>
          <polygon
            points="162,112 322,112 362,152 362,414 162,414"
            fill="#1e293b"
          ></polygon>
          <polygon points="322,112 362,112 362,152" fill="#0f172a"></polygon>
          <polygon points="322,112 362,152 322,152" fill="#334155"></polygon>
          <line
            x1="190"
            y1="195"
            x2="330"
            y2="195"
            stroke="#334155"
            stroke-width="7"
            stroke-linecap="round"
          ></line>
          <line
            x1="190"
            y1="218"
            x2="300"
            y2="218"
            stroke="#334155"
            stroke-width="7"
            stroke-linecap="round"
          ></line>
          <line
            x1="190"
            y1="241"
            x2="315"
            y2="241"
            stroke="#334155"
            stroke-width="7"
            stroke-linecap="round"
          ></line>
          <line
            x1="190"
            y1="315"
            x2="330"
            y2="315"
            stroke="#334155"
            stroke-width="6"
            stroke-linecap="round"
          ></line>
          <line
            x1="190"
            y1="336"
            x2="280"
            y2="336"
            stroke="#334155"
            stroke-width="6"
            stroke-linecap="round"
          ></line>
          <line
            x1="190"
            y1="357"
            x2="305"
            y2="357"
            stroke="#334155"
            stroke-width="6"
            stroke-linecap="round"
          ></line>
        </g>
        <ellipse
          cx="278"
          cy="264"
          rx="68"
          ry="110"
          fill="#06b6d4"
          opacity="0.12"
          filter="url(#dashboard-glow-soft)"
        ></ellipse>
        <g filter="url(#dashboard-bolt-glow)">
          <polygon
            points="306,138 248,276 284,276 206,396 174,396 236,262 200,262 256,138"
            fill="url(#dashboard-bolt-grad)"
          ></polygon>
        </g>
        <polygon
          points="296,155 254,264 278,264 220,368 246,368 290,264 266,264 302,168"
          fill="#bae6fd"
          opacity="0.35"
        ></polygon>
      </svg>

      <h2
        class="text-base font-extrabold tracking-wide text-slate-100 mb-1.5 font-sans"
        style="font-family: 'Space Grotesk', sans-serif;"
      >
        Welcome to speed<span class="text-cyan-400">DF</span>
      </h2>
      <p class="text-[11px] text-slate-500 leading-relaxed font-medium">
        Click "Open" in the titlebar to load a document into the active workspace.
      </p>
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
      <span
        class="text-[10px] font-bold text-slate-300 w-10 text-center tracking-wider uppercase"
        >{zoomScale}%</span
      >
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
</style>
