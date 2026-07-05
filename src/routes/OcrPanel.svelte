<script lang="ts">
  import { invoke, Channel } from '@tauri-apps/api/core';
  import { onDestroy } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import { activeDoc } from '../pdfStore.svelte';

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

  async function captureCurrentPdfPageBytes() {
    if (!activeDoc.rawBytes) {
      engineStatus = 'idle';
      return;
    }

    ocrProgress = 0;
    engineStatus = 'processing';
    errorLog = '';
    outputTextResult = '';

    try {
      // Set up the listener channel
      const progressChannel = new Channel<number>();
      progressChannel.onmessage = (currentPercentage) => {
        ocrProgress = currentPercentage;
      };

      if (activeDoc.fileType === 'tiff') {
        const rawPngBytes = activeDoc.tiffPages[activeDoc.currentPage - 1];
        if (!rawPngBytes) {
          throw new Error("Target TIFF page frame is missing or empty.");
        }
        
        // Revoke previous object URL to avoid memory leaks
        if (capturedImageSrc) {
          URL.revokeObjectURL(capturedImageSrc);
        }
        const blob = new Blob([rawPngBytes], { type: 'image/png' });
        capturedImageSrc = URL.createObjectURL(blob);
        activeTab = 'document';

        const textResult = await invoke<string>('run_local_ocr', {
          imageBytes: Array.from(rawPngBytes),
          onProgress: progressChannel
        });

        outputTextResult = textResult;
        engineStatus = 'success';
        activeTab = 'text'; // Auto switch to text view on success
      } else {
        // Initialize PDF.js loading pipeline from active document bytes
        const loadingTask = pdfjsLib.getDocument({
          data: activeDoc.rawBytes.slice(0),
          cMapUrl: window.location.origin + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: window.location.origin + "/standard_fonts/",
          wasmUrl: window.location.origin + "/"
        });
        const pdfDocument = await loadingTask.promise;
        const page = await pdfDocument.getPage(activeDoc.currentPage);
        
        // Use a strict scale of 2.0 to double resolution for optimal OCR precision
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error("Could not create offscreen canvas context");

        await page.render({
          canvas: canvas,
          viewport: viewport
        }).promise;

        canvas.toBlob(async (blob) => {
          if (!blob) {
            engineStatus = 'error';
            errorLog = "Failed to generate page snapshot blob.";
            return;
          }
          
          if (capturedImageSrc) {
            URL.revokeObjectURL(capturedImageSrc);
          }
          capturedImageSrc = URL.createObjectURL(blob);
          activeTab = 'document';

          try {
            const arrayBuffer = await blob.arrayBuffer();
            const rawBytesArray = new Uint8Array(arrayBuffer);

            const textResult = await invoke<string>('run_local_ocr', {
              imageBytes: Array.from(rawBytesArray),
              onProgress: progressChannel
            });

            outputTextResult = textResult;
            engineStatus = 'success';
            activeTab = 'text'; // Auto switch to text view on success
          } catch (ocrErr: any) {
            engineStatus = 'error';
            errorLog = ocrErr.toString();
          }
        }, 'image/png');
      }
    } catch (err: any) {
      engineStatus = 'error';
      errorLog = err.toString();
    }
  }

  // Svelte 5 reactive effect watcher to trigger OCR whenever page or document changes
  $effect(() => {
    if (activeDoc.rawBytes && activeDoc.currentPage) {
      captureCurrentPdfPageBytes();
    }
  });

  onDestroy(() => {
    if (capturedImageSrc) {
      URL.revokeObjectURL(capturedImageSrc);
    }
  });
</script>

<div class="w-full flex flex-col font-sans text-slate-200">
  
  <!-- Upload Dropzone fallback (shown only when no active document is loaded in viewer) -->
  {#if !activeDoc.rawBytes}
    <div class="flex flex-col items-center justify-center border border-dashed border-zinc-800 bg-zinc-950/40 rounded-lg p-6 text-center text-zinc-500 text-[10px]">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-zinc-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span>No document active in viewer. Please open a PDF or TIFF document to extract text.</span>
    </div>
  {/if}

  <!-- Hardware-Accelerated Progress Bar Layout -->
  {#if engineStatus === 'processing'}
    <div class="mt-4 p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg space-y-2">
      <div class="flex items-center justify-between text-xs font-medium font-sans">
        <span class="text-zinc-400 animate-pulse">Analyzing Layout Matrices...</span>
        <span class="text-cyan-400 font-mono font-bold">{ocrProgress}%</span>
      </div>
      
      <div class="w-full h-1.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800/50">
        <div 
          class="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ease-out rounded-full"
          style="width: {ocrProgress}%"
        ></div>
      </div>
    </div>
  {/if}

  {#if engineStatus === 'error'}
    <div class="mt-3 bg-red-950/30 border border-red-900/30 rounded-lg p-3 text-red-400 text-[9px] leading-relaxed font-mono shadow-inner select-text">
      <span class="font-bold uppercase tracking-wider block mb-1 font-sans text-red-500 select-none">Pipeline Halted:</span>
      {errorLog}
    </div>
  {/if}

  <!-- Active Workspace split / tab content -->
  {#if activeDoc.rawBytes && capturedImageSrc}
    <!-- Tab navigation -->
    <div class="flex border-b border-zinc-800 mb-3 mt-3">
      <button 
        onclick={() => activeTab = 'document'}
        class="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border-b-2 {activeTab === 'document' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}">
        Doc View
      </button>
      <button 
        onclick={() => activeTab = 'text'}
        class="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border-b-2 {activeTab === 'text' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}">
        Text
      </button>
    </div>

    <!-- Active Tab Panel Content -->
    {#if activeTab === 'document'}
      <!-- Document View Canvas -->
      <div class="flex flex-col bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
        <div class="flex justify-between items-center p-2.5 border-b border-zinc-900 bg-zinc-900/40">
          <span class="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Preview Canvas (Page {activeDoc.currentPage})</span>
          <button 
            disabled={processingLocked}
            onclick={captureCurrentPdfPageBytes}
            class="text-[9px] uppercase font-black tracking-widest text-cyan-500 hover:text-cyan-400 disabled:opacity-40 transition-colors select-none">
            Refresh
          </button>
        </div>
        <div class="flex items-center justify-center p-3 bg-zinc-950/40 min-h-[220px] max-h-[350px] overflow-auto">
          <img src={capturedImageSrc} alt="Captured Document Page" class="max-w-full max-h-full object-contain rounded shadow-lg border border-zinc-900" />
        </div>
      </div>
    {:else}
      <!-- Extracted Text sidebar pane -->
      <div class="flex flex-col bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
        <div class="flex justify-between items-center p-2.5 border-b border-zinc-900 bg-zinc-900/40">
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
              class="relative flex items-center gap-1 text-[9px] uppercase font-black tracking-widest text-zinc-400 hover:text-cyan-400 transition-all select-none">
              {#if copied}
                <span class="text-emerald-400 animate-pulse flex items-center gap-0.5">
                  ✓ Copied!
                </span>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-zinc-500 hover:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
              {/if}
            </button>
          {/if}
        </div>
        
        <div class="p-3">
          {#if engineStatus === 'processing'}
            <div class="w-full h-48 flex flex-col items-center justify-center text-zinc-500 text-[10px] font-medium italic">
              <span class="animate-pulse">Transcribing...</span>
            </div>
          {:else if outputTextResult}
            <textarea 
              readonly 
              bind:value={outputTextResult}
              class="w-full h-[280px] bg-transparent border-0 resize-none text-[10px] text-slate-300 focus:outline-none font-mono leading-relaxed shadow-inner"
            ></textarea>
          {:else}
            <div class="w-full h-48 flex items-center justify-center text-zinc-600 text-[10px] italic">
              No text extracted yet.
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
