<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";

  let { bytes, pageNumber } = $props<{ bytes: Uint8Array; pageNumber: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);

  // Automatically trigger rendering as soon as the canvas mounts into the DOM
  $effect(() => {
    if (bytes && canvasElement) {
      renderMiniThumbnail(bytes, pageNumber, canvasElement);
    }
  });

  async function renderMiniThumbnail(pdfBytes: Uint8Array, pageNum: number, canvas: HTMLCanvasElement) {
    try {
      // Use a quick sliced memory copy so the worker thread doesn't detach our store data
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(pageNum);

      // Force a fixed miniature width (e.g., 140px) and let the height scale proportionally
      const unscaledViewport = page.getViewport({ scale: 1 });
      const targetWidth = 140; 
      const miniScale = targetWidth / unscaledViewport.width;
      
      const viewport = page.getViewport({ scale: miniScale });
      const context = canvas.getContext("2d");

      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvas: canvas,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
      }
    } catch (error) {
      console.error(`Thumbnail generation failed for page ${pageNum}:`, error);
    }
  }
</script>

<canvas bind:this={canvasElement} class="w-full h-auto block rounded-sm pointer-events-none select-none"></canvas>