<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte"; // ⚡ Enforced your mandatory .ts extension

  let { darkMode = $bindable(), onMinimize, onMaximize, onClose } = $props();

  async function triggerFileOpen() {
    try {
      console.log("Invoking native Windows file dialog...");
      const rawPdfBytes: number[] = await invoke("native_open_file");
      
      if (!rawPdfBytes || rawPdfBytes.length === 0) return;
      
      const typedBytes = new Uint8Array(rawPdfBytes);
      console.log(`Successfully captured ${typedBytes.length} file bytes!`);

      // ⚡ FIX: Pass a shallow memory slice clone so the background worker doesn't detach our original buffer!
      const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;

      // BROADCAST SECURE, INTACT BYTES TO THE STORE
      activeDoc.rawBytes = typedBytes;
      activeDoc.pageCount = pdfDocument.numPages;
      activeDoc.currentPage = 1;
      (activeDoc as any).scrollTop = 0;

      console.log(`Document successfully bound to reactive store! Pages: ${pdfDocument.numPages}`);
    } catch (err) {
      console.warn("Open File Action aborted or failed:", err);
    }
  }

  async function triggerFileSaveAs() {
    try {
      if (!activeDoc.rawBytes) return console.warn("No active document data to save.");
      
      const response = await invoke("native_save_as_file", {
        fileBytes: Array.from(activeDoc.rawBytes),
      });
      console.log(response);
    } catch (err) {
      console.warn("Save As Action aborted or failed:", err);
    }
  }
</script>
<div 
  data-tauri-drag-region 
  class="h-10 w-full bg-[#090d16] border-b border-slate-900 flex items-center justify-between px-4 select-none cursor-default"
>
  <div class="flex items-center gap-6">
    <span class="text-[#00d2ff] font-bold text-sm tracking-wide">speedDF ⚡</span>
    
    <div class="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
      <button onclick={triggerFileOpen} class="px-2 py-1 rounded hover:bg-slate-800/40 hover:text-white transition-colors">
        Open
      </button>
      <button onclick={() => console.log('Quick Save')} class="px-2 py-1 rounded hover:bg-slate-800/40 hover:text-white transition-colors">
        Save
      </button>
      <button onclick={triggerFileSaveAs} class="px-2 py-1 rounded hover:bg-slate-800/40 hover:text-white transition-colors">
        Save As..
      </button>
    </div>
  </div>

  <div class="flex items-center gap-4">
    <button onclick={() => darkMode = !darkMode} class="p-1 rounded-md text-slate-500 hover:text-slate-200 transition-colors">
      {#if darkMode}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      {/if}
    </button>

    <div class="flex items-center gap-0.5">
      <button aria-label="Minimise" onclick={onMinimize} class="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button aria-label="Mamximise" onclick={onMaximize} class="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
      </button>
      <button aria-label="Close" onclick={onClose} class="p-1.5 text-slate-500 hover:text-white hover:bg-rose-600 rounded transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
</div>