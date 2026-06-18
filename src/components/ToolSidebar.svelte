<script lang="ts">
import { slide } from "svelte/transition";

type ToolType =
	| "select"
	| "text"
	| "shape"
	| "signature"
	| "stamp"
	| null;
let { activeTool = $bindable() } = $props();

let textSize = $state(24);
let stamps = ["APPROVED", "DRAFT", "URGENT", "VOID"];
let shapes = ["Square", "Circle", "Triangle", "Line", "Arrow", "Star"];
</script>

<div class="flex h-full border-r border-slate-900 bg-[#090d16]">
  
  <aside class="w-14 h-full border-r border-slate-900/50 flex flex-col items-center py-3 gap-3">
    <button onclick={() => activeTool = activeTool === 'select' ? null : 'select'} aria-label="Select Tool" class="p-2.5 rounded-md text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all {activeTool === 'select' ? '!text-[#00d2ff] bg-slate-800/40' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 16.93 2.47-7.4 7.4-2.47Z"/><path d="m14 14 4 4"/></svg>
    </button>
    <button onclick={() => activeTool = activeTool === 'text' ? null : 'text'} aria-label="Text Tool" class="p-2.5 rounded-md text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all {activeTool === 'text' ? '!text-[#00d2ff] bg-slate-800/40' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
    </button>
    <button onclick={() => activeTool = activeTool === 'shape' ? null : 'shape'} aria-label="Shape Tool" class="p-2.5 rounded-md text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all {activeTool === 'shape' ? '!text-[#00d2ff] bg-slate-800/40' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
    </button>
    <button onclick={() => activeTool = activeTool === 'stamp' ? null : 'stamp'} aria-label="Stamp Tool" class="p-2.5 rounded-md text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all {activeTool === 'stamp' ? '!text-[#00d2ff] bg-slate-800/40' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7z"/><path d="M21 3l-6 6"/><path d="M15 3v6h6"/></svg>
    </button>
  </aside>

  {#if activeTool}
    <div 
      transition:slide={{ axis: 'x', duration: 200 }}
      class="w-56 h-full p-4 border-l border-slate-900/30 overflow-hidden flex flex-col"
    >
      <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">
        {activeTool} Properties
      </h3>

      {#if activeTool === 'text'}
        <div class="space-y-4">
          <div class="space-y-1.5">
            <label for="font-size-slider" class="text-[10px] text-slate-400 font-medium">Font Size ({textSize}px)</label>
            <input id="font-size-slider" type="range" bind:value={textSize} class="w-full accent-[#00d2ff] h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" min="8" max="72"/>
          </div>
          <div class="grid grid-cols-4 gap-1.5">
            {#each ['B', 'I', 'U', 'S'] as style}
              <button class="py-1 bg-slate-800/50 border border-slate-700/30 hover:border-[#00d2ff]/40 rounded text-xs font-semibold text-slate-300">
                {style}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if activeTool === 'stamp'}
        <div class="grid grid-cols-1 gap-2">
          {#each stamps as stamp}
            <button class="py-2.5 border border-dashed rounded font-black text-xs text-center tracking-wide
              {stamp === 'APPROVED' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 
               stamp === 'DRAFT' ? 'border-slate-500/30 text-slate-400 bg-slate-500/5' :
               stamp === 'URGENT' ? 'border-rose-500/30 text-rose-400 bg-rose-500/5' :
               'border-amber-500/30 text-amber-400 bg-amber-500/5'}">
              {stamp}
            </button>
          {/each}
        </div>
      {/if}

      {#if activeTool === 'shape'}
        <div class="grid grid-cols-2 gap-2">
          {#each shapes as shape}
            <button class="p-3 bg-slate-800/30 border border-slate-700/20 hover:border-[#00d2ff]/30 text-slate-400 hover:text-white rounded flex flex-col items-center justify-center text-[9px] font-medium gap-2">
              <div class="w-4 h-4 border border-current rounded-sm"></div>
              {shape}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>