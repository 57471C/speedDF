<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte";
  import { PDFDocument, rgb, degrees } from "pdf-lib";

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
    path: string;
  }

  function hexToRgb(hexString: string): any {
    const hex = hexString.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }

  async function flattenWorkspaceToPDF(): Promise<Uint8Array | null> {
    if (!activeDoc.rawBytes || activeDoc.pageOrder.length === 0) return null;

    try {
      const srcDoc = await PDFDocument.load(activeDoc.rawBytes);
      const destDoc = await PDFDocument.create();
      const copiedPages = await destDoc.copyPages(
        srcDoc,
        activeDoc.pageOrder.map((num) => num - 1),
      );

      for (let i = 0; i < activeDoc.pageOrder.length; i++) {
        const originalPageNumber = activeDoc.pageOrder[i];
        const page = copiedPages[i];
        destDoc.addPage(page);

        const { width: pageWidth, height: pageHeight } = page.getSize();

        if (activeDoc.rotations[originalPageNumber] !== undefined) {
          const existingAngle = page.getRotation().angle;
          page.setRotation(
            degrees(
              (existingAngle + activeDoc.rotations[originalPageNumber]) % 360,
            ),
          );
        }

        const pageShapes = activeDoc.shapes[originalPageNumber] || [];
        for (const shape of pageShapes) {
          const s = shape as any;

          const x = (s.x / 100) * pageWidth;
          const w = ((s.width ?? 0) / 100) * pageWidth;
          const h = ((s.height ?? 0) / 100) * pageHeight;
          const y = pageHeight - (s.y / 100) * pageHeight - h;

          const shapeColorHex = s.color || "#000000";
          const resolvedColorRgb = hexToRgb(shapeColorHex);

          if (s.type === "rect") {
            page.drawRectangle({
              x,
              y,
              width: w,
              height: h,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
          } else if (s.type === "rect-fill") {
            page.drawRectangle({
              x,
              y,
              width: w,
              height: h,
              color: resolvedColorRgb,
            });
          } else if (s.type === "oval") {
            page.drawEllipse({
              x: x + w / 2,
              y: y + h / 2,
              xScale: w / 2,
              yScale: h / 2,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
          } else if (s.type === "oval-fill") {
            page.drawEllipse({
              x: x + w / 2,
              y: y + h / 2,
              xScale: w / 2,
              yScale: h / 2,
              color: resolvedColorRgb,
            });
          } else if (s.type === "round-rect") {
            const cr = Math.min(6, w / 4, h / 4);
            page.drawLine({
              start: { x: x + cr, y: y + h },
              end: { x: x + w - cr, y: y + h },
              color: resolvedColorRgb,
              thickness: 2,
            });
            page.drawLine({
              start: { x: x + cr, y },
              end: { x: x + w - cr, y },
              color: resolvedColorRgb,
              thickness: 2,
            });
            page.drawLine({
              start: { x, y: y + cr },
              end: { x, y: y + h - cr },
              color: resolvedColorRgb,
              thickness: 2,
            });
            page.drawLine({
              start: { x: x + w, y: y + cr },
              end: { x: x + w, y: y + h - cr },
              color: resolvedColorRgb,
              thickness: 2,
            });
            page.drawCircle({
              x: x + cr,
              y: y + cr,
              size: cr * 2,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
            page.drawCircle({
              x: x + w - cr,
              y: y + cr,
              size: cr * 2,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
            page.drawCircle({
              x: x + cr,
              y: y + h - cr,
              size: cr * 2,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
            page.drawCircle({
              x: x + w - cr,
              y: y + h - cr,
              size: cr * 2,
              borderColor: resolvedColorRgb,
              borderWidth: 2,
            });
          } else if (s.type === "round-rect-fill") {
            const cr = Math.min(6, w / 4, h / 4);
            page.drawRectangle({
              x: x + cr,
              y,
              width: w - 2 * cr,
              height: h,
              color: resolvedColorRgb,
            });
            page.drawRectangle({
              x,
              y: y + cr,
              width: w,
              height: h - 2 * cr,
              color: resolvedColorRgb,
            });
            page.drawCircle({
              x: x + cr,
              y: y + cr,
              size: cr * 2,
              color: resolvedColorRgb,
            });
            page.drawCircle({
              x: x + w - cr,
              y: y + cr,
              size: cr * 2,
              color: resolvedColorRgb,
            });
            page.drawCircle({
              x: x + cr,
              y: y + h - cr,
              size: cr * 2,
              color: resolvedColorRgb,
            });
            page.drawCircle({
              x: x + w - cr,
              y: y + h - cr,
              size: cr * 2,
              color: resolvedColorRgb,
            });
          } else if (s.type === "text") {
            const textBaselineY = pageHeight - (s.y / 100) * pageHeight;
            page.drawText(s.text || "", {
              x,
              y: textBaselineY - 10,
              size: 12,
              color: rgb(0.05, 0.09, 0.16),
            });
          } else if (s.type === "tick") {
            const startPt = { x: x + w * 0.167, y: y + h * 0.5 };
            const vertexPt = { x: x + w * 0.375, y: y + h * 0.292 };
            const endPt = { x: x + w * 0.833, y: y + h * 0.75 };
            page.drawLine({
              start: startPt,
              end: vertexPt,
              color: resolvedColorRgb,
              thickness: 3.5,
            });
            page.drawLine({
              start: vertexPt,
              end: endPt,
              color: resolvedColorRgb,
              thickness: 3.5,
            });
          } else if (s.type === "dash") {
            page.drawLine({
              start: { x, y: y + h / 2 },
              end: { x: x + w, y: y + h / 2 },
              color: resolvedColorRgb,
              thickness: 3.5,
            });
          } else if (
            (s.type === "signature" || s.type === "initial") &&
            s.dataUrl
          ) {
            const embeddedImageDest = await destDoc.embedPng(s.dataUrl);
            page.drawImage(embeddedImageDest, { x, y, width: w, height: h });
          } else if (
            s.type === "highlight" &&
            s.points &&
            s.points.length > 1
          ) {
            for (let k = 0; k < s.points.length - 1; k++) {
              const p1 = s.points[k];
              const p2 = s.points[k + 1];
              page.drawLine({
                start: {
                  x: (p1.x / 100) * pageWidth,
                  y: pageHeight - (p1.y / 100) * pageHeight,
                },
                end: {
                  x: (p2.x / 100) * pageWidth,
                  y: pageHeight - (p2.y / 100) * pageHeight,
                },
                color: rgb(0.98, 0.7, 0.03),
                thickness: (2.0 / 100) * pageWidth,
                opacity: 0.42,
              });
            }
          }
        }
      }

      return await destDoc.save();
    } catch (err) {
      console.error("PDF Flattening/Compilation Failure:", err);
      return null;
    }
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
        activeDoc.filePath = payload.path;
      }
    } catch (err) {
      console.error("Native file load intercept breakdown:", err);
    }
  }

  async function triggerFileSaveAs() {
    if (!activeDoc.rawBytes) return;
    try {
      console.log("Compiling and flattening PDF annotations...");
      const compiledBytes = await flattenWorkspaceToPDF();
      if (!compiledBytes) {
        alert("Failed to compile annotations into PDF object stream.");
        return;
      }
      const savedPath = await invoke<string>("native_save_as_file", {
        fileBytes: Array.from(compiledBytes),
      });
      activeDoc.filePath = savedPath;
      if (savedPath) {
        const parts = savedPath.split(/[\\/]/);
        activeDoc.fileName = parts[parts.length - 1];
      }
      console.log("Document footprint committed cleanly to disk via Save As.");
    } catch (err) {
      if (err !== "User cancelled save layout") {
        console.error("File generation layer fault:", err);
      }
    }
  }

  async function triggerFileSave() {
    if (!activeDoc.rawBytes) return;
    if (!activeDoc.filePath) {
      await triggerFileSaveAs();
      return;
    }
    try {
      console.log(
        "Compiling and flattening PDF annotations for silent save...",
      );
      const compiledBytes = await flattenWorkspaceToPDF();
      if (!compiledBytes) {
        alert("Failed to compile annotations into PDF object stream.");
        return;
      }
      await invoke("native_overwrite_file", {
        path: activeDoc.filePath,
        fileBytes: Array.from(compiledBytes),
      });
      console.log("Document footprint committed silently to disk.");
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
</script>

<div
  data-tauri-drag-region
  class="h-9 w-full bg-[#0b101c] border-b border-slate-900 flex items-center justify-between px-3 select-none relative z-50 font-sans"
>
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

    <div class="flex items-center gap-1 text-[11px] text-slate-400 font-bold">
      <button
        onclick={triggerFileOpen}
        class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors"
        >Open</button
      >
      <button
        onclick={triggerFileSave}
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
    <div class="flex items-center gap-1.5">
      <span
        class="text-[11px] font-semibold text-slate-500 tracking-wide truncate max-w-xs"
      >
        {activeDoc.fileName ? activeDoc.fileName : "No Document Active"}
      </span>
      {#if activeDoc.fileName}
        <button
          onclick={closeActiveDocument}
          class="w-5 h-5 flex items-center justify-center rounded-full text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-colors pointer-events-auto"
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
            ></line></svg
          >
        </button>
      {/if}
    </div>
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
        class="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:text-white hover:bg-red-600 transition-colors"
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
