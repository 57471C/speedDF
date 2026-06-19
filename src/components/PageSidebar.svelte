<script lang="ts">
  import { onMount } from "svelte";
  import { activeDoc, rotatePageAction } from "../pdfStore.svelte"; 
  import ThumbnailCanvas from "./ThumbnailCanvas.svelte"; 

  let totalPages = $derived(activeDoc.pageCount);
  let activeIndex = $derived(activeDoc.currentPage);

  function handleSelectPage(pageNumber: number) {
    (activeDoc as any).isClickScrolling = true; // Sets manual click scroll animation lock
    activeDoc.currentPage = pageNumber; 
  }

  // Global keyboard listener macro hotkey loops
  onMount(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!activeDoc.rawBytes || totalPages === 0) return;

      if (event.ctrlKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault(); 
        const direction = event.key === "ArrowRight" ? "clockwise" : "counter";
        
        rotatePageAction(activeIndex, direction);
        console.log(`Keyboard hotkey triggered rotation: Page ${activeIndex} ${direction}`);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // AUTOMATIC THUMBNAIL TRACK LIST SCROLL SYNCING
  $effect(() => {
    if (activeIndex) {
      const activeThumbEl = document.querySelector(`[data-page-thumb="${activeIndex}"]`);
      if (activeThumbEl) {
        activeThumbEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    }
  });

  // Minimap viewport calculation engines
  let viewportTopPercent = $derived.by(() => {
    const top = (activeDoc as any).scrollTop ?? 0;
    const totalHeight = (activeDoc as any).scrollHeight ?? 0;
    const count = activeDoc.pageCount ?? 1;
    if (!totalHeight || !count) return 0;
    const pageSlotHeight = totalHeight / count;
    return Math.max(0, Math.min(100, ((top - (activeDoc.currentPage - 1) * pageSlotHeight) / pageSlotHeight) * 100));
  });

  let viewportHeightPercent = $derived.by(() => {
    const viewHeight = (activeDoc as any).clientHeight ?? 0;
    const totalHeight = (activeDoc as any).scrollHeight ?? 0;
    const count = activeDoc.pageCount ?? 1;
    if (!totalHeight || !count) return 100;
    return Math.max(15, Math.min(100, (viewHeight / (totalHeight / count)) * 100));
  });
</script>

<div class="w-48 h-full bg-[#090d16] border-l border-slate-900 flex flex-col select-none">
  
  <div class="p-3 border-b border-slate-900/40 flex items-center gap-2 text-slate-400">
    <svg class="text-[#00d2ff]" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/></svg>
    <span class="text-[10px] font-bold tracking-widest uppercase">Pages ({totalPages})</span>
  </div>

  <div class="flex-1 overflow-y-auto p-4 space-y-5 scroll-smooth">
    {#if totalPages > 0}
      {#each Array(totalPages) as _, i}
        {@const pageNumber = i + 1}
        <div 
          data-page-thumb={pageNumber}
          class="flex flex-col gap-1.5 relative {activeIndex === pageNumber ? 'z-20' : 'z-10'}" 
          onclick={() => handleSelectPage(pageNumber)}
        >
          <div class="aspect-[3/4] bg-[#1a2333]/40 border rounded relative cursor-pointer transition-all overflow-hidden flex items-center justify-center p-1
            {activeIndex === pageNumber ? 'border-[#00d2ff] bg-[#00d2ff]/5 shadow-[0_0_10px_rgba(0,210,255,0.15)]' : 'border-slate-800/60 hover:border-[#00d2ff]/30'}">
            
            {#if activeDoc.rawBytes}
              <ThumbnailCanvas bytes={activeDoc.rawBytes} {pageNumber} />
            {/if}

            {#if activeIndex === pageNumber}
              <div 
                class="absolute left-0 right-0 border-2 border-red-500 bg-transparent pointer-events-none rounded-sm shadow-[0_0_15px_rgba(239,68,68,0.4)] z-30 transition-[top,height] duration-75"
                style="top: {viewportTopPercent}%; height: {viewportHeightPercent}%;"
              ></div>
            {/if}
          </div>
          
          <div class="flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-wider select-none">
            <span class={activeIndex === pageNumber ? 'text-[#00d2ff]' : 'text-slate-400'}>
              Page {pageNumber}
            </span>
            
            <div class="flex items-center gap-1 opacity-40 hover:opacity-100 transition-opacity duration-150">
              <button 
                onclick={(e) => { e.stopPropagation(); rotatePageAction(pageNumber, 'counter'); }}
                class="p-1 bg-[#1a2333]/80 border border-slate-800 hover:border-slate-600 text-slate-300 hover:text-white rounded transition-colors"
                title="Rotate Left"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
              </button>
              <button 
                onclick={(e) => { e.stopPropagation(); rotatePageAction(pageNumber, 'clockwise'); }}
                class="p-1 bg-[#1a2333]/80 border border-slate-800 hover:border-[#00d2ff]/60 text-slate-300 hover:text-[#00d2ff] rounded transition-colors"
                title="Rotate Right"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
              </button>
            </div>
          </div>
          
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