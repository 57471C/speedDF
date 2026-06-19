<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte"; 
  import { PDFDocument, rgb, degrees } from "pdf-lib";

  let { darkMode = $bindable(), onMinimize, onMaximize, onClose } = $props();

  // ⚡ Matches our Rust backend structure
  interface FilePayload {
    bytes: number[];
    name: string;
  }

  async function triggerFileOpen() {
    try {
      console.log("Invoking native Windows file dialog payload bridge...");
      // Pull the unified payload structure object
      const payload = await invoke<FilePayload>("native_open_file");
      
      if (!payload || !payload.bytes || payload.bytes.length === 0) return;
      
      const typedBytes = new Uint8Array(payload.bytes);
      const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;

      activeDoc.rawBytes = typedBytes;
      activeDoc.pageCount = pdfDocument.numPages;
      activeDoc.pageOrder = Array.from({ length: pdfDocument.numPages }, (_, idx) => idx + 1);
      activeDoc.currentPage = 1;
      (activeDoc as any).scrollTop = 0; 
      activeDoc.shapes = {}; 

      // Lock the true physical filename straight into the state title space
      activeDoc.fileName = payload.name;
    } catch (err) {
      console.warn("Open File Action failed:", err);
    }
  }

  async function compileAnnotatedPdf(): Promise<Uint8Array | null> {
    if (!activeDoc.rawBytes || activeDoc.pageOrder.length === 0) return null;

    try {
      const srcDoc = await PDFDocument.load(activeDoc.rawBytes);
      const destDoc = await PDFDocument.create();
      const copiedPages = await destDoc.copyPages(srcDoc, activeDoc.pageOrder.map(num => num - 1));

      for (let i = 0; i < activeDoc.pageOrder.length; i++) {
        const originalPageNumber = activeDoc.pageOrder[i];
        const page = copiedPages[i];
        destDoc.addPage(page);

        const { width: pageWidth, height: pageHeight } = page.getSize();

        if (activeDoc.rotations[originalPageNumber] !== undefined) {
          const existingAngle = page.getRotation().angle;
          page.setRotation(degrees((existingAngle + activeDoc.rotations[originalPageNumber]) % 360));
        }

        const pageShapes = activeDoc.shapes[originalPageNumber] || [];
        for (const shape of pageShapes) {
          const x = (shape.x / 100) * pageWidth;
          const w = (shape.width ?? 0) / 100 * pageWidth;
          const h = (shape.height ?? 0) / 100 * pageHeight;
          const y = pageHeight - ((shape.y / 100) * pageHeight) - h;

          if (shape.type === "rect") {
            page.drawRectangle({
              x, y, width: w, height: h,
              borderColor: rgb(0, 0.82, 1), 
              borderWidth: 2,
              color: rgb(0, 0.82, 1),
              opacity: 0.08 
            });
          } 
          else if (shape.type === "text") {
            const textBaselineY = pageHeight - ((shape.y / 100) * pageHeight);
            page.drawText(shape.text || "", {
              x,
              y: textBaselineY - 10,
              size: 12,
              color: rgb(0.05, 0.09, 0.16)
            });
          } 
          else if (shape.type === "tick") {
            const startPt = { x: x + w * 0.167, y: y + h * 0.5 }; 
            const vertexPt = { x: x + w * 0.375, y: y + h * 0.292 }; 
            const endPt = { x: x + w * 0.833, y: y + h * 0.75 }; 
            page.drawLine({ start: startPt, end: vertexPt, color: rgb(0,0,0), thickness: 3.5 });
            page.drawLine({ start: vertexPt, end: endPt, color: rgb(0,0,0), thickness: 3.5 });
          } 
          else if (shape.type === "dash") {
            page.drawLine({ start: { x, y: y + h / 2 }, end: { x: x + w, y: y + h / 2 }, color: rgb(0,0,0), thickness: 3.5 });
          } 
          else if ((shape.type === "signature" || shape.type === "initial") && shape.dataUrl) {
            const embeddedImageDest = await destDoc.embedPng(shape.dataUrl);
            page.drawImage(embeddedImageDest, { x, y, width: w, height: h });
          }
        }
      }

      return await destDoc.save();
    } catch (err) {
      console.error("PDF Compilation Matrix Failure:", err);
      return null;
    }
  }

  async function triggerFileSaveAs() {
    try {
      if (!activeDoc.rawBytes) return;
      console.log("Compiling, slicing deletions, and flattening layout annotations...");
      const compiledBytes = await compileAnnotatedPdf();
      if (!compiledBytes) { alert("Failed to compile annotations into PDF object stream."); return; }
      console.log("Invoking native Rust file system export dialog...");
      await invoke("native_save_as_file", { fileBytes: Array.from(compiledBytes) });
    } catch (err) {
      console.warn("Save As Action failed:", err);
    }
  }
</script>

<div class="h-11 w-full bg-[#090d16] border-b border-slate-900/60 flex items-center justify-between px-4 select-none cursor-default relative z-50">
  
  <div data-tauri-drag-region class="absolute inset-0 z-0"></div>

  {#if activeDoc.rawBytes && activeDoc.fileName}
    <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none text-[11px] font-bold text-slate-400 font-sans tracking-wide truncate max-w-[35%] text-center z-20">
      {activeDoc.fileName}
    </div>
  {/if}

  <div class="relative z-10 w-full h-full flex items-center justify-between pointer-events-none">
    <div class="flex items-center gap-5 h-full pointer-events-auto">
      <div class="flex items-center gap-2">
        <svg width="20" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" class="block">
          <defs>
            <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0f172a"></stop><stop offset="100%" stop-color="#1a2744"></stop></linearGradient>
            <linearGradient id="bolt-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#38bdf8"></stop><stop offset="100%" stop-color="#06b6d4"></stop></linearGradient>
            <filter id="bolt-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="8" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>
            <filter id="glow-soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="18" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode></feMerge></filter>
          </defs>
          <rect x="0" y="0" width="512" height="512" rx="108" ry="108" fill="url(#bg-grad)"></rect>
          <g opacity="0.28">
            <line x1="52" y1="218" x2="128" y2="218" stroke="#06b6d4" stroke-width="6" stroke-linecap="round"></line>
            <line x1="38" y1="244" x2="118" y2="244" stroke="#06b6d4" stroke-width="5" stroke-linecap="round"></line>
            <line x1="52" y1="270" x2="108" y2="270" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"></line>
          </g>
          <g transform="translate(256, 264) rotate(-4) translate(-256, -264)">
            <polygon points="168,118 338,118 338,128 348,138 348,420 168,420" fill="#0a1628" opacity="0.5" transform="translate(8, 8)"></polygon>
            <polygon points="162,112 322,112 362,152 362,414 162,414" fill="#1e293b"></polygon>
            <polygon points="322,112 362,112 362,152" fill="#0f172a"></polygon>
            <polygon points="322,112 362,152 322,152" fill="#334155"></polygon>
            <line x1="190" y1="195" x2="330" y2="195" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
            <line x1="190" y1="218" x2="300" y2="218" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
            <line x1="190" y1="241" x2="315" y2="241" stroke="#334155" stroke-width="7" stroke-linecap="round"></line>
            <line x1="190" y1="315" x2="330" y2="315" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
            <line x1="190" y1="336" x2="280" y2="336" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
            <line x1="190" y1="357" x2="305" y2="357" stroke="#334155" stroke-width="6" stroke-linecap="round"></line>
          </g>
          <ellipse cx="278" cy="264" rx="68" ry="110" fill="#06b6d4" opacity="0.12" filter="url(#glow-soft)"></ellipse>
          <g filter="url(#bolt-glow)"><polygon points="306,138 248,276 284,276 206,396 174,396 236,262 200,262 256,138" fill="url(#bolt-grad)"></polygon></g>
          <polygon points="296,155 254,264 278,264 220,368 246,368 290,264 266,264 302,168" fill="#bae6fd" opacity="0.35"></polygon>
        </svg>
        <h1 class="text-sm font-bold tracking-tight text-slate-100" style="font-family: 'Space Grotesk', sans-serif;">
          speed<span class="text-cyan-400">DF</span>
        </h1>
      </div>
      <div class="h-4 w-[1px] bg-slate-800"></div>
      <div class="flex items-center gap-1 text-[11px] text-slate-400 font-bold">
        <button onclick={triggerFileOpen} class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors">Open</button>
        <button onclick={() => console.log('Quick Save')} class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors">Save</button>
        <button onclick={triggerFileSaveAs} class="px-2.5 py-1 rounded-md hover:bg-slate-800/60 hover:text-white transition-colors">Save As..</button>
      </div>
    </div>

    <div class="flex items-center gap-1 h-full pointer-events-auto">
      <button onclick={() => darkMode = !darkMode} aria-label="Toggle Theme" class="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors mr-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          {#if darkMode}
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          {:else}
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          {/if}
        </svg>
      </button>
      <button onclick={onMinimize} aria-label="Minimize" class="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button onclick={onMaximize} aria-label="Maximize" class="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/>
        </svg>
      </button>
      <button onclick={onClose} aria-label="Close" class="titlebar-close-btn w-10 h-8 flex items-center justify-center text-slate-400 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
</div>

<style>
  .titlebar-close-btn:hover {
    background-color: #e11d48 !important; 
    color: #ffffff !important;
  }
</style>