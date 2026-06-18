<script lang="ts">
  import { activeDoc } from "../pdfStore.svelte"; // ⚡ No trailing .ts
  import WorkspacePage from "./WorkspacePage.svelte"; 

  let zoomScale = $state(100);
  let totalPages = $derived(activeDoc.pageCount);
  let scrollContainer = $state<HTMLDivElement | null>(null);

  function handleScroll() {
    if (!scrollContainer) return;
    // Broadcast parameters straight out to the unified store instance
    (activeDoc as any).scrollTop = scrollContainer.scrollTop;
    (activeDoc as any).scrollHeight = scrollContainer.scrollHeight;
    (activeDoc as any).clientHeight = scrollContainer.clientHeight;
  }

  $effect(() => {
    if (scrollContainer && activeDoc.rawBytes) {
      handleScroll();
    }
  });
</script>

<div class="flex-1 bg-[#0f172a] relative overflow-hidden flex flex-col">
  <div 
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto w-full h-full flex flex-col items-center pt-12 pb-32 px-12 scroll-smooth"
  >
    {#if activeDoc.rawBytes && totalPages > 0}
      <div class="flex flex-col items-center">
        {#each Array(totalPages) as _, i}
          <WorkspacePage bytes={activeDoc.rawBytes} pageNumber={i + 1} {zoomScale} />
        {/each}
      </div>
    {:else}
      <div class="m-auto w-[595px] h-[842px] bg-white relative flex flex-col items-center justify-center text-slate-300 font-medium tracking-wide text-xs opacity-40 pointer-events-none select-none rounded-sm" style="box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);">
        <svg class="w-10 h-10 mb-3 opacity-60" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
        </svg>
        Select "Open" to Load a PDF File
      </div>
    {/if}
  </div>

  <div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-zinc-950/80 backdrop-blur-md border border-slate-800/80 rounded-full px-4 py-2 gap-4 shadow-xl text-xs font-medium text-slate-400 z-50">
    <button onclick={() => { if (zoomScale > 50) zoomScale -= 10; }} aria-label="Zoom Out" class="hover:text-[#00d2ff] transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <span class="font-mono min-w-[35px] text-center select-none">{zoomScale}%</span>
    <button onclick={() => { if (zoomScale < 200) zoomScale += 10; }} aria-label="Zoom In" class="hover:text-[#00d2ff] transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>
</div>