<script lang="ts">
  import WorkspacePage from "./WorkspacePage.svelte";
  import { activeDoc } from "../pdfStore.svelte";

  let { zoomScale = $bindable(100) } = $props<{ zoomScale: number }>();
</script>

<div class="flex-1 h-full overflow-y-auto bg-[#0b0f19] flex flex-col items-center pt-8 px-4 relative scroll-smooth">
  {#if activeDoc.rawBytes && activeDoc.pageOrder.length > 0}
    
    {#each activeDoc.pageOrder as pageNumber (pageNumber)}
      <WorkspacePage 
        bytes={activeDoc.rawBytes} 
        {pageNumber} 
        zoomScale={zoomScale} 
      />
    {/each}

  {:else}
    <div class="m-auto flex flex-col items-center justify-center text-center max-w-sm pointer-events-none select-none animate-fade-in">
      
      <svg width="112" height="112" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" class="block mb-5 drop-shadow-[0_0_25px_rgba(6,182,212,0.25)]">
        <defs>
          <linearGradient id="dashboard-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"></stop>
            <stop offset="100%" stop-color="#1a2744"></stop>
          </linearGradient>
          <linearGradient id="dashboard-bolt-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="100%" stop-color="#06b6d4"></stop>
          </linearGradient>
          <filter id="dashboard-bolt-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="8" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
              <feMergeNode in="SourceGraphic"></feMergeNode>
            </feMerge>
          </filter>
          <filter id="dashboard-glow-soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="18" result="blur"></feGaussianBlur>
            <feMerge>
              <feMergeNode in="blur"></feMergeNode>
            </feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width="512" height="512" rx="108" ry="108" fill="url(#dashboard-bg-grad)"></rect>
        <g opacity="0.28">
          <line x1="52" y1="218" x2="128" y2="218" stroke="#06b6d4" stroke-width="6" stroke-linecap="round"></line>
          <line x1="38" y1="244" x2="118" y2="244" stroke="#06b6d4" stroke-width="5" stroke-linecap="round"></line>
          <line x1="52" y1="270" x2="108" y2="270" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"></line>
        </g>
        <g transform="translate(256, 264) rotate(-4) translate(-256, -264)">
          <polygon points="168,118 338,118 338,128 348,138 348,420 168,420" fill="#0a1628" opacity="0.5" transform="translate(8, 8)"></polygon>
          <polygon points="162,112 322,112 362,152 362,414 162,414" fill="#1e293b"></polygon>
          <polygon points="322,112 362,112 362,152" fill="#0f172a"></polygon>
          <polygon points="322,112 362,152 322,152" fill="#334155"></polygon>
          <line x1="190" y1="195" x2="330" y2="195" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
          <line x1="190" y1="218" x2="300" y2="218" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
          <line x1="190" y1="241" x2="315" y2="241" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
          <line x1="190" y1="315" x2="330" y2="315" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
          <line x1="190" y1="336" x2="280" y2="336" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
          <line x1="190" y1="357" x2="305" y2="357" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
        </g>
        <ellipse cx="278" cy="264" rx="68" ry="110" fill="#06b6d4" opacity="0.12" filter="url(#dashboard-glow-soft)"></ellipse>
        <g filter="url(#dashboard-bolt-glow)">
          <polygon points="306,138 248,276 284,276 206,396 174,396 236,262 200,262 256,138" fill="url(#dashboard-bolt-grad)"></polygon>
        </g>
        <polygon points="296,155 254,264 278,264 220,368 246,368 290,264 266,264 302,168" fill="#bae6fd" opacity="0.35"></polygon>
      </svg>

      <h2 class="text-base font-extrabold tracking-wide text-slate-100 mb-1.5 font-sans" style="font-family: 'Space Grotesk', sans-serif;">
        Welcome to speed<span class="text-cyan-400">DF</span>
      </h2>
      <p class="text-[11px] text-slate-500 leading-relaxed font-medium">
        Click "Open" in the header titlebar above to load a document into the active workspace pipeline.
      </p>
    </div>
  {/if}

  {#if activeDoc.rawBytes && activeDoc.pageOrder.length > 0}
    <div class="fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-[#090d16]/90 border border-slate-900 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md z-40 select-none pointer-events-auto">
      <button onclick={() => zoomScale = Math.max(50, zoomScale - 10)} class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors">—</button>
      <span class="text-[10px] font-bold text-slate-300 w-10 text-center tracking-wider uppercase">{zoomScale}%</span>
      <button onclick={() => zoomScale = Math.min(200, zoomScale + 10)} class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-full text-xs font-bold transition-colors">+</button>
    </div>
  {/if}
</div>