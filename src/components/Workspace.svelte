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
      <div class="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <h2 class="text-xs font-bold uppercase tracking-widest text-slate-200 mb-1 font-sans">Welcome to speed<span class="text-cyan-400">DF</span></h2>
      <p class="text-[11px] text-slate-500 leading-relaxed font-medium">Click "Open" in the header titlebar above to load a document into the active workspace pipeline.</p>
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