<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc, globalPdfWorkerInstance } from "../pdfStore.svelte";
  import {
    debounceLeadingLatest,
    runWithPdfRenderSlot,
    THUMBNAIL_DEBOUNCE_MS,
    THUMBNAIL_MAX_EDGE_PX,
    THUMBNAIL_MAX_SCALE,
  } from "../lib/render/pdfRenderQueue";

  let { bytes, pageNumber } = $props<{ bytes: Uint8Array; pageNumber: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);

  type RenderTaskLike = { cancel: () => void; promise: Promise<unknown> };
  let activeRenderTask: RenderTaskLike | null = null;
  let paintGeneration = 0;

  async function cancelActiveRender(): Promise<void> {
    const task = activeRenderTask;
    if (!task) return;
    activeRenderTask = null;
    try {
      task.cancel();
    } catch {
      /* ignore */
    }
    try {
      await task.promise;
    } catch {
      /* cancelled */
    }
  }

  const debouncedPaint = debounceLeadingLatest(() => {
    const canvas = canvasElement;
    if (!bytes || !canvas) return;
    const rotationAngle = activeDoc.rotations[pageNumber] ?? 0;
    void renderMiniThumbnail(bytes, pageNumber, canvas, rotationAngle);
  }, THUMBNAIL_DEBOUNCE_MS);

  // Automatically redraw the miniature page if document data or individual page rotations change
  $effect(() => {
    // 1. Establish a reactive dependency boundary link to our global save counter token
    const currentRenderVersion = activeDoc.thumbnailVersion;
    
    // 2. Hook up a live reactive dependency line targeting our page overrides state map
    const liveOverrideTexture = activeDoc.pageThumbnailOverrides[pageNumber - 1];
    
    const canvas = canvasElement;
    const rotationAngle = activeDoc.rotations[pageNumber] ?? 0;
    void rotationAngle;
    void currentRenderVersion;
    
    if (canvas) {
      const renderingContext2d = canvas.getContext('2d');
      if (renderingContext2d) {
        // 3. Wipe any outdated background layers safely
        renderingContext2d.clearRect(0, 0, canvas.width, canvas.height);
        
        if (liveOverrideTexture) {
          debouncedPaint.cancel();
          // Cancel any in-flight pdf.js paint before drawing override image
          void cancelActiveRender();
          paintGeneration += 1;
          // 4. Draw our fresh annotation snapshot image instantly
          const liveImage = new Image();
          liveImage.src = liveOverrideTexture;
          liveImage.onload = () => {
            canvas.width = liveImage.width;
            canvas.height = liveImage.height;
            renderingContext2d.drawImage(liveImage, 0, 0, canvas.width, canvas.height);
          };
          console.log(`⚡ Sidebar thumbnail for page ${pageNumber} updated dynamically via override map.`);
          return () => {
            void cancelActiveRender();
            paintGeneration += 1;
          };
        }
      }
    }
    
    // Debounced pdf.js fallback — keeps Wasm load low under rapid version bumps
    if (bytes && canvas) {
      debouncedPaint.schedule();
      console.log(`⚡ Repainting navigation thumbnail for page index due to sync version: ${currentRenderVersion}`);
    }

    return () => {
      debouncedPaint.cancel();
      void cancelActiveRender();
      paintGeneration += 1;
    };
  });

  async function renderMiniThumbnail(pdfBytes: Uint8Array, pageNum: number, canvas: HTMLCanvasElement, rotationAngle: number) {
    const generation = ++paintGeneration;
    // Free this thumbnail canvas before starting a new pdf.js render on it
    await cancelActiveRender();
    if (generation !== paintGeneration) return;

    await runWithPdfRenderSlot(
      "low",
      async () => {
        if (generation !== paintGeneration) return;

        try {
          if (!globalPdfWorkerInstance.current) {
            globalPdfWorkerInstance.current = new pdfjsLib.PDFWorker();
          }

          const loadingTask = pdfjsLib.getDocument({
            data: pdfBytes.slice(0),
            cMapUrl: window.location.origin + "/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: window.location.origin + "/standard_fonts/",
            wasmUrl: window.location.origin + "/",
            worker: globalPdfWorkerInstance.current,
          });
          const pdfDocument = await loadingTask.promise;
          if (generation !== paintGeneration) {
            try {
              await loadingTask.destroy();
            } catch {
              /* ignore */
            }
            return;
          }

          const page = await pdfDocument.getPage(pageNum);
          if (generation !== paintGeneration) return;

          const unscaledViewport = page.getViewport({ scale: 1 });
          const targetWidth = THUMBNAIL_MAX_EDGE_PX;
          const miniScale = Math.min(
            THUMBNAIL_MAX_SCALE,
            Math.max(0.1, targetWidth / Math.max(0.1, Math.abs(unscaledViewport.width))),
          );
          
          // Calculate responsive thumbnail boundary rotation boxes
          const viewport = page.getViewport({ 
            scale: miniScale, 
            rotation: (page.rotate + rotationAngle) % 360 
          });
          
          const context = canvas.getContext("2d");

          if (context) {
            if (generation !== paintGeneration) return;

            await cancelActiveRender();
            if (generation !== paintGeneration) return;

            // Cap bitmap size for ICC/Wasm memory
            canvas.height = Math.min(viewport.height, THUMBNAIL_MAX_EDGE_PX * 2);
            canvas.width = Math.min(viewport.width, THUMBNAIL_MAX_EDGE_PX * 2);

            // Dedicated thumbnail canvas element (never the main WorkspacePage canvas)
            const renderTask = page.render({
              canvas: canvas,
              viewport: viewport,
            });
            activeRenderTask = renderTask;
            try {
              await renderTask.promise;
            } catch (error: any) {
              if (error?.name === "RenderingCancelledException") return;
              throw error;
            } finally {
              if (activeRenderTask === renderTask) {
                activeRenderTask = null;
              }
            }

          }
        } catch (error: any) {
          if (error?.name === "RenderingCancelledException") return;
          console.error(`Thumbnail generation failed for page ${pageNum}:`, error);
        }
      },
      () => generation !== paintGeneration,
    );
  }
</script>

<canvas bind:this={canvasElement} class="w-full h-auto block rounded-sm pointer-events-none select-none"></canvas>
