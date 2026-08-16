<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import * as pdfjsLib from "pdfjs-dist";
  import {
    activeDoc,
    undoStack,
    redoStack,
    commitActiveDocumentAfterSave,
    applyLiveThumbnail,
    toggleMarkdownSplitView,
  } from "../pdfStore.svelte";
  import {
    flattenWorkspaceToPDF,
    flattenWorkspaceToImage,
    syncLiveThumbnail,
    getAnnotatedPdfBytes as getAnnotatedPdfBytesImpl,
  } from "../lib/export/flatten";
  import { decodeCommentsFromKeywords } from "../lib/comments/comments";
  import { extractFormFields } from "../lib/forms/formFields";
  import { extractHyperlinks } from "../lib/links/hyperlinks";
  import {
    captureMarkdownViewThumbnail,
    findMarkdownContentRoot,
  } from "../lib/markdown/thumbnail";
  import { encodeMarkdownSource } from "../lib/markdown/source";

  let {
    onMinimize,
    onMaximize,
    onClose,
    onToggleHelp,
    onToggleSettings,
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
    onToggleSettings?: () => void;
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
            const BATCH_SIZE = 50;
            for (let i = 0; i < outline.length; i += BATCH_SIZE) {
              const batch = outline.slice(i, i + BATCH_SIZE);
              const results = await Promise.all(
                batch.map(async (item) => {
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
                  return { pageNum, name: item.title || "" };
                })
              );
              loadedBookmarks.push(...results);
            }
            activeDoc.bookmarks = loadedBookmarks;
          } else {
            activeDoc.bookmarks = [];
          }
        } catch (outlineErr) {
          console.error("Failed to parse document outline tree:", outlineErr);
          activeDoc.bookmarks = [];
        }
        try {
          const meta = await pdfDocument.getMetadata();
          const keywords =
            (meta?.info as { Keywords?: string } | undefined)?.Keywords ??
            (meta?.info as { keywords?: string } | undefined)?.keywords ??
            "";
          const loaded = decodeCommentsFromKeywords(keywords);
          activeDoc.comments = loaded ?? [];
        } catch (commentsErr) {
          console.warn("Failed to load document comments metadata:", commentsErr);
          activeDoc.comments = [];
        }
        try {
          const extracted = await extractFormFields(typedBytes);
          activeDoc.formFields = extracted.fields;
          activeDoc.formValues = extracted.values;
        } catch (formErr) {
          console.warn("Form field detection skipped:", formErr);
          activeDoc.formFields = [];
          activeDoc.formValues = {};
        }
        try {
          activeDoc.hyperlinks = await extractHyperlinks(typedBytes);
        } catch (linkErr) {
          console.warn("Hyperlink detection skipped:", linkErr);
          activeDoc.hyperlinks = [];
        }
      }
    } catch (err) {
      console.error("Native file load intercept breakdown:", err);
    }
  }

  function beginSavingLock() {
    if (activeDoc.isSaving) return false;
    activeDoc.isSaving = true;
    // Drop focus so text/input edits cannot continue into the save window
    try {
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
    } catch {
      /* ignore */
    }
    return true;
  }

  function endSavingLock() {
    activeDoc.isSaving = false;
  }

  /** Encode canonical markdownSource (or rawBytes) as UTF-8 for disk write. */
  function markdownBytesForSave(): Uint8Array | null {
    const source =
      activeDoc.markdownSource ??
      (activeDoc.rawBytes
        ? new TextDecoder("utf-8").decode(activeDoc.rawBytes)
        : null);
    if (source == null) return null;
    return encodeMarkdownSource(source);
  }

  /** Re-capture live MarkdownView top after save (same path as open). */
  async function refreshMarkdownThumbnails(
    filePath: string | null | undefined,
  ) {
    try {
      const el = findMarkdownContentRoot();
      if (!el) return;
      const dataUrl = await captureMarkdownViewThumbnail(el);
      if (!dataUrl) return;
      applyLiveThumbnail(dataUrl, filePath ?? null, 0);
    } catch (err) {
      console.warn("Markdown thumbnail refresh after save failed:", err);
    }
  }

  async function triggerFileSaveAs() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    if (activeDoc.isSaving) return;

    // Path picker is interactive — lock only once the user confirms a path
    try {
      let defaultName = "";

      if (activeDoc.fileType === "markdown") {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(md|markdown)$/i, "") + ".md"
          : "Untitled.md";
      } else if (activeDoc.fileType === "image") {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(jpg|jpeg|png)$/i, "") + "_revised.jpg"
          : "Untitled.jpg";
      } else {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(pdf|tiff|tif)$/i, "") + "_revised.pdf"
          : "Untitled.pdf";
      }

      // 1. Generate dynamic window filters based on file session mode
      const dialogFilters =
        activeDoc.fileType === "markdown"
          ? [{ name: "Markdown", extensions: ["md", "markdown"] }]
          : activeDoc.fileType === "image"
            ? [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }]
            : [{ name: "PDF", extensions: ["pdf"] }];

      // 2. Pass these filters down into the native Tauri save picker launch options
      const savedPath = await save({
        defaultPath: defaultName,
        filters: dialogFilters
      });

      if (!savedPath) return;

      if (!beginSavingLock()) return;
      try {
        let compiledBytes: Uint8Array | null = null;
        if (activeDoc.fileType === "markdown") {
          compiledBytes = markdownBytesForSave();
        } else if (activeDoc.fileType === "image") {
          console.log("Compiling and flattening image annotations...");
          compiledBytes = await flattenWorkspaceToImage(savedPath);
        } else {
          console.log("Compiling and flattening PDF annotations...");
          compiledBytes = await flattenWorkspaceToPDF();
        }

        if (!compiledBytes) {
          alert(
            activeDoc.fileType === "markdown"
              ? "Failed to encode markdown source."
              : "Failed to compile annotations.",
          );
          return;
        }

        await invoke("native_overwrite_file", {
          path: savedPath,
          fileBytes: Array.from(compiledBytes),
        });
        // Rebind path/name + rawBytes + clear dirty BEFORE unlocking the UI
        await commitActiveDocumentAfterSave({
          compiledBytes,
          filePath: savedPath,
        });
        if (activeDoc.fileType === "markdown") {
          void refreshMarkdownThumbnails(savedPath);
        } else {
          syncLiveThumbnail(savedPath, compiledBytes);
        }
        if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
        console.log("Document footprint committed cleanly to disk via Save As.");
      } finally {
        endSavingLock();
      }
    } catch (err) {
      endSavingLock();
      if (err !== "User cancelled save layout") {
        console.error("File generation layer fault:", err);
      }
    }
  }

  async function triggerFileSave() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    if (activeDoc.isSaving) return;
    if (!activeDoc.filePath) {
      await triggerFileSaveAs();
      return;
    }
    if (!beginSavingLock()) return;
    try {
      const savePath = activeDoc.filePath;
      if (activeDoc.fileType === "markdown") {
        const compiledBytes = markdownBytesForSave();
        if (!compiledBytes) {
          alert("Failed to encode markdown source.");
          return;
        }
        await invoke("native_overwrite_file", {
          path: savePath,
          fileBytes: Array.from(compiledBytes),
        });
        await commitActiveDocumentAfterSave({
          compiledBytes,
          filePath: savePath,
        });
        void refreshMarkdownThumbnails(savePath);
        console.log("Markdown source committed silently to disk.");
        if (typeof onSaveSuccess === "function")
          onSaveSuccess("File Saved Successfully");
        return;
      }
      if (activeDoc.fileType === 'image') {
        console.log("Compiling and flattening image annotations for silent save...");
        const compiledBytes = await flattenWorkspaceToImage(savePath);
        if (!compiledBytes) {
          alert("Failed to compile annotations into Image object stream.");
          return;
        }
        await invoke("native_overwrite_file", {
          path: savePath,
          fileBytes: Array.from(compiledBytes),
        });
        await commitActiveDocumentAfterSave({
          compiledBytes,
          filePath: savePath,
        });
        syncLiveThumbnail(savePath, compiledBytes);
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
      await invoke("native_overwrite_file", {
        path: savePath,
        fileBytes: Array.from(compiledBytes),
      });
      await commitActiveDocumentAfterSave({
        compiledBytes,
        filePath: savePath,
      });
      syncLiveThumbnail(savePath, compiledBytes);
      console.log("Document footprint committed silently to disk.");
      if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
    } catch (err) {
      console.error("Silent file overwrite fault:", err);
    } finally {
      endSavingLock();
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
    activeDoc.comments = [];
    activeDoc.formFields = [];
    activeDoc.formValues = {};
    activeDoc.hyperlinks = [];
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
  class="h-9 w-full border-b select-none relative z-50 font-sans"
  style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border-subtle);"
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
        <h1 class="text-lg font-bold tracking-tight" style="font-family: 'Space Grotesk', sans-serif; color: var(--sdf-text-primary);">speed<span style="color: var(--sdf-accent-text);">DF</span></h1>
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

        <button
          onclick={onSave}
          title="Save (Ctrl+S)"
          class="toolbar-btn"
          disabled={activeDoc.isSaving || (!activeDoc.rawBytes && !activeDoc.imageUrl)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>

        <button
          onclick={onSaveAs}
          title="Save As... (Ctrl+Shift+S)"
          class="toolbar-btn"
          disabled={activeDoc.isSaving || (!activeDoc.rawBytes && !activeDoc.imageUrl)}
        >
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

        <div class="w-px h-4 mx-1.5" style="background: var(--sdf-border);"></div>

        <button 
          disabled={activeDoc.isSaving || !activeDoc.rawBytes || undoStack.length === 0}
          onclick={onUndo} 
          title="Undo (Ctrl+Z)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>

        <button 
          disabled={activeDoc.isSaving || !activeDoc.rawBytes || redoStack.length === 0}
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
          disabled={!activeDoc.rawBytes || activeDoc.fileType === "markdown"}
          onclick={onToggleOcr} 
          title={activeDoc.fileType === "markdown" ? "OCR is not available for markdown documents" : "Extract Text"} 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 21h1"/><path d="M14 3h1"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 14v1"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M3 9v1"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M5 3a2 2 0 0 0-2 2"/><path d="M7 12h10"/><path d="M7 16h6"/><path d="M7 8h8"/><path d="M9 21h1"/><path d="M9 3h1"/>
          </svg>
        </button>

        {#if activeDoc.fileType === "markdown"}
          <button
            onclick={() => toggleMarkdownSplitView()}
            class="toolbar-btn"
            class:toolbar-btn--active={activeDoc.markdownSplitView}
            title={activeDoc.markdownSplitView
              ? "Preview only (Ctrl+\\)"
              : "Split source and preview (Ctrl+\\)"}
            aria-pressed={activeDoc.markdownSplitView}
            aria-label={activeDoc.markdownSplitView
              ? "Exit split view"
              : "Split source and preview"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M12 3v18" />
            </svg>
          </button>
        {/if}
      </div>
    </div>

    <div
      class="flex-1 h-full flex items-center justify-center cursor-move"
      style="color: var(--sdf-text-secondary);"
    >
      <div class="flex items-center gap-1.5 pointer-events-auto cursor-default">
        <span
          class="titlebar-btn text-[11px] font-semibold tracking-wide truncate max-w-xs transition-colors"
          style="color: var(--sdf-text-secondary);"
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
          onclick={() => onToggleSettings?.()}
          class="titlebar-btn p-1 rounded-md text-slate-400 hover:!text-white transition-colors flex items-center justify-center"
          title="Settings"
          aria-label="Settings"
        >
          <!-- lucide: settings (cog) -->
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
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
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

      <div class="flex items-center h-full border-l pl-2" style="border-color: var(--sdf-border-subtle);">
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
    color: var(--sdf-text-secondary);
    cursor: pointer;
    pointer-events: auto;
    transition: color 0.15s ease, background-color 0.15s ease;
  }
  
  .toolbar-btn:hover {
    background-color: var(--sdf-hover-bg);
    color: var(--sdf-text-primary);
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  .toolbar-btn--active {
    background-color: color-mix(in srgb, var(--sdf-accent) 22%, transparent);
    color: var(--sdf-accent-text);
  }

  .titlebar-btn {
    color: var(--sdf-text-secondary) !important;
    transition: color 0.15s ease, background-color 0.15s ease !important;
    pointer-events: auto !important;
  }
  .titlebar-btn:hover {
    color: var(--sdf-text-primary) !important;
  }
  .titlebar-close-btn {
    color: var(--sdf-text-secondary) !important;
    pointer-events: auto !important;
    transition: all 0.15s ease !important;
  }
  .titlebar-close-btn:hover {
    background-color: #dc2626 !important;
    color: #ffffff !important;
  }
</style>