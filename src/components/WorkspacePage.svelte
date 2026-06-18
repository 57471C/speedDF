<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { onMount } from "svelte";
  import { activeDoc } from "../pdfStore.svelte"; 

  let { bytes, pageNumber, zoomScale } = $props<{ bytes: Uint8Array; pageNumber: number; zoomScale: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let pageContainer = $state<HTMLDivElement | null>(null);
  let rendering = false;

  $effect(() => {
    if (bytes && canvasElement && zoomScale) {
      renderPageSheet(bytes, pageNumber, zoomScale, canvasElement);
    }
  });

  async function renderPageSheet(pdfBytes: Uint8Array, pageNum: number, scale: number, canvas: HTMLCanvasElement) {
    if (rendering) return;
    rendering = true;

    try {
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(pageNum);

      const viewport = page.getViewport({ scale: scale / 100 });
      const context = canvas.getContext("2d");

      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvas: canvas, viewport: viewport }).promise;
      }
    } catch (error) {
      console.error(`Render fail on workspace page ${pageNum}:`, error);
    } finally {
      rendering = false;
    }
  }

  // 🔄 WATCH SCROLL: Updates the active side highlights natively as the document scrolls
 onMount(() => {
    if (!pageContainer) return;

    // ⚡ FIX: Step up twice to lock onto the true scroll container layout element
    const trueScrollViewport = pageContainer.parentElement?.parentElement;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !(activeDoc as any).isClickScrolling) {
            const containerTop = (activeDoc as any).scrollTop ?? 0;
            
            if (containerTop === 0) {
              activeDoc.currentPage = 1;
            } else if (activeDoc.currentPage !== pageNumber) {
              activeDoc.currentPage = pageNumber;
            }
          }
        }
      },
      {
        root: trueScrollViewport || null, // Connects directly to the scrolling view bounds
        threshold: 0.4, 
      }
    );

    observer.observe(pageContainer);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (activeDoc.currentPage === pageNumber && pageContainer) {
      if ((activeDoc as any).isClickScrolling) {
        pageContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => { (activeDoc as any).isClickScrolling = false; }, 500);
      }
    }
  });
</script>

<div 
  bind:this={pageContainer}
  class="bg-white relative rounded-sm mb-12 select-none"
  style="box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.65);"
>
  <canvas bind:this={canvasElement} class="block max-w-full h-auto rounded-sm"></canvas>
</div>