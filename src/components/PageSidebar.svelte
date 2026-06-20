<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc, rotatePageAction } from "../pdfStore.svelte";

  let sidebarContainer = $state<HTMLDivElement | null>(null);
  let thumbnailElements = $state<Record<number, HTMLDivElement>>({});

  // Viewport viewfinder box percentage calculations
  let viewportBoxTop = $derived.by(() => {
    if (!activeDoc.scrollHeight || activeDoc.scrollHeight === 0) return 0;
    return Math.min((activeDoc.scrollTop / activeDoc.scrollHeight) * 100, 100);
  });

  let viewportBoxHeight = $derived.by(() => {
    if (!activeDoc.scrollHeight || activeDoc.scrollHeight === 0) return 0;
    return Math.min(
      (activeDoc.clientHeight / activeDoc.scrollHeight) * 100,
      100,
    );
  });

  // ⚡ Add this new state variable
  let isTrackerReady = $state(false);

  // ⚡ Add this effect to manage the timing
  $effect(() => {
    if (activeDoc.pageOrder.length > 0 && activeDoc.scrollHeight > 0) {
      // Wait 1000ms for PDF.js to finish rendering canvases and pushing the height down
      const timer = setTimeout(() => {
        isTrackerReady = true;
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      isTrackerReady = false;
    }
  });

  // ⚡ FIXED: Parametrized to accept 'canvas: node' to perfectly align with your RenderParameters type signatures
  function renderThumbnail(
    node: HTMLCanvasElement,
    { pageNum, rotation }: { pageNum: number; rotation: number },
  ) {
    let isRendering = false;

    async function executeRender(pNum: number, rot: number) {
      if (!activeDoc.rawBytes || isRendering) return;
      isRendering = true;

      try {
        const loadingTask = pdfjsLib.getDocument({
          data: activeDoc.rawBytes.slice(0),
        });
        const pdfDocument = await loadingTask.promise;
        const page = await pdfDocument.getPage(pNum);

        const targetWidth = 84;
        const unrotatedViewport = page.getViewport({ scale: 1 });
        const currentRotation = (page.rotate + rot) % 360;

        const isVerticalFactor = currentRotation % 180 === 0;
        const renderWidth = isVerticalFactor
          ? unrotatedViewport.width
          : unrotatedViewport.height;
        const calculatedScale = targetWidth / renderWidth;

        const viewport = page.getViewport({
          scale: calculatedScale,
          rotation: currentRotation,
        });

        // Resize element boundary domains prior to rendering
        node.height = viewport.height;
        node.width = viewport.width;

        // ⚡ FIXED: Passed 'canvas: node' instead of canvasContext to clear the type compilation block
        await page.render({
          canvas: node,
          viewport: viewport,
        }).promise;
      } catch (err) {
        console.error(`Thumbnail render failed for page ${pNum}:`, err);
      } finally {
        isRendering = false;
      }
    }

    executeRender(pageNum, rotation);
    return {
      update(newParams: { pageNum: number; rotation: number }) {
        executeRender(newParams.pageNum, newParams.rotation);
      },
    };
  }

  // Smoothly centers the active thumbnail card when navigating the viewport
  $effect(() => {
    const activePage = activeDoc.currentPage;
    const targetCard = thumbnailElements[activePage];
    if (targetCard && !(activeDoc as any).isClickScrolling) {
      targetCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  function jumpToTargetPage(pageNum: number) {
    (activeDoc as any).isClickScrolling = true;
    activeDoc.currentPage = pageNum;
  }

  function dropTargetPageElement(e: MouseEvent, pageNum: number) {
    e.stopPropagation();
    if (activeDoc.pageOrder.length <= 1) {
      alert(
        "Cannot drop pages past a single root document sheet canvas layer bound.",
      );
      return;
    }
    activeDoc.pageOrder = activeDoc.pageOrder.filter((n) => n !== pageNum);
    if (activeDoc.currentPage === pageNum) {
      const remainingIndex = activeDoc.pageOrder.indexOf(pageNum);
      activeDoc.currentPage =
        activeDoc.pageOrder[Math.max(0, remainingIndex - 1)];
    }
    activeDoc.selectedShape = null;
  }
</script>

<div
  class="w-36 h-full bg-[#090d16] border-l border-slate-900 flex flex-col relative select-none z-40"
>
  <div
    class="p-3 border-b border-slate-900/50 flex items-center justify-between bg-[#0b101c]/40"
  >
    <span
      class="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-sans"
      >Pages ({activeDoc.pageOrder.length})</span
    >
  </div>

  <div
    bind:this={sidebarContainer}
    class="flex-1 overflow-y-auto overflow-x-hidden p-3 relative"
    style="color-scheme: dark;"
  >
    <div class="relative w-full flex flex-col gap-3">
      {#if isTrackerReady}
        <div
          class="absolute left-0 right-0 pointer-events-none transition-all duration-150 border-2 border-red-500 bg-red-500/10 rounded-lg z-50 shadow-[0_0_15px_rgba(239,68,68,0.25)]"
          style="top: {viewportBoxTop}%; height: {viewportBoxHeight}%; min-height: 40px;"
        ></div>
      {/if}

      {#each activeDoc.pageOrder as pageNum, index (pageNum)}
        <div
          bind:this={thumbnailElements[pageNum]}
          onclick={() => jumpToTargetPage(pageNum)}
          class="group relative flex flex-col items-center bg-[#111827]/40 border rounded-lg p-2 transition-all cursor-pointer select-none z-20
          {activeDoc.currentPage === pageNum
            ? 'border-slate-600 bg-[#161b22]'
            : 'border-slate-800 hover:border-slate-700'}"
        >
          <span
            class="absolute top-1.5 left-2 text-[9px] font-bold text-slate-500 tracking-wider z-10"
          >
            #{index + 1}
          </span>

          <div
            class="w-[84px] min-h-[60px] bg-white/5 rounded border border-slate-900/40 overflow-hidden flex items-center justify-center mt-3 shadow-inner relative"
          >
            <canvas
              use:renderThumbnail={{
                pageNum,
                rotation: activeDoc.rotations[pageNum] ?? 0,
              }}
              class="block h-auto max-w-full bg-white filter tracking-tight"
            ></canvas>
          </div>

          <div
            class="flex items-center justify-center gap-1.5 mt-2.5 w-full opacity-40 group-hover:opacity-100 transition-opacity"
          >
            <button
              onclick={(e) => {
                e.stopPropagation();
                rotatePageAction(pageNum, "counter");
              }}
              class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Rotate Left"
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
                stroke-linejoin="round"
                ><path
                  d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                /><path d="M3 3v5h5" /></svg
              >
            </button>

            <button
              onclick={(e) => dropTargetPageElement(e, pageNum)}
              class="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition-colors"
              title="Delete Page"
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
                stroke-linejoin="round"
                ><path d="M3 6h18" /><path
                  d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg
              >
            </button>

            <button
              onclick={(e) => {
                e.stopPropagation();
                rotatePageAction(pageNum, "clockwise");
              }}
              class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Rotate Right"
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
                stroke-linejoin="round"
                ><path
                  d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
                /><path d="M21 3v5h-5" /></svg
              >
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
