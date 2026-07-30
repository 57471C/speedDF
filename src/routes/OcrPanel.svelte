<script lang="ts">
  import { invoke, Channel } from '@tauri-apps/api/core';
  import { onDestroy } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import { activeDoc } from '../pdfStore.svelte';

  let { onClose } = $props<{ onClose?: () => void }>();

  // Svelte 5 Fine-Grained Reactive State Management
  let engineStatus = $state<'idle' | 'processing' | 'error' | 'success'>('idle');
  let ocrProgress = $state<number>(0);
  let errorLog = $state<string>('');
  let outputTextResult = $state<string>('');
  let capturedImageSrc = $state<string>('');
  let activeTab = $state<'document' | 'text'>('document');
  let copied = $state<boolean>(false);

  // Clean, compiled reactive indicators derived dynamically from state conditions
  let processingLocked = $derived(engineStatus === 'processing');

  async function runOcrOnImageBytes(imageBytes: Uint8Array, previewUrl?: string) {
    const progressChannel = new Channel<number>();
    progressChannel.onmessage = (currentPercentage) => {
      ocrProgress = currentPercentage;
    };

    if (capturedImageSrc) {
      URL.revokeObjectURL(capturedImageSrc);
    }
    if (previewUrl) {
      capturedImageSrc = previewUrl;
    } else {
      const blob = new Blob([imageBytes as BlobPart], { type: "image/png" });
      capturedImageSrc = URL.createObjectURL(blob);
    }
    activeTab = "document";

    const textResult = await invoke<string>("run_local_ocr", {
      imageBytes: Array.from(imageBytes),
      onProgress: progressChannel,
    });

    outputTextResult = textResult;
    engineStatus = "success";
    activeTab = "text";
  }

  async function captureCurrentPdfPageBytes() {
    // Images store rawBytes + imageUrl; PDFs/TIFFs store rawBytes
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) {
      engineStatus = "idle";
      return;
    }

    ocrProgress = 0;
    engineStatus = "processing";
    errorLog = "";
    outputTextResult = "";

    try {
      // --- IMAGE documents (PNG/JPG/etc.): send raw file bytes straight to OCR ---
      if (activeDoc.fileType === "image") {
        let imageBytes: Uint8Array | null = activeDoc.rawBytes
          ? new Uint8Array(activeDoc.rawBytes)
          : null;

        // Fallback: decode imageUrl if rawBytes missing
        if (!imageBytes && activeDoc.imageUrl) {
          const resp = await fetch(activeDoc.imageUrl);
          const buf = await resp.arrayBuffer();
          imageBytes = new Uint8Array(buf);
        }
        if (!imageBytes || imageBytes.length === 0) {
          throw new Error("Image document has no pixel data for OCR.");
        }

        // Prefer existing object URL for preview (don't revoke the workspace one)
        const preview =
          activeDoc.imageUrl ||
          URL.createObjectURL(new Blob([imageBytes as BlobPart], { type: "image/png" }));
        // Don't revoke workspace imageUrl in onDestroy if we reused it — track ownership
        const ownsPreview = preview !== activeDoc.imageUrl;
        if (capturedImageSrc && capturedImageSrc !== activeDoc.imageUrl) {
          URL.revokeObjectURL(capturedImageSrc);
        }
        capturedImageSrc = preview;

        const progressChannel = new Channel<number>();
        progressChannel.onmessage = (currentPercentage) => {
          ocrProgress = currentPercentage;
        };
        activeTab = "document";

        const textResult = await invoke<string>("run_local_ocr", {
          imageBytes: Array.from(imageBytes),
          onProgress: progressChannel,
        });

        outputTextResult = textResult;
        engineStatus = "success";
        activeTab = "text";
        void ownsPreview;
        return;
      }

      // --- TIFF multipage: OCR active page PNG frame ---
      if (activeDoc.fileType === "tiff") {
        const rawPngBytes = activeDoc.tiffPages[activeDoc.currentPage - 1];
        if (!rawPngBytes) {
          throw new Error("Target TIFF page frame is missing or empty.");
        }
        await runOcrOnImageBytes(rawPngBytes);
        return;
      }

      // --- PDF: rasterize current page then OCR ---
      if (!activeDoc.rawBytes) {
        throw new Error("No PDF bytes available for OCR.");
      }

      const progressChannel = new Channel<number>();
      progressChannel.onmessage = (currentPercentage) => {
        ocrProgress = currentPercentage;
      };

      const loadingTask = pdfjsLib.getDocument({
        data: activeDoc.rawBytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/",
      });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(activeDoc.currentPage);

      // Use a strict scale of 2.0 to double resolution for optimal OCR precision
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create offscreen canvas context");

      await page.render({
        canvas: canvas,
        viewport: viewport,
      }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) {
        engineStatus = "error";
        errorLog = "Failed to generate page snapshot blob.";
        return;
      }

      if (capturedImageSrc && capturedImageSrc !== activeDoc.imageUrl) {
        URL.revokeObjectURL(capturedImageSrc);
      }
      capturedImageSrc = URL.createObjectURL(blob);
      activeTab = "document";

      const arrayBuffer = await blob.arrayBuffer();
      const rawBytesArray = new Uint8Array(arrayBuffer);

      const textResult = await invoke<string>("run_local_ocr", {
        imageBytes: Array.from(rawBytesArray),
        onProgress: progressChannel,
      });

      outputTextResult = textResult;
      engineStatus = "success";
      activeTab = "text";
    } catch (err: any) {
      engineStatus = "error";
      errorLog = err.toString();
    }
  }

  // Svelte 5 reactive effect watcher to trigger OCR whenever page or document changes
  $effect(() => {
    if ((activeDoc.rawBytes || activeDoc.imageUrl) && activeDoc.currentPage) {
      captureCurrentPdfPageBytes();
    }
  });

  onDestroy(() => {
    // Never revoke the workspace's live imageUrl — only panel-owned blobs
    if (capturedImageSrc && capturedImageSrc !== activeDoc.imageUrl) {
      URL.revokeObjectURL(capturedImageSrc);
    }
  });
</script>

<div class="w-[400px] shrink-0 h-full flex flex-col relative font-sans shadow-2xl p-4 overflow-hidden" style="background: var(--sdf-bg-chrome); border-left: 1px solid var(--sdf-border); color: var(--sdf-text-primary);">
  {#if onClose}
    <div class="flex items-center justify-between mb-3 pb-2 shrink-0" style="border-bottom: 1px solid var(--sdf-border-subtle);">
      <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sdf-text-secondary);">OCR Scan Drawer</span>
      <button onclick={onClose} class="text-xs" style="color: var(--sdf-text-muted);">✕</button>
    </div>
  {/if}
  
  {#if !activeDoc.rawBytes && !activeDoc.imageUrl}
    <div class="flex flex-col items-center justify-center rounded-lg p-6 text-center text-[10px]" style="border: 1px dashed var(--sdf-border); background: var(--sdf-bg-surface); color: var(--sdf-text-muted);">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-2" style="color: var(--sdf-text-faint);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span>No document active in viewer. Please open a PDF, image, or TIFF document to extract text.</span>
    </div>
  {/if}

  {#if engineStatus === 'processing'}
    <div class="mb-2 p-4 rounded-lg space-y-2 shrink-0" style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border);">
      <div class="flex items-center justify-between text-xs font-medium font-sans">
        <span class="animate-pulse" style="color: var(--sdf-text-secondary);">Analyzing Layout Matrices...</span>
        <span class="text-cyan-400 font-mono font-bold">{ocrProgress}%</span>
      </div>
      
      <div class="w-full h-1.5 rounded-full overflow-hidden" style="background: var(--sdf-bg-app); border: 1px solid var(--sdf-border-subtle);">
        <div 
          class="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ease-out rounded-full"
          style="width: {ocrProgress}%"
        ></div>
      </div>
    </div>
  {/if}

  {#if engineStatus === 'error'}
    <div class="mb-2 bg-red-950/30 border border-red-900/30 rounded-lg p-3 text-red-400 text-[9px] leading-relaxed font-mono shadow-inner select-text shrink-0">
      <span class="font-bold uppercase tracking-wider block mb-1 font-sans text-red-500 select-none">Pipeline Halted:</span>
      {errorLog}
    </div>
  {/if}

  {#if (activeDoc.rawBytes || activeDoc.imageUrl) && capturedImageSrc}
    <div class="flex mb-2 shrink-0" style="border-bottom: 1px solid var(--sdf-border);">
      <button 
        onclick={() => activeTab = 'document'}
        class="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border-b-2 {activeTab === 'document' ? 'border-cyan-400 text-cyan-400' : 'border-transparent'}"
        style={activeTab === 'document' ? '' : 'color: var(--sdf-text-secondary);'}
      >
        Doc View
      </button>
      <button 
        onclick={() => activeTab = 'text'}
        class="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border-b-2 {activeTab === 'text' ? 'border-cyan-400 text-cyan-400' : 'border-transparent'}"
        style={activeTab === 'text' ? '' : 'color: var(--sdf-text-secondary);'}
      >
        Text
      </button>
    </div>

    {#if activeTab === 'document'}
      <div class="flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden" style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border);">
        <div class="flex justify-between items-center p-2.5 shrink-0" style="border-bottom: 1px solid var(--sdf-border-subtle); background: var(--sdf-bg-elevated);">
          <span class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sdf-text-secondary);">Preview Canvas (Page {activeDoc.currentPage})</span>
          <button 
            disabled={processingLocked}
            onclick={captureCurrentPdfPageBytes}
            class="text-[9px] uppercase font-black tracking-widest text-cyan-500 hover:text-cyan-400 disabled:opacity-40 transition-colors select-none">
            Refresh
          </button>
        </div>
        <div class="flex flex-1 min-h-0 items-center justify-center p-3 overflow-auto" style="background: var(--sdf-bg-surface);">
          <img src={capturedImageSrc} alt="Captured Document Page" class="max-w-full max-h-full object-contain rounded shadow-lg" style="border: 1px solid var(--sdf-border-subtle);" />
        </div>
      </div>
    {:else}
      <div class="flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden" style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border);">
        <div class="flex justify-between items-center p-2.5 shrink-0" style="border-bottom: 1px solid var(--sdf-border-subtle); background: var(--sdf-bg-elevated);">
          <span class="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Extracted Output</span>
          
          {#if outputTextResult}
            <button 
              onclick={async () => {
                try {
                  await navigator.clipboard.writeText(outputTextResult);
                  copied = true;
                  setTimeout(() => copied = false, 1500);
                } catch (err) {
                  console.error("Failed to copy text: ", err);
                }
              }}
              class="relative flex items-center gap-1 text-[9px] uppercase font-black tracking-widest hover:text-cyan-400 transition-all select-none"
              style="color: var(--sdf-text-secondary);">
              {#if copied}
                <span class="text-emerald-400 animate-pulse flex items-center gap-0.5">
                  ✓ Copied!
                </span>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 hover:text-cyan-400" style="color: var(--sdf-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
              {/if}
            </button>
          {/if}
        </div>
        
        <div class="p-3 flex-1 min-h-0 flex flex-col">
          {#if engineStatus === 'processing'}
            <div class="flex-1 flex flex-col items-center justify-center text-[10px] font-medium italic" style="color: var(--sdf-text-muted);">
              <span class="animate-pulse">Transcribing...</span>
            </div>
          {:else if outputTextResult}
            <textarea 
              readonly 
              bind:value={outputTextResult}
              class="flex-1 w-full bg-transparent border-0 resize-none text-[10px] focus:outline-none font-mono leading-relaxed shadow-inner"
              style="color: var(--sdf-text-secondary);"
            ></textarea>
          {:else}
            <div class="flex-1 flex items-center justify-center text-[10px] italic" style="color: var(--sdf-text-faint);">
              No text extracted yet.
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>