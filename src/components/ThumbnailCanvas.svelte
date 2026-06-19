<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte"; // Clean unified import line

  let { bytes, pageNumber } = $props<{ bytes: Uint8Array; pageNumber: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);

  // Automatically redraw the miniature page if document data or individual page rotations change
  $effect(() => {
    const canvas = canvasElement;
    const rotationAngle = activeDoc.rotations[pageNumber] ?? 0; 
    
    if (bytes && canvas) {
      renderMiniThumbnail(bytes, pageNumber, canvas, rotationAngle);
    }
  });

  async function renderMiniThumbnail(pdfBytes: Uint8Array, pageNum: number, canvas: HTMLCanvasElement, rotationAngle: number) {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(pageNum);

      const unscaledViewport = page.getViewport({ scale: 1 });
      const targetWidth = 140; 
      const miniScale = targetWidth / unscaledViewport.width;
      
      // Calculate responsive thumbnail boundary rotation boxes
      const viewport = page.getViewport({ 
        scale: miniScale, 
        rotation: (page.rotate + rotationAngle) % 360 
      });
      
      const context = canvas.getContext("2d");

      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Pass the actual canvas HTML element directly to satisfy RenderParameters standard signatures
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