<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { onMount } from "svelte";
  import { activeDoc, type AnnotationShape, pushHistorySnapshot, FONT_MAP } from "../pdfStore.svelte";

  let { bytes, pageNumber, zoomScale, isSystemPrinting = false } = $props<{
    bytes: Uint8Array;
    pageNumber: number;
    zoomScale: number;
    isSystemPrinting?: boolean;
  }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let pageContainer = $state<HTMLDivElement | null>(null);
  let rendering = false;

  let isPreloaded = $state(false); // Tracks metadata visibility (Wide)
  let isRendered = $state(false);  // Tracks canvas paint visibility (Tight)
  let basePageWidth = $state<number>(612); // standard letter/A4 default fallback
  let basePageHeight = $state<number>(792);
  let loadedDimensions = $state(false);

  let activeRenderTask: any = null;
  let activePdfPage: any = null;

  // Calculate the current expected width and height (CSS pixels)
  // based on current zoomScale and rotations
  const expectedDimensions = $derived.by(() => {
    const scale = zoomScale / 100;
    const rotationAngle = activeDoc.rotations[pageNumber] ?? 0;
    const totalRotation = rotationAngle % 360;
    
    // If rotated by 90 or 270 degrees, swap width and height
    const isStandardPortrait = (totalRotation / 90) % 2 === 0;
    const w = isStandardPortrait ? basePageWidth : basePageHeight;
    const h = isStandardPortrait ? basePageHeight : basePageWidth;
    
    return {
      width: w * scale,
      height: h * scale,
      aspectRatio: w / h
    };
  });

  // Load page dimensions initially to get aspect ratio
  $effect(() => {
    if (bytes && pageNumber && !loadedDimensions) {
      if (activeDoc.fileType === "tiff") {
        const pageData = activeDoc.tiffPages[pageNumber - 1];
        if (pageData) {
          const blob = new Blob([pageData as any], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            basePageWidth = img.width;
            basePageHeight = img.height;
            loadedDimensions = true;
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }
        return;
      }
      if (isPreloaded) {
        const loadingTask = pdfjsLib.getDocument({
          data: bytes.slice(0),
          cMapUrl: window.location.origin + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: window.location.origin + "/standard_fonts/",
          wasmUrl: window.location.origin + "/"
        });
        loadingTask.promise.then((pdfDocument) => {
          return pdfDocument.getPage(pageNumber);
        }).then((page) => {
          const viewport = page.getViewport({ scale: 1 });
          basePageWidth = viewport.width;
          basePageHeight = viewport.height;
          loadedDimensions = true;
        }).catch(err => {
          console.error("Failed to load page dimensions:", err);
        });
      }
    }
  });

  function canvasLifecycle(node: HTMLCanvasElement) {
    canvasElement = node;
    if (activeDoc.fileType === "tiff") {
      // pageNum typically corresponds to the loop index or active viewport tracker
      const pageNum = pageNumber;
      const pageData = activeDoc.tiffPages[pageNum - 1];
      const rotation = activeDoc.rotations[pageNum] ?? 0;
      
      if (pageData) {
        const blob = new Blob([pageData as any], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (rotation === 90 || rotation === 270) {
            node.width = img.height;
            node.height = img.width;
          } else {
            node.width = img.width;
            node.height = img.height;
          }

          const ctx = node.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, node.width, node.height);
            ctx.save();
            ctx.translate(node.width / 2, node.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            ctx.restore();
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
      return {
        destroy() {
          if (!isSystemPrinting) {
            node.width = 0;
            node.height = 0;
            canvasElement = null;
          }
        }
      };
    }
    return {
      destroy() {
        if (!isSystemPrinting) {
          node.width = 0;
          node.height = 0;
          canvasElement = null;
        }
      }
    };
  }

  // Short-circuit the page observers/render state during printing
  $effect(() => {
    if (isSystemPrinting) {
      isPreloaded = true;
      isRendered = true;
    }
  });

  let isDrawing = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);

  let liveHighlightPoints = $state<{ x: number; y: number }[]>([]);

  let activelyEditingIndex = $state<number | null>(null);
  let draggingHandle = $state<string | null>(null);
  let initialShapeState = $state<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  let isMovingShape = $state(false);
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragTargetElement: HTMLElement | null = null;

  let isMouseOverPage = $state(false);
  let hoverPctX = $state(0);
  let hoverPctY = $state(0);

  const shapeTypesList = [
    "rect",
    "round-rect",
    "oval",
    "rect-fill",
    "round-rect-fill",
    "oval-fill",
  ];

  let ghostDimensions = $derived.by(() => {
    const tool = activeDoc.activeTool;
    if (!tool) return { w: 0, h: 0 };
    if (["signature", "initial", "tick", "dash"].includes(tool)) {
      const cachedWidth = localStorage.getItem(`speeddf_stamp_${tool}_w`);
      const cachedHeight = localStorage.getItem(`speeddf_stamp_${tool}_h`);
      if (cachedWidth && cachedHeight) {
        return { w: parseFloat(cachedWidth), h: parseFloat(cachedHeight) };
      }
      if (tool === "signature") return { w: 18, h: 8 };
      if (tool === "initial") return { w: 6, h: 6 };
      if (tool === "tick") return { w: 4, h: 4 };
      if (tool === "dash") return { w: 6, h: 2 };
    }
    return { w: 0, h: 0 };
  });

  function autofocusAction(node: HTMLInputElement) {
    setTimeout(() => {
      node.focus();
    }, 0);
  }

  $effect(() => {
    const degrees = activeDoc.rotations[pageNumber] ?? 0;
    if (isRendered && bytes && canvasElement && zoomScale) {
      renderPageSheet(bytes, pageNumber, zoomScale, canvasElement, degrees);
    }
  });

  $effect(() => {
    if (!isRendered && !isSystemPrinting) {
      if (activeRenderTask) {
        try {
          activeRenderTask.cancel();
        } catch (e) {}
        activeRenderTask = null;
      }
      if (activePdfPage) {
        try {
          activePdfPage.cleanup();
        } catch (e) {}
        activePdfPage = null;
      }
    }
  });

  async function renderPageSheet(
    pdfBytes: Uint8Array,
    pageNum: number,
    scale: number,
    canvas: HTMLCanvasElement,
    rotationAngle: number,
  ) {
    if (activeDoc.fileType === "tiff") {
      const pageData = activeDoc.tiffPages[pageNum - 1];
      const rotation = activeDoc.rotations[pageNum] ?? 0;
      
      if (pageData) {
        const blob = new Blob([pageData as any], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (rotation === 90 || rotation === 270) {
            canvas.width = img.height;
            canvas.height = img.width;
          } else {
            canvas.width = img.width;
            canvas.height = img.height;
          }

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            ctx.restore();
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
      return;
    }
    if (rendering) {
      if (activeRenderTask) {
        try {
          activeRenderTask.cancel();
        } catch (e) {}
        activeRenderTask = null;
      }
    }
    rendering = true;
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
      activePdfPage = page;
      
      const dpr = window.devicePixelRatio || 1;
      const baseScale = scale / 100;
      const adjustedViewport = page.getViewport({
        scale: baseScale * dpr,
        rotation: (page.rotate + rotationAngle) % 360,
      });

      const context = canvas.getContext("2d");
      if (context) {
        canvas.width = adjustedViewport.width;
        canvas.height = adjustedViewport.height;
        canvas.style.width = `${adjustedViewport.width / dpr}px`;
        canvas.style.height = `${adjustedViewport.height / dpr}px`;
        activeRenderTask = page.render({ canvas: canvas, viewport: adjustedViewport });
        await activeRenderTask.promise;
      }
    } catch (error) {
      console.error(error);
    } finally {
      rendering = false;
      activeRenderTask = null;
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (!pageContainer) return;
    const targetElement = e.target as HTMLElement;
    if (
      targetElement.closest("input") ||
      targetElement.closest(".resize-handle-node")
    )
      return;

 pushHistorySnapshot();

    const rect = pageContainer.getBoundingClientRect();
    const mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
    const mousePctY = ((e.clientY - rect.top) / rect.height) * 100;

    if (activeDoc.activeTool === "select") {
      activeDoc.selectedShape = null;
      return;
    }
    if (activeDoc.activeTool === "highlight") {
      e.preventDefault();
      isDrawing = true;
      liveHighlightPoints = [{ x: mousePctX, y: mousePctY }];
      return;
    }

    if (
      (activeDoc.activeTool === "signature" ||
        activeDoc.activeTool === "initial") &&
      activeDoc.activeStampDataUrl
    ) {
      e.preventDefault();
      const toolType = activeDoc.activeTool as "signature" | "initial";
      const dims = ghostDimensions;
      const newSignatureStamp: AnnotationShape = {
        type: toolType,
        x: mousePctX - dims.w / 2,
        y: mousePctY - dims.h / 2,
        width: dims.w,
        height: dims.h,
        dataUrl: activeDoc.activeStampDataUrl,
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = {
        ...activeDoc.shapes,
        [pageNumber]: [...existing, newSignatureStamp],
      };
      activeDoc.selectedShape = { pageNumber, index: existing.length };
      return;
    }

    if (activeDoc.activeTool === "tick" || activeDoc.activeTool === "dash") {
      e.preventDefault();
      const toolType = activeDoc.activeTool as "tick" | "dash";
      const isTick = toolType === "tick";
      const cachedWidth = localStorage.getItem(`speeddf_stamp_${toolType}_w`);
      const cachedHeight = localStorage.getItem(`speeddf_stamp_${toolType}_h`);
      const targetWidth = cachedWidth
        ? parseFloat(cachedWidth)
        : isTick
          ? 4
          : 6;
      const targetHeight = cachedHeight
        ? parseFloat(cachedHeight)
        : isTick
          ? 4
          : 2;

      const newStampShape: AnnotationShape = {
        type: toolType,
        x: mousePctX - targetWidth / 2,
        y: mousePctY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight,
        color: activeDoc.activeColor,
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = {
        ...activeDoc.shapes,
        [pageNumber]: [...existing, newStampShape],
      };
      activeDoc.selectedShape = { pageNumber, index: existing.length };
      return;
    }

    if (activeDoc.activeTool === "text") {
      e.preventDefault();
      const newTextShape: AnnotationShape = {
        type: "text",
        x: mousePctX,
        y: mousePctY,
        text: "",
        font: activeDoc.defaultFont,
        size: activeDoc.defaultSize,
        style: activeDoc.defaultStyle || "Normal",
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      const newIndex = existing.length;
      activeDoc.shapes = {
        ...activeDoc.shapes,
        [pageNumber]: [...existing, newTextShape],
      };
      activelyEditingIndex = newIndex;
      activeDoc.selectedShape = { pageNumber, index: newIndex };
      return;
    }

    if (shapeTypesList.includes(activeDoc.activeTool || "")) {
      isDrawing = true;
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      currentX = startX;
      currentY = startY;
    }
  }

  function initShapeMove(e: MouseEvent, index: number) {
    if (activeDoc.activeTool !== "select" || activelyEditingIndex !== null)
      return;
    e.stopPropagation();
    activeDoc.selectedShape = { pageNumber, index };
    pushHistorySnapshot();
    if (!pageContainer) return;
    const shape = activeDoc.shapes[pageNumber][index];
    if (shape) {
      isMovingShape = true;
      dragStartMouseX = e.clientX;
      dragStartMouseY = e.clientY;
      dragTargetElement = e.currentTarget as HTMLElement;
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!pageContainer) return;
    const rect = pageContainer.getBoundingClientRect();
    const mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
    const mousePctY = ((e.clientY - rect.top) / rect.height) * 100;
    hoverPctX = mousePctX;
    hoverPctY = mousePctY;

    if (isDrawing && activeDoc.activeTool === "highlight") {
      liveHighlightPoints = [
        ...liveHighlightPoints,
        { x: mousePctX, y: mousePctY },
      ];
      return;
    }

    if (isMovingShape && activeDoc.selectedShape && dragTargetElement) {
      const deltaX = e.clientX - dragStartMouseX;
      const deltaY = e.clientY - dragStartMouseY;
      dragTargetElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      return;
    }

    if (draggingHandle && activeDoc.selectedShape && initialShapeState) {
      const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
      const index = activeDoc.selectedShape.index;
      const shape = shapesList[index];
      const initial = initialShapeState;
      if (!shape) return;

      if (draggingHandle === "br") {
        shape.width = Math.max(0.1, mousePctX - initial.x);
        shape.height = Math.max(0.1, mousePctY - initial.y);
      } else if (draggingHandle === "tl") {
        const r = initial.x + initial.width;
        const b = initial.y + initial.height;
        shape.x = Math.min(r - 0.1, Math.max(0, mousePctX));
        shape.y = Math.min(b - 0.1, Math.max(0, mousePctY));
        shape.width = r - shape.x;
        shape.height = b - shape.y;
      } else if (draggingHandle === "tr") {
        const b = initial.y + initial.height;
        shape.y = Math.min(b - 0.1, Math.max(0, mousePctY));
        shape.width = Math.max(0.1, mousePctX - shape.x);
        shape.height = b - shape.y;
      } else if (draggingHandle === "bl") {
        const r = initial.x + initial.width;
        shape.x = Math.min(r - 0.1, Math.max(0, mousePctX));
        shape.width = r - shape.x;
        shape.height = Math.max(0.1, mousePctY - shape.y);
      }

      if (
        ["tick", "dash", "signature", "initial", ...shapeTypesList].includes(shape.type) &&
        shape.width &&
        shape.height
      ) {
        localStorage.setItem(
          `speeddf_stamp_${shape.type}_w`,
          shape.width.toString(),
        );
        localStorage.setItem(
          `speeddf_stamp_${shape.type}_h`,
          shape.height.toString(),
        );
      }
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
      return;
    }

    if (!isDrawing || !shapeTypesList.includes(activeDoc.activeTool || ""))
      return;
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
  }

  function handleMouseUp(e: MouseEvent) {
    if (isDrawing && activeDoc.activeTool === "highlight") {
      isDrawing = false;
      if (liveHighlightPoints.length > 1) {
        const newHighlight: AnnotationShape = {
          type: "highlight",
          x: liveHighlightPoints[0].x,
          y: liveHighlightPoints[0].y,
          points: [...liveHighlightPoints],
        };
        const existing = activeDoc.shapes[pageNumber] || [];
        activeDoc.shapes = {
          ...activeDoc.shapes,
          [pageNumber]: [...existing, newHighlight],
        };
      }
      liveHighlightPoints = [];
      return;
    }

    if (isMovingShape && activeDoc.selectedShape) {
      isMovingShape = false;
      if (dragTargetElement && pageContainer) {
        dragTargetElement.style.transform = "";
        
        const rect = pageContainer.getBoundingClientRect();
        const deltaX = e.clientX - dragStartMouseX;
        const deltaY = e.clientY - dragStartMouseY;
        const deltaPctX = (deltaX / rect.width) * 100;
        const deltaPctY = (deltaY / rect.height) * 100;

        const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
        const index = activeDoc.selectedShape.index;
        const shape = shapesList[index];
        if (shape) {
          shape.x = Math.max(0, Math.min(100, shape.x + deltaPctX));
          shape.y = Math.max(0, Math.min(100, shape.y + deltaPctY));
          activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
        }
      }
      dragTargetElement = null;
      return;
    }

    if (draggingHandle) {
      draggingHandle = null;
      initialShapeState = null;
      return;
    }
    if (
      !isDrawing ||
      !pageContainer ||
      !shapeTypesList.includes(activeDoc.activeTool || "")
    )
      return;
    isDrawing = false;

    const rect = pageContainer.getBoundingClientRect();
    const widthPixels = Math.abs(currentX - startX);
    const heightPixels = Math.abs(currentY - startY);

    if (widthPixels > 2 && heightPixels > 2) {
      const newShape: AnnotationShape = {
        type: activeDoc.activeTool as any,
        x: (Math.min(startX, currentX) / rect.width) * 100,
        y: (Math.min(startY, currentY) / rect.height) * 100,
        width: (widthPixels / rect.width) * 100,
        height: (heightPixels / rect.height) * 100,
        color: activeDoc.activeColor,
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = {
        ...activeDoc.shapes,
        [pageNumber]: [...existing, newShape],
      };
    }
  }

  function initHandleDrag(e: MouseEvent, index: number, handleType: string) {
    e.stopPropagation();
    e.preventDefault();
    draggingHandle = handleType;
    const shape = activeDoc.shapes[pageNumber][index];
    if (shape)
      initialShapeState = {
        x: shape.x,
        y: shape.y,
        width: shape.width || 0,
        height: shape.height || 0,
      };
  }
  function finalizeTextEdit(index: number, element: HTMLInputElement) {
    const existing = activeDoc.shapes[pageNumber] || [];
    if (existing[index]) {
      existing[index].text = element.value.trim();
      if (!existing[index].text) {
        existing.splice(index, 1);
        activeDoc.selectedShape = null;
      }
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing] };
    }
    activelyEditingIndex = null;
  }

  onMount(() => {
    if (!pageContainer) return;
    const trueScrollViewport = pageContainer.parentElement?.parentElement;
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        activeDoc.selectedShape
      ) {
        if (document.activeElement?.tagName === "INPUT") return;
        pushHistorySnapshot();
        const { pageNumber: targetPage, index: targetIdx } =
          activeDoc.selectedShape;
        const existingList = [...(activeDoc.shapes[targetPage] || [])];
        if (existingList[targetIdx]) {
          existingList.splice(targetIdx, 1);
          activeDoc.shapes = {
            ...activeDoc.shapes,
            [targetPage]: existingList,
          };
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
            else if (activeDoc.currentPage !== pageNumber)
              activeDoc.currentPage = pageNumber;
          }
        }
      },
      { root: trueScrollViewport || null, threshold: 0.4 },
    );

    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (isSystemPrinting) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isPreloaded = true;
          } else {
            isPreloaded = false;
          }
        }
      },
      {
        root: null,
        rootMargin: '3500px 0px 3500px 0px',
        threshold: 0.01
      }
    );

    const paintObserver = new IntersectionObserver(
      (entries) => {
        if (isSystemPrinting) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isRendered = true;
          } else {
            isRendered = false;
          }
        }
      },
      {
        root: null,
        rootMargin: '1200px 0px 1200px 0px',
        threshold: 0.01
      }
    );

    window.addEventListener("keydown", handleGlobalKeyDown);
    observer.observe(pageContainer);
    preloadObserver.observe(pageContainer);
    paintObserver.observe(pageContainer);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      observer.disconnect();
      preloadObserver.disconnect();
      paintObserver.disconnect();
    };
  });

  $effect(() => {
    if (activeDoc.currentPage === pageNumber && pageContainer) {
      if ((activeDoc as any).isClickScrolling) {
        pageContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          (activeDoc as any).isClickScrolling = false;
        }, 500);
      }
    }
  });
</script>

<div
  bind:this={pageContainer}
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseenter={() => (isMouseOverPage = true)}
  onmouseleave={() => {
    isMouseOverPage = false;
    isDrawing = false;
  }}
  class="bg-white relative rounded-sm mb-12 select-none"
  style="box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.65); width: {expectedDimensions.width}px; min-height: {expectedDimensions.height}px; aspect-ratio: {expectedDimensions.aspectRatio};"
>
  {#if isRendered}
    <canvas use:canvasLifecycle class="block max-w-full h-auto rounded-sm"
    ></canvas>
  {/if}

  <div
    class="absolute inset-0 overflow-hidden rounded-sm select-none z-30 {[
      'rect',
      'text',
      'select',
      'tick',
      'dash',
      'signature',
      'initial',
      'highlight',
      'round-rect',
      'oval',
      'rect-fill',
      'round-rect-fill',
      'oval-fill',
    ].includes(activeDoc.activeTool || '')
      ? 'pointer-events-auto'
      : 'pointer-events-none'} {[...shapeTypesList, 'highlight'].includes(
      activeDoc.activeTool || '',
    )
      ? 'cursor-crosshair'
      : ''} {activeDoc.activeTool === 'text' ? 'cursor-text' : ''}"
  >
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      class="absolute inset-0 w-full h-full pointer-events-none z-10"
    >
      {#each activeDoc.shapes[pageNumber] || [] as shape, idx}
        {#if shape.type === "highlight" && shape.points}
          <polyline
            onclick={(e) => {
              e.stopPropagation();
              if (activeDoc.activeTool === "select")
                activeDoc.selectedShape = { pageNumber, index: idx };
            }}
            points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke="#fff200"
            stroke-width="2.0"
            stroke-opacity="0.42"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cursor-pointer pointer-events-auto hover:stroke-yellow-300 transition-colors {activeDoc
              .selectedShape?.pageNumber === pageNumber &&
            activeDoc.selectedShape?.index === idx
              ? 'stroke-yellow-300 stroke-opacity-60'
              : ''}"
          />
        {/if}
      {/each}
      {#if liveHighlightPoints.length > 1 && activeDoc.activeTool === "highlight"}
        <polyline
          points={liveHighlightPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke="#fff200"
          stroke-width="2.0"
          stroke-opacity="0.48"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      {/if}
    </svg>

    {#each activeDoc.shapes[pageNumber] || [] as shape, idx}
      {#if shapeTypesList.includes(shape.type)}
        {#if shape.type === "oval" || shape.type === "oval-fill"}
          <div
            onmousedown={(e) => initShapeMove(e, idx)}
            class="absolute cursor-move z-20 transition-all duration-100
              {activeDoc.selectedShape?.pageNumber === pageNumber &&
            activeDoc.selectedShape?.index === idx
              ? 'shadow-[0_0_12px_rgba(0,210,255,0.35)] ring-1 ring-[#00d2ff]/40'
              : ''}"
            style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              class="w-full h-full"
            >
              <ellipse
                cx="50"
                cy="50"
                rx="48"
                ry="48"
                stroke={shape.color || "#000000"}
                stroke-width={shape.type === "oval" ? "4" : "0"}
                fill={shape.type === "oval-fill" ? shape.color || "#000000" : "none"}
              />
            </svg>
            {#if activeDoc.activeTool === "select" && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "tl")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -top-1.5 -left-1.5 cursor-nwse-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "tr")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -top-1.5 -right-1.5 cursor-nesw-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "bl")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -bottom-1.5 -left-1.5 cursor-nesw-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "br")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -bottom-1.5 -right-1.5 cursor-nwse-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
            {/if}
          </div>
        {:else}
          <div
            onmousedown={(e) => initShapeMove(e, idx)}
            class="absolute border-2 cursor-move z-20 transition-all duration-100
              {shape.type.includes('round') ? 'rounded-lg' : 'rounded-none'}
              {activeDoc.selectedShape?.pageNumber === pageNumber &&
            activeDoc.selectedShape?.index === idx
              ? 'shadow-[0_0_12px_rgba(0,210,255,0.35)] ring-1 ring-[#00d2ff]/40'
              : ''}"
            style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%; 
                   border-color: {shape.color || '#000000'}; 
                   background-color: {shape.type.includes('-fill')
              ? shape.color || '#000000'
              : 'transparent'};"
          >
            {#if activeDoc.activeTool === "select" && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "tl")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -top-1.5 -left-1.5 cursor-nwse-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "tr")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -top-1.5 -right-1.5 cursor-nesw-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "bl")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -bottom-1.5 -left-1.5 cursor-nesw-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
              <div
                onmousedown={(e) => initHandleDrag(e, idx, "br")}
                class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 -bottom-1.5 -right-1.5 cursor-nwse-resize rounded-full shadow-md"
                style="border-color: {shape.color || '#000000'};"
              ></div>
            {/if}
          </div>
        {/if}
      {:else if shape.type === "text"}
        <div
          class="absolute text-slate-900 pointer-events-auto transform -translate-y-1/2 z-40"
          style="left: {shape.x}%; top: {shape.y}%;"
        >
          {#if activelyEditingIndex === idx}
            <input
              type="text"
              bind:value={activeDoc.shapes[pageNumber][idx].text}
              use:autofocusAction
              onblur={(e) => finalizeTextEdit(idx, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === "Enter") finalizeTextEdit(idx, e.currentTarget);
              }}
              class="bg-white/95 text-slate-900 border border-[#00d2ff] outline-none px-1.5 py-0.5 rounded shadow-xl max-w-[280px]"
              style="font-size: calc({shape.size || 12}px * {zoomScale / 100}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
            />
          {:else}
            <span
              onmousedown={(e) => initShapeMove(e, idx)}
              ondblclick={(e) => {
                e.stopPropagation();
                activelyEditingIndex = idx;
              }}
              class="block bg-transparent border border-dashed rounded-xs whitespace-nowrap transition-colors text-slate-950 cursor-move p-0.5 {activeDoc
                .selectedShape?.pageNumber === pageNumber &&
              activeDoc.selectedShape?.index === idx
                ? 'border-[#00d2ff] bg-cyan-500/5'
                : 'border-transparent hover:border-slate-400/30'}"
              style="font-size: calc({shape.size || 12}px * {zoomScale / 100}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
              >{shape.text || " "}</span
            >
          {/if}
        </div>
      {:else if shape.type === "tick"}
        <div
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm transition-all cursor-move"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%; border-color: {activeDoc
            .selectedShape?.pageNumber === pageNumber &&
          activeDoc.selectedShape?.index === idx
            ? '#00d2ff'
            : 'transparent'}; background-color: {activeDoc.selectedShape
            ?.pageNumber === pageNumber &&
          activeDoc.selectedShape?.index === idx
            ? '#00d2ff1a'
            : 'transparent'};"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            class="w-full h-full"
            stroke={shape.color || "#000000"}
            stroke-width="4.5"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
          >
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tr")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "bl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "br")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full"
            ></div>
          {/if}
        </div>
      {:else if shape.type === "dash"}
        <div
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm transition-all cursor-move"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%; border-color: {activeDoc
            .selectedShape?.pageNumber === pageNumber &&
          activeDoc.selectedShape?.index === idx
            ? '#00d2ff'
            : 'transparent'}; background-color: {activeDoc.selectedShape
            ?.pageNumber === pageNumber &&
          activeDoc.selectedShape?.index === idx
            ? '#00d2ff1a'
            : 'transparent'};"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            class="w-full h-full"
            stroke={shape.color || "#000000"}
            stroke-width="5"
            stroke-linecap="round"
            stroke-linejoin="round"
            preserveAspectRatio="none"
            ><line x1="2" y1="12" x2="22" y2="12" /></svg
          >
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tr")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "bl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "br")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full"
            ></div>
          {/if}
        </div>
      {:else if shape.type === "signature" || shape.type === "initial"}
        <div
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center border rounded-sm transition-all cursor-move p-0.5 overflow-hidden mix-blend-multiply bg-transparent {activeDoc
            .selectedShape?.pageNumber === pageNumber &&
          activeDoc.selectedShape?.index === idx
            ? 'border-[#00d2ff] shadow-[0_0_12px_rgba(0,210,255,0.35)]'
            : 'border-transparent hover:border-slate-400/30'}"
          style="left: {shape.x}%; top: {shape.y}%; width: {shape.width}%; height: {shape.height}%;"
        >
          <img
            src={shape.dataUrl}
            alt="Sign"
            class="w-full h-full object-contain pointer-events-none"
          />
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx}
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -left-1 cursor-nwse-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "tr")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -top-1 -right-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "bl")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -left-1 cursor-nesw-resize rounded-full"
            ></div>
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "br")}
              class="resize-handle-node absolute w-2 h-2 bg-white border border-[#00d2ff] -bottom-1 -right-1 cursor-nwse-resize rounded-full"
            ></div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if isMouseOverPage && activeDoc.activeTool && !isDrawing}
      {#if ["signature", "initial"].includes(activeDoc.activeTool) && activeDoc.activeStampDataUrl}
        <div
          class="absolute pointer-events-none opacity-45 mix-blend-multiply transform -translate-x-1/2 -translate-y-1/2 border border-dashed border-[#00d2ff] bg-cyan-500/5 flex items-center justify-center p-0.5 rounded-xs"
          style="left: {hoverPctX}%; top: {hoverPctY}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
        >
          <img
            src={activeDoc.activeStampDataUrl}
            alt="Ghost"
            class="w-full h-full object-contain"
          />
        </div>
      {:else if activeDoc.activeTool === "tick"}
        <div
          class="absolute pointer-events-none opacity-45 transform -translate-x-1/2 -translate-y-1/2 border border-dashed border-[#00d2ff] bg-[#00d2ff1a] flex items-center justify-center p-0.5 rounded-sm"
          style="left: {hoverPctX}%; top: {hoverPctY}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            class="w-full h-full"
            stroke={activeDoc.activeColor || "#000000"}
            stroke-width="4.5"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
          >
        </div>
      {:else if activeDoc.activeTool === "dash"}
        <div
          class="absolute pointer-events-none opacity-45 transform -translate-x-1/2 -translate-y-1/2 border border-dashed border-[#00d2ff] bg-[#00d2ff1a] flex items-center justify-center p-0.5 rounded-sm"
          style="left: {hoverPctX}%; top: {hoverPctY}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            class="w-full h-full"
            stroke={activeDoc.activeColor || "#000000"}
            stroke-width="5"
            stroke-linecap="round"
            stroke-linejoin="round"
            preserveAspectRatio="none"
            ><line x1="2" y1="12" x2="22" y2="12" /></svg
          >
        </div>
      {/if}
    {/if}

    {#if isDrawing && activeDoc.activeTool && shapeTypesList.includes(activeDoc.activeTool)}
      {#if activeDoc.activeTool === "oval" || activeDoc.activeTool === "oval-fill"}
        <div
          class="absolute"
          style="left: {Math.min(startX, currentX)}px; top: {Math.min(
            startY,
            currentY,
          )}px; 
                 width: {Math.abs(currentX - startX)}px; height: {Math.abs(
            currentY - startY,
          )}px;"
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            class="w-full h-full"
          >
            <ellipse
              cx="50"
              cy="50"
              rx="48"
              ry="48"
              stroke={activeDoc.activeColor}
              stroke-width={activeDoc.activeTool === "oval" ? "4" : "0"}
              stroke-dasharray={activeDoc.activeTool === "oval" ? "6,4" : "none"}
              fill={activeDoc.activeTool === "oval-fill" ? activeDoc.activeColor : activeDoc.activeColor + '12'}
            />
          </svg>
        </div>
      {:else}
        <div
          class="absolute border-2 border-dashed"
          style="left: {Math.min(startX, currentX)}px; top: {Math.min(
            startY,
            currentY,
          )}px; 
                 width: {Math.abs(currentX - startX)}px; height: {Math.abs(
            currentY - startY,
          )}px;
                 border-color: {activeDoc.activeColor};
                 border-radius: {activeDoc.activeTool?.includes('round') ? '8px' : '0px'};
                 background-color: {activeDoc.activeTool?.includes('-fill')
            ? activeDoc.activeColor
            : activeDoc.activeColor + '12'};"
        ></div>
      {/if}
    {/if}
  </div>
</div>
