<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc } from "../pdfStore.svelte"; // Clean unified import line

  let { bytes, pageNumber } = $props<{ bytes: Uint8Array; pageNumber: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);

  // Automatically redraw the miniature page if document data or individual page rotations change
  $effect(() => {
    // 1. Establish a reactive dependency boundary link to our global save counter token
    const currentRenderVersion = activeDoc.thumbnailVersion;
    
    // 2. Hook up a live reactive dependency line targeting our page overrides state map
    const liveOverrideTexture = activeDoc.pageThumbnailOverrides[pageNumber - 1];
    
    const canvas = canvasElement;
    const rotationAngle = activeDoc.rotations[pageNumber] ?? 0; 
    
    if (canvas) {
      const renderingContext2d = canvas.getContext('2d');
      if (renderingContext2d) {
        // 3. Wipe any outdated background layers safely
        renderingContext2d.clearRect(0, 0, canvas.width, canvas.height);
        
        if (liveOverrideTexture) {
          // 4. Draw our fresh annotation snapshot image instantly
          const liveImage = new Image();
          liveImage.src = liveOverrideTexture;
          liveImage.onload = () => {
            canvas.width = liveImage.width;
            canvas.height = liveImage.height;
            renderingContext2d.drawImage(liveImage, 0, 0, canvas.width, canvas.height);
          };
          console.log(`⚡ Sidebar thumbnail for page ${pageNumber} updated dynamically via override map.`);
          return; // Skip normal un-annotated background pdf.js processing blocks cleanly
        }
      }
    }
    
    // Existing async fallback pdfPage.render() pipeline continues normally
    if (bytes && canvas) {
      renderMiniThumbnail(bytes, pageNumber, canvas, rotationAngle);
      console.log(`⚡ Repainting navigation thumbnail for page index due to sync version: ${currentRenderVersion}`);
    }
  });

  async function renderMiniThumbnail(pdfBytes: Uint8Array, pageNum: number, canvas: HTMLCanvasElement, rotationAngle: number) {
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: pdfBytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/"
      });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(pageNum);

      const unscaledViewport = page.getViewport({ scale: 1 });
      const targetWidth = 140; 
      const miniScale = Math.max(0.1, targetWidth / Math.max(0.1, Math.abs(unscaledViewport.width)));
      
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