<script lang="ts">
  let pageList = $state([1, 2, 3]);

  function handleDeletePage(pageNumber: number) {
    pageList = pageList.filter(p => p !== pageNumber);
  }
</script>

<div class="w-48 h-full bg-[#090d16] border-l border-slate-900 flex flex-col select-none">
  
  <div class="p-3 border-b border-slate-900/40 flex items-center gap-2 text-slate-400">
    <svg class="text-[#00d2ff]" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/></svg>
    <span class="text-[10px] font-bold tracking-widest uppercase">Pages</span>
  </div>

  <div class="flex-1 overflow-y-auto p-4 space-y-4">
    {#each pageList as pageNumber}
      <div class="group flex flex-col gap-1.5">
        <div class="aspect-[3/4] bg-[#1a2333]/40 border border-slate-800/60 hover:border-[#00d2ff]/30 rounded relative cursor-pointer transition-all">
          
          <div class="absolute inset-0 bg-rose-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button 
  onclick={() => handleDeletePage(pageNumber)}
  aria-label="Delete Page {pageNumber}"
  class="bg-rose-600 hover:bg-rose-500 text-white p-1.5 rounded shadow-lg transition-transform scale-90"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
</button>
          </div>
        </div>
        
        <span class="text-[9px] text-slate-500 font-semibold text-center uppercase tracking-wider">
          Page {pageNumber}
        </span>
      </div>
    {/each}
  </div>

  <div class="p-3 border-t border-slate-900/60 bg-[#070a11]/40">
    <button class="w-full py-2 bg-slate-800/30 border border-slate-800 hover:border-[#00d2ff]/30 text-slate-400 hover:text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all">
      <svg class="text-[#00d2ff]" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Merge File
    </button>
  </div>
</div>