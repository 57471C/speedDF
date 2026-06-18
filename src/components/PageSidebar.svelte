<script lang="ts">
import { activeDoc } from "../pdfStore.svelte";

// Svelte 5 reactive derivation that monitors your shared store state dynamically
let totalPages = $derived(activeDoc.pageCount);
let activeIndex = $derived(activeDoc.currentPage);

function handleSelectPage(pageNumber: number) {
	activeDoc.currentPage = pageNumber; // Selecting a thumbnail switches the center layout!
}
</script>

<div class="w-48 h-full bg-[#090d16] border-l border-slate-900 flex flex-col select-none">
  
  <div class="p-3 border-b border-slate-900/40 flex items-center gap-2 text-slate-400">
    <svg class="text-[#00d2ff]" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/></svg>
    <span class="text-[10px] font-bold tracking-widest uppercase">Pages ({totalPages})</span>
  </div>

  <div class="flex-1 overflow-y-auto p-4 space-y-4">
    {#if totalPages > 0}
      {#each Array(totalPages) as _, i}
        {@const pageNumber = i + 1}
        <div class="group flex flex-col gap-1.5" onclick={() => handleSelectPage(pageNumber)}>
          <div class="aspect-[3/4] bg-[#1a2333]/40 border rounded relative cursor-pointer transition-all 
            {activeIndex === pageNumber ? 'border-[#00d2ff] bg-[#00d2ff]/5 shadow-[0_0_10px_rgba(0,210,255,0.15)]' : 'border-slate-800/60 hover:border-[#00d2ff]/30'}">
          </div>
          
          <span class="text-[9px] font-semibold text-center uppercase tracking-wider
            {activeIndex === pageNumber ? 'text-[#00d2ff]' : 'text-slate-500'}">
            Page {pageNumber}
          </span>
        </div>
      {/each}
    {:else}
      <div class="text-[10px] text-slate-600 font-medium text-center pt-8 px-2 italic">
        No document active
      </div>
    {/if}
  </div>

  <div class="p-3 border-t border-slate-900/60 bg-[#070a11]/40">
    <button class="w-full py-2 bg-slate-800/30 border border-slate-800 hover:border-[#00d2ff]/30 text-slate-400 hover:text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all">
      <svg class="text-[#00d2ff]" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Merge File
    </button>
  </div>
</div>