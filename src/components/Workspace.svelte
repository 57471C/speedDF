<script lang="ts">
import * as pdfjsLib from "pdfjs-dist";
import { activeDoc } from "../pdfStore.svelte";

let zoomScale = $state(100);
let canvasElement = $state<HTMLCanvasElement | null>(null);
let rendering = $state(false);

// Automatically watch for changes to rawBytes or the active page index runically
$effect(() => {
	if (activeDoc.rawBytes && canvasElement) {
		renderPdfPage(activeDoc.currentPage);
	}
});

async function renderPdfPage(pageNumber: number) {
	if (!activeDoc.rawBytes || !canvasElement || rendering) return;
	rendering = true;

	try {
		const loadingTask = pdfjsLib.getDocument({ data: activeDoc.rawBytes });
		const pdfDocument = await loadingTask.promise;
		const page = await pdfDocument.getPage(pageNumber);

		// Map scale factor accounting for design retina dpi scaling metrics
		const viewport = page.getViewport({ scale: zoomScale / 100 });
		const context = canvasElement.getContext("2d");

		if (context) {
			canvasElement.height = viewport.height;
			canvasElement.width = viewport.width;

			// Modern PDF.js API parameter configuration object standard ⚡
			const renderContext = {
				canvas: canvasElement,
				canvasContext: context,
				viewport: viewport,
			};

			await page.render(renderContext).promise;
			console.log(`Render complete for document page index: ${pageNumber}`);
		}
	} catch (error) {
		console.error("PDF.js canvas rendering failed:", error);
	} finally {
		rendering = false;
	}
}
</script>

<div class="flex-1 bg-[#0f172a] relative overflow-hidden flex flex-col items-center justify-center p-8">
  
  <div class="overflow-auto max-w-full max-h-full flex items-center justify-center p-4">
    {#if activeDoc.rawBytes}
      <div 
        class="bg-white shadow-2xl relative rounded-sm transition-transform duration-200 min-w-[595px] min-h-[842px]"
        style="box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);"
      >
        <canvas bind:this={canvasElement} class="block max-w-full h-auto"></canvas>
      </div>
    {:else}
      <div class="w-[595px] h-[842px] bg-white relative flex flex-col items-center justify-center text-slate-300 font-medium tracking-wide text-xs opacity-40 pointer-events-none select-none rounded-sm" style="box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);">
        <svg class="w-10 h-10 mb-3 opacity-60" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
        </svg>
        Select "Open" to Load a PDF File
      </div>
    {/if}
  </div>

  <div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-zinc-950/80 backdrop-blur-md border border-slate-800/80 rounded-full px-4 py-2 gap-4 shadow-xl text-xs font-medium text-slate-400 z-50">
    <button 
      onclick={() => { if (zoomScale > 50) zoomScale -= 10; }} 
      aria-label="Zoom Out" 
      class="hover:text-[#00d2ff] transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>

    <span class="font-mono min-w-[35px] text-center select-none">{zoomScale}%</span>

    <button 
      onclick={() => { if (zoomScale < 200) zoomScale += 10; }} 
      aria-label="Zoom In" 
      class="hover:text-[#00d2ff] transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>
</div>