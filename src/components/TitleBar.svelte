<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte";

  // ⚡ FIXED: Property names aligned precisely with what your +page.svelte sends
  let {
    onMinimize,
    onMaximize,
    onClose,
    darkMode,
    onToggleTheme,
    onToggleHelp,
  }: {
    onMinimize: () => void;
    onMaximize: () => void;
    onClose: () => void;
    darkMode: boolean;
    onToggleTheme: () => void;
    onToggleHelp: () => void;
  } = $props();

  interface FilePayload {
    bytes: number[];
    name: string;
  }

  async function triggerFileOpen() {
    try {
      console.log("Invoking native Windows file dialog payload bridge...");
      const payload = await invoke<FilePayload>("native_open_file");
      if (payload && payload.bytes) {
        const typedBytes = new Uint8Array(payload.bytes);
        const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
        const pdfDocument = await loadingTask.promise;

        activeDoc.rawBytes = typedBytes;
        activeDoc.pageCount = pdfDocument.numPages;
        activeDoc.pageOrder = Array.from(
          { length: pdfDocument.numPages },
          (_, idx) => idx + 1,
        );
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.fileName = payload.name;
      }
    } catch (err) {
      console.error("Native file load intercept breakdown:", err);
    }
  }

  async function triggerFileSaveAs() {
    if (!activeDoc.rawBytes) return;
    try {
      await invoke("native_save_file", {
        fileBytes: Array.from(activeDoc.rawBytes),
      });
      console.log("Document footprint committed cleanly to disk.");
    } catch (err) {
      if (err !== "User cancelled save layout") {
        console.error("File generation layer fault:", err);
      }
    }
  }
</script>

<div
  data-tauri-drag-region
  class="h-9 w-full bg-[#0b101c] border-b border-slate-900 flex items-center justify-between px-3 select-none relative z-50 font-sans"
>
  <div class="flex items-center gap-4 z-50">
    <div class="flex items-center gap-1.5 pointer-events-none">
      <div
        class="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"
      ></div>
      <span
        class="text-[10px] font-bold tracking-widest uppercase text-slate-400"
        >speedDF</span
      >
    </div>

    <div class="flex items-center gap-1 text-[11px] text-slate-400 font-bold">
      <button
        onclick={triggerFileOpen}
        class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors"
        >Open</button
      >
      <button
        onclick={() => console.log("Quick Save triggered")}
        class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors"
        >Save</button
      >
      <button
        onclick={triggerFileSaveAs}
        class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors"
        >Save As..</button
      >
    </div>
  </div>

  <div
    data-tauri-drag-region
    class="absolute inset-0 flex items-center justify-center pointer-events-none"
  >
    <span
      class="text-[11px] font-semibold text-slate-500 tracking-wide truncate max-w-xs"
    >
      {activeDoc.fileName ? activeDoc.fileName : "No Document Active"}
    </span>
  </div>

  <div class="flex items-center gap-3 z-50">
    <div class="flex items-center gap-1">
      <button
        onclick={onToggleTheme}
        class="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
        title="Toggle Core Theme Interface"
      >
        {#if darkMode}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg
          >
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path
              d="M12 20v2"
            /><path d="m4.93 4.93 1.41 1.41" /><path
              d="m17.66 17.66 1.41 1.41"
            /><path d="M2 12h2" /><path d="M20 12h2" /><path
              d="m6.34 17.66-1.41 1.41"
            /><path d="m19.07 4.93-1.41 1.41" /></svg
          >
        {/if}
      </button>

      <button
        onclick={onToggleHelp}
        class="p-1 rounded-md text-slate-400 hover:text-emerald-400 hover:bg-slate-800/50 transition-colors flex items-center justify-center"
        title="System Help Information Operations (F1)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </button>
    </div>

    <div class="flex items-center h-full border-l border-slate-900/60 pl-2">
      <button
        onclick={onMinimize}
        class="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-slate-800/40 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg
        >
      </button>
      <button
        onclick={onMaximize}
        class="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-slate-800/40 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          ><rect width="18" height="18" x="3" y="3" rx="2" /></svg
        >
      </button>
      <button
        onclick={onClose}
        class="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          ><line x1="18" y1="6" x2="6" y2="18" /><line
            x1="6"
            y1="6"
            x2="18"
            y2="18"
          /></svg
        >
      </button>
    </div>
  </div>
</div>
