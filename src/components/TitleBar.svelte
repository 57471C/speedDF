<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc, undoStack, redoStack } from "../pdfStore.svelte";
  import {
    flattenWorkspaceToPDF,
    flattenWorkspaceToImage,
    syncLiveThumbnail,
    getAnnotatedPdfBytes as getAnnotatedPdfBytesImpl,
  } from "../lib/export/flatten";

  let {
    onMinimize,
    onMaximize,
    onClose,
    onToggleHelp,
    onPrint,
    onOpenFile,
    onCloseDocument,
    onSaveSuccess,
    onToggleOcr,
    // --- NEW TOOLBAR PROPS ---
    onNew,
    onSave,
    onSaveAs,
    onUndo,
    onRedo,
  }: {
    onMinimize: () => void;
    onMaximize: () => void;
    onClose: () => void;
    onToggleHelp: () => void;
    onPrint?: () => void;
    onOpenFile?: () => void;
    onCloseDocument?: () => void;
    onSaveSuccess?: (msg: string) => void;
    onToggleOcr?: () => void;
    // --- NEW TOOLBAR PROPS TYPES ---
    onNew?: () => void;
    onSave?: () => void;
    onSaveAs?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  interface FilePayload {
    bytes: number[];
    name: string;
    path: string;
  }

  async function triggerFileOpen() {
    if (onOpenFile) {
      onOpenFile();
      return;
    }
    try {
      console.log("Invoking native Windows file dialog payload bridge...");
      const payload = await invoke<FilePayload>("native_open_file");
      if (payload && payload.bytes) {
        const typedBytes = new Uint8Array(payload.bytes);
        const loadingTask = pdfjsLib.getDocument({
          data: typedBytes.slice(0),
          cMapUrl: window.location.origin + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: window.location.origin + "/standard_fonts/",
          wasmUrl: window.location.origin + "/"
        });
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
        activeDoc.filePath = payload.path;
        // Ingestion of outlines / bookmarks
        try {
          const outline = await pdfDocument.getOutline();
          if (outline && outline.length > 0) {
            const loadedBookmarks = [];
            for (const item of outline) {
              let pageNum = 1;
              if (item.dest) {
                let destObj: any = item.dest;
                if (typeof destObj === 'string') {
                  destObj = await pdfDocument.getDestination(destObj);
                }
                if (Array.isArray(destObj) && destObj[0]) {
                  const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
                  pageNum = pageIndex + 1;
                }
              }
              loadedBookmarks.push({ pageNum, name: item.title || "" });
            }
            activeDoc.bookmarks = loadedBookmarks;
          } else {
            activeDoc.bookmarks = [];
          }
        } catch (outlineErr) {
          console.error("Failed to parse document outline tree:", outlineErr);
          activeDoc.bookmarks = [];
        }
      }
    } catch (err) {
      console.error("Native file load intercept breakdown:", err);
    }
  }

  async function triggerFileSaveAs() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    try {
      let defaultName = "";

      if (activeDoc.fileType === 'image') {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(jpg|jpeg|png)$/i, "") + "_revised.jpg"
          : 'Untitled.jpg';
      } else {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(pdf|tiff|tif)$/i, "") + "_revised.pdf"
          : 'Untitled.pdf';
      }

      // 1. Generate dynamic window filters based on file session mode
      const dialogFilters = activeDoc.fileType === 'image'
        ? [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png']
            }
          ]
        : [
            {
              name: 'PDF',
              extensions: ['pdf']
            }
          ];

      // 2. Pass these filters down into the native Tauri save picker launch options
      const savedPath = await save({
        defaultPath: defaultName,
        filters: dialogFilters
      });

      if (!savedPath) return;

      let compiledBytes: Uint8Array | null = null;
      if (activeDoc.fileType === 'image') {
        console.log("Compiling and flattening image annotations...");
        compiledBytes = await flattenWorkspaceToImage(savedPath);
      } else {
        console.log("Compiling and flattening PDF annotations...");
        compiledBytes = await flattenWorkspaceToPDF();
      }

      if (!compiledBytes) {
        alert("Failed to compile annotations.");
        return;
      }

      syncLiveThumbnail(savedPath, compiledBytes);
      await invoke("native_overwrite_file", {
        path: savedPath,
        fileBytes: Array.from(compiledBytes),
      });
      activeDoc.filePath = savedPath;
      const parts = savedPath.split(/[\\/]/);
      activeDoc.fileName = parts[parts.length - 1];
      activeDoc.isDirty = false;
      if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
      console.log("Document footprint committed cleanly to disk via Save As.");
    } catch (err) {
      if (err !== "User cancelled save layout") {
        console.error("File generation layer fault:", err);
      }
    }
  }

  async function triggerFileSave() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    if (!activeDoc.filePath) {
      await triggerFileSaveAs();
      return;
    }
    try {
      if (activeDoc.fileType === 'image') {
        console.log("Compiling and flattening image annotations for silent save...");
        const compiledBytes = await flattenWorkspaceToImage(activeDoc.filePath);
        if (!compiledBytes) {
          alert("Failed to compile annotations into Image object stream.");
          return;
        }
        syncLiveThumbnail(activeDoc.filePath, compiledBytes);
        await invoke("native_overwrite_file", {
          path: activeDoc.filePath,
          fileBytes: Array.from(compiledBytes),
        });
        activeDoc.isDirty = false;
        console.log("Document footprint committed silently to disk.");
        if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
        return;
      }

      console.log(
        "Compiling and flattening PDF annotations for silent save...",
      );
      const compiledBytes = await flattenWorkspaceToPDF();
      if (!compiledBytes) {
        alert("Failed to compile annotations into PDF object stream.");
        return;
      }
      syncLiveThumbnail(activeDoc.filePath, compiledBytes);
      await invoke("native_overwrite_file", {
        path: activeDoc.filePath,
        fileBytes: Array.from(compiledBytes),
      });
      activeDoc.isDirty = false;
      console.log("Document footprint committed silently to disk.");
      if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
    } catch (err) {
      console.error("Silent file overwrite fault:", err);
    }
  }

  function closeActiveDocument() {
    activeDoc.rawBytes = null;
    activeDoc.fileName = "";
    activeDoc.filePath = null;
    activeDoc.pageCount = 0;
    activeDoc.pageOrder = [];
    activeDoc.currentPage = 1;
    activeDoc.shapes = {};
  }

  function handlePrintClick() {
    if (onPrint) {
      onPrint();
    } else {
      console.error("TitleBar: onPrint prop callback is undefined/not passed!");
    }
  }

  // Export methods to be called via bind:this reference
  export const triggerOpen = triggerFileOpen;
  export const triggerSave = triggerFileSave;
  export const triggerSaveAs = triggerFileSaveAs;
  export const getAnnotatedPdfBytes = getAnnotatedPdfBytesImpl;
</script>

<div
  class="h-9 w-full bg-[#0b101c] border-b border-slate-900 select-none relative z-50 font-sans"
>
  <div data-tauri-drag-region class="absolute inset-0 z-0 bg-transparent pointer-events-auto"></div>

  <div class="relative z-10 w-full h-full flex items-center justify-between px-3 pointer-events-none">
    <div class="flex items-center gap-4 z-50">
      <div class="flex items-center gap-2 pointer-events-none">
        <svg
          width="22"
          height="22"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
          data-fg-d3bl89="0.8:1.18514:/src/app/App.tsx:215:5:7461:343:e:svg:ete:1"
          data-fgid-d3bl89=":r4i:"
          data-fg-callsite-d3bl187=""
          style="display: block;"
        >
          <rect
            x="0"
            y="0"
            width="32"
            height="32"
            rx="6"
            fill="#0f172a"
            data-fg-d3bl90="0.8:1.18514:/src/app/App.tsx:222:7:7619:65:e:rect"
          ></rect>
          <polygon
            points="20,4 14,16 18,16 11,28 9,28 16,16 12,16 18,4"
            fill="#06b6d4"
            data-fg-d3bl91="0.8:1.18514:/src/app/App.tsx:223:7:7691:102:e:polygon"
          ></polygon>
        </svg>
        <h1 class="text-lg font-bold tracking-tight text-slate-100" style="font-family: 'Space Grotesk', sans-serif;">speed<span class="text-cyan-400">DF</span></h1>
      </div>

      <div class="flex items-center gap-0.5 ml-4">
        <button 
          disabled={!!activeDoc.rawBytes}
          onclick={onNew} 
          title="New Blank A4 (Ctrl+N)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>

        <button onclick={onOpenFile} title="Open Document (Ctrl+O)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>

        <button onclick={onSave} title="Save (Ctrl+S)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>

        <button onclick={onSaveAs} title="Save As... (Ctrl+Shift+S)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.33 13H8a1 1 0 00-1 1v7" />
            <path d="M14.363 17.634a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506l4.013-4.009a1 1 0 10-3.004-3.004z" />
            <path d="M7 3v4a1 1 0 001 1h7" />
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h10.2a2 2 0 011.4.6l3.8 3.8a2 2 0 01.6 1.4v.3" />
          </svg>
        </button>

        <button onclick={onPrint} title="Print (Ctrl+P)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>
          </svg>
        </button>

        <div class="w-px h-4 bg-slate-700 mx-1.5"></div>

        <button 
          disabled={!activeDoc.rawBytes || undoStack.length === 0}
          onclick={onUndo} 
          title="Undo (Ctrl+Z)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>

        <button 
          disabled={!activeDoc.rawBytes || redoStack.length === 0}
          onclick={onRedo} 
          title="Redo (Ctrl+Y)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
          </svg>
        </button>

        <div class="w-px h-4 bg-slate-700 mx-1.5"></div>

        <button 
          disabled={!activeDoc.rawBytes}
          onclick={onToggleOcr} 
          title="Extract Text" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a4 4 0 0 1 4 4"/><path d="M21 17a4 4 0 0 1-4 4"/><path d="M7 21a4 4 0 0 1-4-4"/><path d="M3 7a4 4 0 0 1 4-4"/>
            <path d="M12 7l3 9"/><path d="M9 16h6"/><path d="M12 7L9 16"/>
          </svg>
        </button>
      </div>
    </div>

    <div
      class="flex-1 h-full flex items-center justify-center cursor-move"
    >
      <div class="flex items-center gap-1.5 pointer-events-auto cursor-default">
        <span
          class="titlebar-btn text-[11px] font-semibold text-slate-400 tracking-wide truncate max-w-xs hover:!text-white transition-colors"
        >
          {activeDoc.fileName ?
            activeDoc.fileName : "No Document Active"}
        </span>
        {#if activeDoc.fileName}
          <button
            onclick={() => { if (typeof onCloseDocument === 'function') onCloseDocument();
            else closeActiveDocument(); }}
            class="titlebar-btn w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:!text-white transition-colors pointer-events-auto"
            title="Close Document"
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
              ><line x1="18" y1="6" x2="6" y2="18"></line><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
            ></line></svg>
          </button>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-3 z-50">
      <div class="flex items-center gap-1">
        <button
          onclick={onToggleHelp}
          class="titlebar-btn p-1 rounded-md text-slate-400 hover:!text-white transition-colors flex items-center justify-center"
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
          class="titlebar-btn w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:!text-white transition-colors"
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
          class="titlebar-btn w-7 h-7 
            flex items-center justify-center rounded text-slate-400 hover:!text-white transition-colors"
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
          class="titlebar-close-btn w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:!bg-red-600 hover:!text-white transition-all"
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
            ></line></svg
          >
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .toolbar-btn {
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: #94a3b8;
    cursor: pointer;
    pointer-events: auto;
    transition: color 0.15s ease, background-color 0.15s ease;
  }
  
  .toolbar-btn:hover {
    background-color: #1e293b;
    color: #f1f5f9;
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  .titlebar-btn {
    color: #94a3b8 !important;
    /* text-slate-400 fallback */
    transition: color 0.15s ease, background-color 0.15s ease !important;
    pointer-events: auto !important;
  }
  .titlebar-btn:hover {
    color: #ffffff !important;
  }
  .titlebar-close-btn {
    color: #94a3b8 !important;
    pointer-events: auto !important;
    transition: all 0.15s ease !important;
  }
  .titlebar-close-btn:hover {
    background-color: #dc2626 !important;
    /* bg-red-600 fallback */
    color: #ffffff !important;
  }
</style>