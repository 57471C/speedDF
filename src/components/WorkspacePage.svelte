<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { onMount } from "svelte";
  import { activeDoc, type AnnotationShape } from "../pdfStore.svelte"; 

  let { bytes, pageNumber, zoomScale } = $props<{ bytes: Uint8Array; pageNumber: number; zoomScale: number }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let pageContainer = $state<HTMLDivElement | null>(null);
  let rendering = false;

  // Drawing state metrics
  let isDrawing = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);

  // Live reactive array accumulating active freehand highlight coordinates
  let liveHighlightPoints = $state<{ x: number; y: number }[]>([]);

  // Selection states
  let activelyEditingIndex = $state<number | null>(null);
  let draggingHandle = $state<string | null>(null);
  let initialShapeState = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let isMovingShape = $state(false);
  let moveAnchorPct = $state({ x: 0, y: 0 });

  // Hover alignment coordinates
  let isMouseOverPage = $state(false);
  let hoverPctX = $state(0);
  let hoverPctY = $state(0);

  let ghostDimensions = $derived.by(() => {
    const tool = activeDoc.activeTool;
    if (tool !== 'signature' && tool !== 'initial') return { w: 0, h: 0 };
    const isSig = tool === 'signature';
    const cachedWidth = localStorage.getItem(`speeddf_stamp_${tool}_w`);
    const cachedHeight = localStorage.getItem(`speeddf_stamp_${tool}_h`);
    return {
      w: cachedWidth ? parseFloat(cachedWidth) : (isSig ? 18 : 6),
      h: cachedHeight ? parseFloat(cachedHeight) : (isSig ? 8 : 6)
    };
  });

  function autofocusAction(node: HTMLInputElement) {
    setTimeout(() => { node.focus(); }, 0);
  }

  $effect(() => {
    const degrees = activeDoc.rotations[pageNumber] ?? 0;
    if (bytes && canvasElement && zoomScale) {
      renderPageSheet(bytes, pageNumber, zoomScale, canvasElement, degrees);
    }
  });

  async function renderPageSheet(pdfBytes: Uint8Array, pageNum: number, scale: number, canvas: HTMLCanvasElement, rotationAngle: number) {
    if (rendering) return;
    rendering = true;
    try {
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale / 100, rotation: (page.rotate + rotationAngle) % 360 });
      const context = canvas.getContext("2d");
      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvas: canvas, viewport: viewport }).promise;
      }
    } catch (error) {
      console.error(error);
    } finally {
      rendering = false;
    }
  }

  // MOUSE EVENT CONTROLLER
  function handleMouseDown(e: MouseEvent) {
    if (!pageContainer) return;
    const targetElement = e.target as HTMLElement;

    if (targetElement.closest('input') || targetElement.closest('.resize-handle-node')) return;

    const rect = pageContainer.getBoundingClientRect();
    const mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
    const mousePctY = ((e.clientY - rect.top) / rect.height) * 100;

    if (activeDoc.activeTool === 'select') {
      activeDoc.selectedShape = null; 
      return;
    }

    if (activeDoc.activeTool === 'highlight') {
      e.preventDefault();
      isDrawing = true;
      liveHighlightPoints = [{ x: mousePctX, y: mousePctY }];
      return;
    }

    if ((activeDoc.activeTool === 'signature' || activeDoc.activeTool === 'initial') && activeDoc.activeStampDataUrl) {
      e.preventDefault();
      const toolType = activeDoc.activeTool as "signature" | "initial";
      const dims = ghostDimensions;
      const newSignatureStamp: AnnotationShape = {
        type: toolType, x: mousePctX - (dims.w / 2), y: mousePctY - (dims.h / 2), width: dims.w, height: dims.h, dataUrl: activeDoc.activeStampDataUrl
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing, newSignatureStamp] };
      activeDoc.selectedShape = { pageNumber, index: existing.length };
      return;
    }

    if (activeDoc.activeTool === 'tick' || activeDoc.activeTool === 'dash') {
      e.preventDefault();
      const toolType = activeDoc.activeTool as "tick" | "dash";
      const isTick = toolType === 'tick';
      const cachedWidth = localStorage.getItem(`speeddf_stamp_${toolType}_w`);
      const cachedHeight = localStorage.getItem(`speeddf_stamp_${toolType}_h`);
      const targetWidth = cachedWidth ? parseFloat(cachedWidth) : (isTick ? 4 : 6);
      const targetHeight = cachedHeight ? parseFloat(cachedHeight) : (isTick ? 4 : 2);

      const newStampShape: AnnotationShape = {
        type: toolType, x: mousePctX - (targetWidth / 2), y: mousePctY - (targetHeight / 2), width: targetWidth, height: targetHeight
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing, newStampShape] };
      activeDoc.selectedShape = { pageNumber, index: existing.length };
      return;
    }

    if (activeDoc.activeTool === 'text') {
      e.preventDefault();
      const newTextShape: AnnotationShape = { type: "text", x: mousePctX, y: mousePctY, text: "" };
      const existing = activeDoc.shapes[pageNumber] || [];
      const newIndex = existing.length;
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing, newTextShape] };
      activelyEditingIndex = newIndex;
      activeDoc.selectedShape = { pageNumber, index: newIndex };
      return;
    }

    if (activeDoc.activeTool === 'rect') {
      isDrawing = true;
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      currentX = startX;
      currentY = startY;
    }
  }

  function initShapeMove(e: MouseEvent, index: number) {
    if (activeDoc.activeTool !== 'select' || activelyEditingIndex !== null) return;
    e.stopPropagation(); 
    activeDoc.selectedShape = { pageNumber, index };
    
    if (!pageContainer) return;
    const rect = pageContainer.getBoundingClientRect();
    const mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
    const mousePctY = ((e.clientY - rect.top) / rect.height) * 100;
    const shape = activeDoc.shapes[pageNumber][index];
    if (shape) {
      isMovingShape = true;
      moveAnchorPct = { x: mousePctX - shape.x, y: mousePctY - shape.y };
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!pageContainer) return;

    const rect = pageContainer.getBoundingClientRect();
    const mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
    const mousePctY = ((e.clientY - rect.top) / rect.height) * 100;

    hoverPctX = mousePctX;
    hoverPctY = mousePctY;

    if (isDrawing && activeDoc.activeTool === 'highlight') {
      liveHighlightPoints = [...liveHighlightPoints, { x: mousePctX, y: mousePctY }];
      return;
    }

    if (isMovingShape && activeDoc.selectedShape) {
      const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
      const index = activeDoc.selectedShape.index;
      const shape = shapesList[index];
      if (shape) {
        shape.x = Math.max(0, Math.min(100, mousePctX - moveAnchorPct.x));
        shape.y = Math.max(0, Math.min(100, mousePctY - moveAnchorPct.y));
        activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
      }
      return;
    }

    if (draggingHandle && activeDoc.selectedShape && initialShapeState) {
      const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
      const index = activeDoc.selectedShape.index;
      const shape = shapesList[index];
      const initial = initialShapeState;
      const minSizePct = 0.1; 

      if (!shape) return;

      if (draggingHandle === 'br') {
        shape.width = Math.max(minSizePct, mousePctX - initial.x);
        shape.height = Math.max(minSizePct, mousePctY - initial.y);
      } else if (draggingHandle === 'tl') {
        const currentRight = initial.x + initial.width;
        const currentBottom = initial.y + initial.height;
        shape.x = Math.min(currentRight - minSizePct, Math.max(0, mousePctX));
        shape.y = Math.min(currentBottom - minSizePct, Math.max(0, mousePctY));
        shape.width = currentRight - shape.x;
        shape.height = currentBottom - shape.y;
      } else if (draggingHandle === 'tr') {
        const currentBottom = initial.y + initial.height;
        shape.y = Math.min(currentBottom - minSizePct, Math.max(0, mousePctY));
        shape.width = Math.max(minSizePct, mousePctX - shape.x);
        shape.height = currentBottom - shape.y;
      } else if (draggingHandle === 'bl') {
        const currentRight = initial.x + initial.width;
        shape.x = Math.min(currentRight - minSizePct, Math.max(0, mousePctX));
        shape.width = currentRight - shape.x;
        shape.height = Math.max(minSizePct, mousePctY - shape.y);
      }

      if (['tick','dash','signature','initial'].includes(shape.type) && shape.width && shape.height) {
        localStorage.setItem(`speeddf_stamp_${shape.type}_w`, shape.width.toString());
        localStorage.setItem(`speeddf_stamp_${shape.type}_h`, shape.height.toString());
      }

      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
      return;
    }

    if (!isDrawing || activeDoc.activeTool !== 'rect') return;
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
  }

  function handleMouseUp() {
    if (isDrawing && activeDoc.activeTool === 'highlight') {
      isDrawing = false;
      if (liveHighlightPoints.length > 1) {
        const newHighlight: AnnotationShape = {
          type: "highlight",
          x: liveHighlightPoints[0].x,
          y: liveHighlightPoints[0].y,
          points: [...liveHighlightPoints]
        };
        const existing = activeDoc.shapes[pageNumber] || [];
        activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing, newHighlight] };
      }
      liveHighlightPoints = [];
      return;
    }

    isMovingShape = false;
    if (draggingHandle) { draggingHandle = null; initialShapeState = null; return; }
    if (!isDrawing || !pageContainer || activeDoc.activeTool !== 'rect') return;
    isDrawing = false;

    const rect = pageContainer.getBoundingClientRect();
    const widthPixels = Math.abs(currentX - startX);
    const heightPixels = Math.abs(currentY - startY);

    if (widthPixels > 2 && heightPixels > 2) {
      const newShape: AnnotationShape = {
        type: "rect",
        x: (Math.min(startX, currentX) / rect.width) * 100,
        y: (Math.min(startY, currentY) / rect.height) * 100,
        width: (widthPixels / rect.width) * 100,
        height: (heightPixels / rect.height) * 100
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing, newShape] };
    }
  }

  function initHandleDrag(e: MouseEvent, index: number, handleType: string) {
    e.stopPropagation(); e.preventDefault(); draggingHandle = handleType;
    const shape = activeDoc.shapes[pageNumber][index];
    if (shape) initialShapeState = { x: shape.x, y: shape.y, width: shape.width || 0, height: shape.height || 0 };
  }

  function finalizeTextEdit(index: number, element: HTMLInputElement) {
    const existing = activeDoc.shapes[pageNumber] || [];
    if (existing[index]) {
      existing[index].text = element.value.trim();
      if (!existing[index].text) { existing.splice(index, 1); activeDoc.selectedShape = null; }
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing] };
    }
    activelyEditingIndex = null;
  }

  onMount(() => {
    if (!pageContainer) return;
    const trueScrollViewport = pageContainer.parentElement?.parentElement;

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.key === "Delete" || event.key === "Backspace") && activeDoc.selectedShape) {
        if (document.activeElement?.tagName === "INPUT") return;
        const { pageNumber: targetPage, index: targetIdx } = activeDoc.selectedShape;
        const existingList = [...(activeDoc.shapes[targetPage] || [])];
        if (existingList[targetIdx]) {
          existingList.splice(targetIdx, 1);
          activeDoc.shapes = { ...activeDoc.shapes, [targetPage]: existingList };
          activeDoc.selectedShape = null; 
        }
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !(activeDoc as any).isClickScrolling) {
            const containerTop = (activeDoc as any).scrollTop ?? 0;
            if (containerTop === 0) activeDoc.currentPage = 1;
            else if (activeDoc.currentPage !== pageNumber) activeDoc.currentPage = pageNumber;
          }
        }
      },
      { root: trueScrollViewport || null, threshold: 0.4 }
    );

    window.addEventListener("keydown", handleGlobalKeyDown);
    observer.observe(pageContainer);
    return () => { window.removeEventListener("keydown", handleGlobalKeyDown); observer.disconnect(); };
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
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseenter={() => isMouseOverPage = true}
  onmouseleave={() => { isMouseOverPage = false; isDrawing = false; }}
  class="bg-white relative rounded-sm mb-12 select-none"
  style="box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.65);"
>
  <canvas bind:this={canvasElement} class="block max-w-full h-auto rounded-sm"></canvas>

  <div 
    class="absolute inset-0 overflow-hidden rounded-sm select-none z-30
      {['rect','text','select','tick','dash','signature','initial','highlight'].includes(activeDoc.activeTool || '') ? 'pointer-events-auto' : 'pointer-events-none'}
      {activeDoc.activeTool === 'rect' || activeDoc.activeTool === 'highlight' ? 'cursor-crosshair' : ''}
      {activeDoc.activeTool === 'text' ? 'cursor-text' : ''}"
  >
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="absolute inset-0 w-full h-full pointer-events-none z-10">
  {#each activeDoc.shapes[pageNumber] || [] as shape, idx}
    {#if shape.type === "highlight" && shape.points}
      <polyline 
        onclick={(e) => { e.stopPropagation(); if (activeDoc.activeTool === 'select') activeDoc.selectedShape = { pageNumber, index: idx }; }}
        points={shape.points.map(p => `${p.x},${p.y}`).join(' ')} 
        stroke="#fff200" stroke-width="2.0" stroke-opacity="0.42" fill="none" 
        stroke-linecap="round" 
        stroke-linejoin="round" 
        class="cursor-pointer pointer-events-auto hover:stroke-yellow-300 transition-colors"
      />
    {/if}
  {/each}

  {#if liveHighlightPoints.length > 1 && activeDoc.activeTool === 'highlight'}
    <polyline 
      points={liveHighlightPoints.map(p => `${p.x},${p.y}`).join(' ')} 
      stroke="#fff200" stroke-width="2.0" stroke-opacity="0.48" 
      fill="none" 
      stroke-linecap="round" 
      stroke-linejoin="round" 
    />
  {/if}
</svg>

    {#each activeDoc.shapes[pageNumber] || [] as shape, idx}
      {#if shape.type === "rect"}
        <div 
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute border-2 rounded-sm transition-shadow duration-150 cursor-move z-20
            {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'border-[#00d2ff] bg-[#00d2ff]/12 shadow-[0_0_12px_rgba(0,210,255,0.3)]' : 'border-[#00d2ff] bg-[#00d2ff]/5 hover:border-[#00d2ff]/80'}"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
        >
          {#if activeDoc.activeTool === 'select' && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tl')} class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 border-[#00d2ff] -top-1.5 -left-1.5 cursor-nwse-resize rounded-full shadow-md"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tr')} class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 border-[#00d2ff] -top-1.5 -right-1.5 cursor-nesw-resize rounded-full shadow-md"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'bl')} class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 border-[#00d2ff] -bottom-1.5 -left-1.5 cursor-nesw-resize rounded-full shadow-md"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'br')} class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 border-[#00d2ff] -bottom-1.5 -right-1.5 cursor-nwse-resize rounded-full shadow-md"></div>
          {/if}
        </div>
      
      {:else if shape.type === "text"}
        <div class="absolute text-slate-900 pointer-events-auto transform -translate-y-1/2 z-40" style="left: {shape.x}%; top: {shape.y}%;">
          {#if activelyEditingIndex === idx}
            <input 
              type="text" bind:value={activeDoc.shapes[pageNumber][idx].text} use:autofocusAction
              onblur={(e) => finalizeTextEdit(idx, e.currentTarget)}
              onkeydown={(e) => { if (e.key === 'Enter') finalizeTextEdit(idx, e.currentTarget); }}
              class="bg-white/95 text-slate-900 border border-[#00d2ff] outline-none px-1.5 py-0.5 rounded shadow-xl font-semibold tracking-wide font-sans max-w-[280px]"
              style="font-size: calc(13px * {zoomScale / 100});"
            />
          {:else}
            <span 
              onmousedown={(e) => initShapeMove(e, idx)} ondblclick={(e) => { e.stopPropagation(); activelyEditingIndex = idx; }}
              class="block bg-transparent border border-dashed rounded-xs font-semibold tracking-wide font-sans whitespace-nowrap transition-colors text-slate-950 cursor-move p-0.5
                {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'border-[#00d2ff] bg-cyan-500/5' : 'border-transparent hover:border-slate-400/30'}"
              style="font-size: calc(13px * {zoomScale / 100});"
            >
              {shape.text || " "}
            </span>
          {/if}
        </div>

      {:else if shape.type === "tick"}
        <div 
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm transition-all cursor-move
            {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'border-[#00d2ff] bg-[#00d2ff]/12 shadow-[0_0_12px_rgba(0,210,255,0.3)]' : 'border-transparent hover:border-slate-400/30'}"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
        >
          <svg viewBox="0 0 24 24" fill="none" class="w-full h-full text-black stroke-black" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {#if activeDoc.activeTool === 'select' && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tr')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'bl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'br')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full"></div>
          {/if}
        </div>

      {:else if shape.type === "dash"}
        <div 
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm transition-all cursor-move
            {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'border-[#00d2ff] bg-[#00d2ff]/12 shadow-[0_0_12px_rgba(0,210,255,0.3)]' : 'border-transparent hover:border-slate-400/30'}"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
        >
          <svg viewBox="0 0 24 24" fill="none" class="w-full h-full text-black stroke-black" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" preserveAspectRatio="none">
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
          {#if activeDoc.activeTool === 'select' && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tr')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'bl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'br')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full"></div>
          {/if}
        </div>

      {:else if shape.type === "signature" || shape.type === "initial"}
        <div 
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center border rounded-sm transition-all cursor-move p-0.5 overflow-hidden mix-blend-multiply bg-transparent
            {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'border-[#00d2ff] shadow-[0_0_12px_rgba(0,210,255,0.35)]' : 'border-transparent hover:border-slate-400/30'}"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
        >
          <img src={shape.dataUrl} alt="Sign Vector Content" class="w-full h-full object-contain pointer-events-none select-none" />
          {#if activeDoc.activeTool === 'select' && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full shadow"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'tr')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full shadow"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'bl')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full shadow"></div>
            <div onmousedown={(e) => initHandleDrag(e, idx, 'br')} class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full shadow"></div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if isMouseOverPage && ['signature', 'initial'].includes(activeDoc.activeTool || '') && activeDoc.activeStampDataUrl}
      <div class="absolute pointer-events-none opacity-45 mix-blend-multiply transform -translate-x-1/2 -translate-y-1/2 border border-dashed border-[#00d2ff] bg-cyan-500/5 flex items-center justify-center p-0.5 rounded-xs"
        style="left: {hoverPctX}%; top: {hoverPctY}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;">
        <img src={activeDoc.activeStampDataUrl} alt="Ghost Alignment Helper" class="w-full h-full object-contain filter brightness-95 contrast-105" />
      </div>
    {/if}

    {#if isDrawing && activeDoc.activeTool === 'rect'}
      <div class="absolute border-2 border-dashed border-[#38bdf8] bg-[#38bdf8]/10 rounded-sm"
        style="left: {Math.min(startX, currentX)}px; top: {Math.min(startY, currentY)}px; width: {Math.abs(currentX - startX)}px; height: {Math.abs(currentY - startY)}px;"></div>
    {/if}
  </div>
</div>