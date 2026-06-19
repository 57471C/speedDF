<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc, rotatePageAction } from "../pdfStore.svelte"; 
  
  let { darkMode = $bindable(), onMinimize, onMaximize, onClose } = $props();

  async function triggerFileOpen() {
    try {
      console.log("Invoking native Windows file dialog...");
      const rawPdfBytes: number[] = await invoke("native_open_file");
      
      if (!rawPdfBytes || rawPdfBytes.length === 0) return;
      
      const typedBytes = new Uint8Array(rawPdfBytes);
      console.log(`Successfully captured ${typedBytes.length} file bytes!`);

      const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;

      // BROADCAST TO THE REST OF THE APP
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
  <div class="flex items-center gap-6 pointer-events-none">
    <h1 
      class="text-sm font-bold tracking-tight text-slate-100" 
      style="font-family: 'Space Grotesk', sans-serif;"
    >
      speed<span class="text-cyan-400">DF</span>
    </h1>
  </div>

  <div class="flex items-center gap-1.5 text-xs text-slate-400 font-medium z-50">
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