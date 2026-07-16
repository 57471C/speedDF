<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import { onMount } from "svelte";
  import { activeDoc, type AnnotationShape, pushHistorySnapshot, FONT_MAP, updateBookmarkNameAction, deleteBookmarkAction, addOrToggleBookmarkAction } from "../pdfStore.svelte";

  let { bytes, pageNumber, zoomScale, isSystemPrinting = false, scrollObserver } = $props<{
    bytes: Uint8Array;
    pageNumber: number;
    zoomScale: number;
    isSystemPrinting?: boolean;
    scrollObserver: IntersectionObserver | null;
  }>();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let pageContainer = $state<HTMLDivElement | null>(null);
  let textLayerElement = $state<HTMLDivElement | null>(null);
  let activeTextLayer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
  let rendering = false;

  const strokeDasharrays = {
    solid: "none",
    dashed: "6,6",
    dotted: "2,4",
    "dash-dot": "6,3,2,3"
  };

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
    const scale = Math.max(0.1, zoomScale / 100);
    const rotationAngle = activeDoc.fileType === "image"
      ? (activeDoc.imageRotation ?? 0)
      : (activeDoc.rotations[pageNumber] ?? 0);
    const totalRotation = rotationAngle % 360;
    
    // If rotated by 90 or 270 degrees, swap width and height
    const isStandardPortrait = (totalRotation / 90) % 2 === 0;
    const w = isStandardPortrait ? basePageWidth : basePageHeight;
    const h = isStandardPortrait ? basePageHeight : basePageWidth;
    
    return {
      width: w * scale,
      height: h * scale,
      aspectRatio: Math.max(0.1, w / Math.max(0.1, Math.abs(h)))
    };
  });

  const rotation = $derived(activeDoc.fileType === 'image' ? (activeDoc.imageRotation || 0) : 0);
  const isRotated90 = $derived(rotation === 90 || rotation === 270);
  const currentWidth = $derived(isRotated90 ? basePageHeight : basePageWidth);
  const currentHeight = $derived(isRotated90 ? basePageWidth : basePageHeight);
  const scaleFactor = $derived(zoomScale / 100);

  // Load page dimensions initially to get aspect ratio
  $effect(() => {
    if (bytes && pageNumber && !loadedDimensions) {
      if (activeDoc.fileType === "image") {
        if (activeDoc.imageUrl) {
          const img = new Image();
          img.onload = () => {
            basePageWidth = img.naturalWidth || img.width;
            basePageHeight = img.naturalHeight || img.height;
            loadedDimensions = true;
          };
          img.src = activeDoc.imageUrl;
        }
        return;
      }
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
    if (activeDoc.fileType === "image") {
      const rotation = activeDoc.imageRotation ?? 0;
      if (activeDoc.imageUrl) {
        const img = new Image();
        img.onload = () => {
          const isRotated90 = rotation === 90 || rotation === 270;
          const currentWidth = isRotated90 ? basePageHeight : basePageWidth;
          const currentHeight = isRotated90 ? basePageWidth : basePageHeight;
          const scaleFactor = zoomScale / 100;

          node.width = currentWidth * scaleFactor;
          node.height = currentHeight * scaleFactor;

          const ctx = node.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, node.width, node.height);
            ctx.save();
            
            // Translate to center of scaled canvas bounding area
            ctx.translate(node.width / 2, node.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            
            // Scale the drawing context once to fit the base dimensions neatly
            ctx.scale(scaleFactor, scaleFactor);
            ctx.drawImage(img, -basePageWidth / 2, -basePageHeight / 2, basePageWidth, basePageHeight);
            ctx.restore();
          }
        };
        img.src = activeDoc.imageUrl;
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

  // Non-reactive caching layer for shape dragging/drawing coordinates
  let dragActive = false;
  let rawStartX = 0;
  let rawStartY = 0;
  let rawCurrentX = 0;
  let rawCurrentY = 0;
  let rawLiveHighlightPoints: { x: number; y: number }[] = [];
  let rawResizedShapeCoords = { x: 0, y: 0, width: 0, height: 0 };
  let animationFrameId: number | null = null;
  let dragPageRect: DOMRect | null = null;
  // Multi-select group drag cache
  let rawGroupInitialPositions: { index: number; x: number; y: number }[] = [];
  let groupDragElements: HTMLElement[] = [];

  // Lifecycle protection for animation frames in Svelte 5
  $effect(() => {
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };
  });

  // Local shadow cache variables to isolate toolbar modification actions
  let lastToolbarColor = activeDoc.activeColor;
  let lastToolbarThickness = activeDoc.activeThickness;

  $effect(() => {
    const currentColor = activeDoc.activeColor;
    const currentThickness = activeDoc.activeThickness;

    // Execute updates ONLY if a tool value has explicitly changed in the toolbar
    if (currentColor !== lastToolbarColor || currentThickness !== lastToolbarThickness) {
      if (activeDoc.selectedShape && activeDoc.selectedShape.pageNumber === pageNumber) {
        const index = activeDoc.selectedShape.index;
        const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
        const shape = shapesList[index];

        if (shape) {
          let isUpdated = false;

          // Update color if supported by the shape type and it changed
          if (currentColor !== lastToolbarColor) {
            if (shape.type === "text") {
              shape.color = currentColor;
              shape.textColor = currentColor;
              isUpdated = true;
            } else if ('color' in shape || shape.type === "tick" || shape.type === "dash" || shape.type === "pen" || shape.type.includes("rect") || shape.type.includes("oval")) {
              shape.color = currentColor;
              isUpdated = true;
            }
          }

          // Update line thickness if supported by the shape type and it changed
          if (currentThickness !== lastToolbarThickness && 'thickness' in shape) {
            shape.thickness = currentThickness;
            isUpdated = true;
          }

          // Commit changes to the global Svelte store proxy array if modified
          if (isUpdated) {
            activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
          }
        }
      }
    }

    // Synchronize caches to track the next interaction loop
    lastToolbarColor = currentColor;
    lastToolbarThickness = currentThickness;
  });

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
    const degrees = activeDoc.fileType === "image"
      ? (activeDoc.imageRotation ?? 0)
      : (activeDoc.rotations[pageNumber] ?? 0);
    // Read textLayerElement here so the effect re-runs once the overlay mounts
    const textLayer = textLayerElement;
    if (isRendered && bytes && canvasElement && zoomScale) {
      renderPageSheet(bytes, pageNumber, zoomScale, canvasElement, degrees, textLayer);
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
      if (activeTextLayer) {
        try {
          activeTextLayer.cancel();
        } catch (e) {}
        activeTextLayer = null;
      }
      if (textLayerElement) {
        textLayerElement.replaceChildren();
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
    textLayerContainer: HTMLDivElement | null = null,
  ) {
    if (activeDoc.fileType === "image") {
      const rotation = activeDoc.imageRotation ?? 0;

      if (activeTextLayer) {
        try {
          activeTextLayer.cancel();
        } catch (e) {}
          activeTextLayer = null;
      }
      if (textLayerContainer) {
        textLayerContainer.replaceChildren();
      }

      if (activeDoc.imageUrl) {
        const img = new Image();
        img.onload = () => {
          const rotation = activeDoc.imageRotation || 0;
          const isRotated90 = rotation === 90 || rotation === 270;
          const currentWidth = isRotated90 ? basePageHeight : basePageWidth;
          const currentHeight = isRotated90 ? basePageWidth : basePageHeight;
          const scaleFactor = zoomScale / 100;

          canvas.width = currentWidth * scaleFactor;
          canvas.height = currentHeight * scaleFactor;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            
            // Translate to center of scaled canvas bounding area
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            
            // Scale the drawing context once to fit the base dimensions neatly
            ctx.scale(scaleFactor, scaleFactor);
            ctx.drawImage(img, -basePageWidth / 2, -basePageHeight / 2, basePageWidth, basePageHeight);
            ctx.restore();
          }
        };
        img.src = activeDoc.imageUrl;
      }
      return;
    }
    if (activeDoc.fileType === "tiff") {
      const pageData = activeDoc.tiffPages[pageNum - 1];
      const rotation = activeDoc.rotations[pageNum] ?? 0;

      // TIFF pages have no PDF text content — clear any leftover text layer
      if (activeTextLayer) {
        try {
          activeTextLayer.cancel();
        } catch (e) {}
        activeTextLayer = null;
      }
      if (textLayerContainer) {
        textLayerContainer.replaceChildren();
      }
      
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
      if (activeTextLayer) {
        try {
          activeTextLayer.cancel();
        } catch (e) {}
        activeTextLayer = null;
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
      const safeScale = Math.max(0.1, scale / 100);
      const rotation = (page.rotate + rotationAngle) % 360;
      const adjustedViewport = page.getViewport({
        scale: safeScale * dpr,
        rotation,
      });
      // CSS-pixel viewport for the text layer (matches on-screen canvas size)
      const textViewport = page.getViewport({
        scale: safeScale,
        rotation,
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

      // Superimpose a selectable PDF.js text layer over the rendered canvas
      if (textLayerContainer) {
        if (activeTextLayer) {
          try {
            activeTextLayer.cancel();
          } catch (e) {}
          activeTextLayer = null;
        }
        // Always clear prior text runs before re-rendering (zoom / page change)
        textLayerContainer.replaceChildren();
        textLayerContainer.style.setProperty("--total-scale-factor", String(safeScale));
        textLayerContainer.style.setProperty("--scale-round-x", "1px");
        textLayerContainer.style.setProperty("--scale-round-y", "1px");

        const textContent = await page.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport: textViewport,
        });
        activeTextLayer = textLayer;
        await textLayer.render();
      }
    } catch (error) {
      console.error(error);
    } finally {
      rendering = false;
      activeRenderTask = null;
    }
  }

  function normalizeCoordinates(rawX: number, rawY: number): { x: number; y: number } {
    if (activeDoc.fileType === 'image') {
      const x_raw = rawX / (zoomScale / 100);
      const y_raw = rawY / (zoomScale / 100);

      let x_local = x_raw;
      let y_local = y_raw;
      const W = basePageWidth; // True Image Width
      const H = basePageHeight; // True Image Height

      const rotation = activeDoc.imageRotation || 0;
      if (rotation === 90) {
        x_local = y_raw;
        y_local = H - x_raw;
      } else if (rotation === 180) {
        x_local = W - x_raw;
        y_local = H - y_raw;
      } else if (rotation === 270) {
        x_local = W - y_raw;
        y_local = x_raw;
      }

      return {
        x: (x_local / Math.max(1, W)) * 100,
        y: (y_local / Math.max(1, H)) * 100,
      };
    }

    if (!pageContainer) return { x: 0, y: 0 };
    const rect = dragPageRect || pageContainer.getBoundingClientRect();
    return {
      x: (rawX / Math.max(1, rect.width)) * 100,
      y: (rawY / Math.max(1, rect.height)) * 100,
    };
  }

  function getDisplayCoords(shape: AnnotationShape): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const x = shape.x;
    const y = shape.y;
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    
    if (activeDoc.fileType !== 'image') {
      return { x, y, width: w, height: h };
    }

    const rotation = activeDoc.imageRotation || 0;
    if (rotation === 90) {
      return {
        x: 100 - (y + h),
        y: x,
        width: h,
        height: w
      };
    } else if (rotation === 180) {
      return {
        x: 100 - (x + w),
        y: 100 - (y + h),
        width: w,
        height: h
      };
    } else if (rotation === 270) {
      return {
        x: y,
        y: 100 - (x + w),
        width: h,
        height: w
      };
    }

    return { x, y, width: w, height: h };
  }

  function getDisplayPoints(points: { x: number; y: number }[] | undefined): { x: number; y: number }[] {
    if (!points) return [];
    if (activeDoc.fileType !== 'image') return points;
    const rotation = activeDoc.imageRotation || 0;
    return points.map(p => {
      if (rotation === 90) {
        return { x: 100 - p.y, y: p.x };
      } else if (rotation === 180) {
        return { x: 100 - p.x, y: 100 - p.y };
      } else if (rotation === 270) {
        return { x: p.y, y: 100 - p.x };
      }
      return p;
    });
  }

  function addShapeToPage(shape: AnnotationShape) {
    const existing = activeDoc.shapes[pageNumber] || [];
    const newIndex = existing.length;
    activeDoc.shapes = {
      ...activeDoc.shapes,
      [pageNumber]: [...existing, shape],
    };
    return newIndex;
  }

  function handleSignatureOrInitial(mousePctX: number, mousePctY: number) {
    const toolType = activeDoc.activeTool as "signature" | "initial";
    const dims = ghostDimensions;
    const newSignatureStamp: AnnotationShape = {
      type: toolType,
      x: mousePctX - dims.w / 2,
      y: mousePctY - dims.h / 2,
      width: dims.w,
      height: dims.h,
      dataUrl: activeDoc.activeStampDataUrl ?? undefined,
    };
    const newIndex = addShapeToPage(newSignatureStamp);
    activeDoc.selectedShape = { pageNumber, index: newIndex };
  }

  function handleTickOrDash(mousePctX: number, mousePctY: number) {
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
    const newIndex = addShapeToPage(newStampShape);
    activeDoc.selectedShape = { pageNumber, index: newIndex };
  }

  function handleTextTool(mousePctX: number, mousePctY: number) {
    const currentShapes = activeDoc.shapes[pageNumber] || [];
    const hasEmptyText = currentShapes.some(
      (s) => s && s.type === "text" && (!s.text || s.text.trim().length === 0)
    );
    if (hasEmptyText) {
      // STEP A: Explicitly isolate and clear active tracking variables first so nothing points to the target index
      activeDoc.selectedShape = null;
      activelyEditingIndex = null;

      // STEP B: Perform the state array cleanup pass only after trackers are safe
      const updated = currentShapes.filter(
        (s) => !(s && s.type === "text" && (!s.text || s.text.trim().length === 0))
      );
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: updated };
    }

    const newTextShape: AnnotationShape = {
      type: "text",
      x: mousePctX,
      y: mousePctY,
      text: "",
      font: activeDoc.defaultFont,
      size: activeDoc.defaultSize,
      style: activeDoc.defaultStyle || "Normal",
      color: activeDoc.activeColor,
      textColor: activeDoc.activeColor,
    };
    const newIndex = addShapeToPage(newTextShape);
    activelyEditingIndex = newIndex;
    activeDoc.selectedShape = { pageNumber, index: newIndex };
  }

  function handleMouseDown(e: MouseEvent) {
    if (!pageContainer) return;
    const targetElement = e.target as HTMLElement;
    if (
      targetElement.closest("input") ||
      targetElement.closest(".resize-handle-node")
    )
      return;

    // Let the browser handle native PDF text selection (no annotation side-effects)
    if (targetElement.closest(".textLayer")) {
      if (activeDoc.activeTool === "select") {
        activeDoc.selectedShape = null;
      }
      return;
    }

    if (activeDoc.activeTool !== "text") {
      pushHistorySnapshot();
    }

    dragPageRect = pageContainer.getBoundingClientRect();
    const rect = dragPageRect;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const { x: mousePctX, y: mousePctY } = normalizeCoordinates(rawX, rawY);

    if (activeDoc.activeTool === "select") {
      activeDoc.selectedShape = null;
      activeDoc.selectedShapes = [];
      return;
    }
    if (activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen") {
      e.preventDefault();
      isDrawing = true;
      liveHighlightPoints = [{ x: mousePctX, y: mousePctY }];

      dragActive = true;
      rawStartX = e.clientX;
      rawStartY = e.clientY;
      rawCurrentX = e.clientX;
      rawCurrentY = e.clientY;
      rawLiveHighlightPoints = [{ x: mousePctX, y: mousePctY }];
      return;
    }

    if (
      (activeDoc.activeTool === "signature" ||
        activeDoc.activeTool === "initial") &&
      activeDoc.activeStampDataUrl
    ) {
      e.preventDefault();
      handleSignatureOrInitial(mousePctX, mousePctY);
      return;
    }

    if (activeDoc.activeTool === "tick" || activeDoc.activeTool === "dash") {
      e.preventDefault();
      handleTickOrDash(mousePctX, mousePctY);
      return;
    }

    if (activeDoc.activeTool === "text") {
      e.preventDefault();
      handleTextTool(mousePctX, mousePctY);
      return;
    }

    if (shapeTypesList.includes(activeDoc.activeTool || "")) {
      isDrawing = true;
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      currentX = startX;
      currentY = startY;

      dragActive = true;
      rawStartX = startX;
      rawStartY = startY;
      rawCurrentX = startX;
      rawCurrentY = startY;
    }
  }

  function initShapeMove(e: MouseEvent, index: number) {
    if (activeDoc.activeTool !== "select" || activelyEditingIndex !== null) return;
    e.stopPropagation();

    const hasModifier = e.ctrlKey || e.metaKey;
    const isAlreadySelected = activeDoc.selectedShapes.some(
      (s) => s.pageNumber === pageNumber && s.index === index
    );

    if (hasModifier) {
      // Toggle membership in the multi-select collection
      const existsIdx = activeDoc.selectedShapes.findIndex(
        (s) => s.pageNumber === pageNumber && s.index === index
      );
      if (existsIdx > -1) {
        activeDoc.selectedShapes.splice(existsIdx, 1);
      } else {
        activeDoc.selectedShapes.push({ pageNumber, index });
      }
      activeDoc.selectedShape = activeDoc.selectedShapes[0] || null;
      return; // Toggling selection should not initiate a drag
    } else {
      if (!isAlreadySelected) {
        activeDoc.selectedShapes = [{ pageNumber, index }];
        activeDoc.selectedShape = { pageNumber, index };
      }
    }

    pushHistorySnapshot();
    if (!pageContainer) return;
    const shape = activeDoc.shapes[pageNumber]?.[index];
    if (shape) {
      isMovingShape = true;
      dragStartMouseX = e.clientX;
      dragStartMouseY = e.clientY;

      if (activeDoc.selectedShapes.length > 1) {
        // Group drag: cache all selected shape positions and their DOM elements
        rawGroupInitialPositions = activeDoc.selectedShapes
          .filter((s) => s.pageNumber === pageNumber)
          .map((s) => {
            const sh = activeDoc.shapes[pageNumber]?.[s.index];
            return { index: s.index, x: sh?.x || 0, y: sh?.y || 0 };
          });
        groupDragElements = rawGroupInitialPositions
          .map((pos) =>
            pageContainer!.querySelector(`[data-shape-idx="${pos.index}"]`) as HTMLElement
          )
          .filter(Boolean);
        dragTargetElement = null;
      } else {
        // Single-shape drag
        rawGroupInitialPositions = [];
        groupDragElements = [];
        dragTargetElement = pageContainer.querySelector(
          `[data-shape-idx="${index}"]`
        ) as HTMLElement;
      }

      dragPageRect = pageContainer.getBoundingClientRect();
      dragActive = true;
      rawStartX = e.clientX;
      rawStartY = e.clientY;
      rawCurrentX = e.clientX;
      rawCurrentY = e.clientY;
    }
  }

  function startTextDrag(e: MouseEvent, index: number) {
    if (activelyEditingIndex !== null) return;
    e.stopPropagation();
    e.preventDefault();

    activeDoc.selectedShape = { pageNumber, index };
    activeDoc.selectedShapes = [{ pageNumber, index }];

    pushHistorySnapshot();

    const shape = activeDoc.shapes[pageNumber]?.[index];
    if (!shape) return;

    const dragStartStartX = e.clientX;
    const dragStartStartY = e.clientY;
    const dragStartInitialX = shape.x;
    const dragStartInitialY = shape.y;

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.stopPropagation();
      moveEvent.preventDefault();
      if (!pageContainer) return;
      const rect = pageContainer.getBoundingClientRect();
      const startNorm = normalizeCoordinates(dragStartStartX - rect.left, dragStartStartY - rect.top);
      const endNorm = normalizeCoordinates(moveEvent.clientX - rect.left, moveEvent.clientY - rect.top);
      const deltaPctX = endNorm.x - startNorm.x;
      const deltaPctY = endNorm.y - startNorm.y;

      shape.x = Math.max(0, Math.min(100, dragStartInitialX + deltaPctX));
      shape.y = Math.max(0, Math.min(100, dragStartInitialY + deltaPctY));
      activeDoc.shapes = { ...activeDoc.shapes };
    };

    const handleWindowMouseUp = (upEvent: MouseEvent) => {
      upEvent.stopPropagation();
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
    };

    window.addEventListener("mousemove", handleWindowMouseMove, true);
    window.addEventListener("mouseup", handleWindowMouseUp, true);
  }

  function redrawCanvas() {
    if (!pageContainer) return;

    // Case 1: Pen / Highlight drawing
    if (isDrawing && (activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")) {
      liveHighlightPoints = [...rawLiveHighlightPoints];
    }
    
    // Case 2: Shape moving
    else if (isMovingShape && activeDoc.selectedShape) {
      const deltaX = rawCurrentX - rawStartX;
      const deltaY = rawCurrentY - rawStartY;
      if (rawGroupInitialPositions.length > 1 && groupDragElements.length > 0) {
        // Group drag: apply uniform displacement to all selected elements
        groupDragElements.forEach((el) => {
          if (el) el.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        });
      } else if (dragTargetElement) {
        dragTargetElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      }
    }
    
    // Case 3: Shape resizing
    else if (draggingHandle && activeDoc.selectedShape && initialShapeState && dragTargetElement) {
      const rect = dragPageRect || pageContainer.getBoundingClientRect();
      const { x: mousePctX, y: mousePctY } = normalizeCoordinates(rawCurrentX - rect.left, rawCurrentY - rect.top);
      const initial = initialShapeState;
      
      let x = initial.x;
      let y = initial.y;
      let width = initial.width;
      let height = initial.height;
      
      if (draggingHandle === "br") {
        width = Math.max(0.1, mousePctX - initial.x);
        height = Math.max(0.1, mousePctY - initial.y);
      } else if (draggingHandle === "tl") {
        const r = initial.x + initial.width;
        const b = initial.y + initial.height;
        x = Math.min(r - 0.1, Math.max(0, mousePctX));
        y = Math.min(b - 0.1, Math.max(0, mousePctY));
        width = r - x;
        height = b - y;
      } else if (draggingHandle === "tr") {
        const b = initial.y + initial.height;
        y = Math.min(b - 0.1, Math.max(0, mousePctY));
        width = Math.max(0.1, mousePctX - initial.x);
        height = b - y;
      } else if (draggingHandle === "bl") {
        const r = initial.x + initial.width;
        x = Math.min(r - 0.1, Math.max(0, mousePctX));
        width = r - x;
        height = Math.max(0.1, mousePctY - initial.y);
      }
      
      rawResizedShapeCoords = { x, y, width, height };
      
      dragTargetElement.style.left = `${x}%`;
      dragTargetElement.style.top = `${y}%`;
      dragTargetElement.style.width = `${width}%`;
      dragTargetElement.style.height = `${height}%`;
    }
    
    // Case 4: Shape drawing
    else if (isDrawing && shapeTypesList.includes(activeDoc.activeTool || "")) {
      const rect = dragPageRect || pageContainer.getBoundingClientRect();
      currentX = rawCurrentX - rect.left;
      currentY = rawCurrentY - rect.top;
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!pageContainer) return;
    const rect = dragPageRect || pageContainer.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const { x: mousePctX, y: mousePctY } = normalizeCoordinates(rawX, rawY);
    hoverPctX = mousePctX;
    hoverPctY = mousePctY;

    if (dragActive) {
      e.preventDefault();
      rawCurrentX = e.clientX;
      rawCurrentY = e.clientY;

      if (isDrawing && (activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")) {
        rawLiveHighlightPoints.push({ x: mousePctX, y: mousePctY });
      }

      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(() => {
          redrawCanvas();
          animationFrameId = null;
        });
      }
      return;
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (isDrawing && (activeDoc.activeTool === "highlight" || activeDoc.activeTool === "pen")) {
      const currentTool = activeDoc.activeTool;
      isDrawing = false;
      dragActive = false;
      dragPageRect = null;
      
      if (liveHighlightPoints.length > 1) {
        const newFreehand: AnnotationShape = {
          type: currentTool as any,
          x: liveHighlightPoints[0].x,
          y: liveHighlightPoints[0].y,
          points: [...liveHighlightPoints],
          color: activeDoc.activeColor,
          thickness: activeDoc.activeThickness
        };
        const existing = activeDoc.shapes[pageNumber] || [];
        activeDoc.shapes = {
          ...activeDoc.shapes,
          [pageNumber]: [...existing, newFreehand],
        };
      }
      liveHighlightPoints = [];
      rawLiveHighlightPoints = [];
      return;
    }

    if (isMovingShape && activeDoc.selectedShape) {
      isMovingShape = false;
      dragActive = false;
      dragPageRect = null;

      const rect = pageContainer ? pageContainer.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
      const startNorm = normalizeCoordinates(dragStartMouseX - rect.left, dragStartMouseY - rect.top);
      const endNorm = normalizeCoordinates(e.clientX - rect.left, e.clientY - rect.top);
      const deltaPctX = endNorm.x - startNorm.x;
      const deltaPctY = endNorm.y - startNorm.y;
      const shapesList = [...(activeDoc.shapes[pageNumber] || [])];

      if (rawGroupInitialPositions.length > 1 && groupDragElements.length > 0) {
        // Batch-write group coordinate updates in a single store commit
        rawGroupInitialPositions.forEach((pos) => {
          const shape = shapesList[pos.index];
          if (shape) {
            shape.x = Math.max(0, Math.min(100, pos.x + deltaPctX));
            shape.y = Math.max(0, Math.min(100, pos.y + deltaPctY));
          }
        });
        groupDragElements.forEach((el) => { if (el) el.style.transform = ""; });
        activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
      } else if (dragTargetElement && pageContainer) {
        dragTargetElement.style.transform = "";
        const index = activeDoc.selectedShape.index;
        const shape = shapesList[index];
        if (shape) {
          shape.x = Math.max(0, Math.min(100, shape.x + deltaPctX));
          shape.y = Math.max(0, Math.min(100, shape.y + deltaPctY));
          activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: shapesList };
        }
      }

      groupDragElements = [];
      rawGroupInitialPositions = [];
      dragTargetElement = null;
      return;
    }

    if (draggingHandle && activeDoc.selectedShape) {
      dragActive = false;
      dragPageRect = null;
      const shapesList = [...(activeDoc.shapes[pageNumber] || [])];
      const index = activeDoc.selectedShape.index;
      const shape = shapesList[index];
      if (shape && initialShapeState) {
        const finalX = rawResizedShapeCoords.width > 0 ? rawResizedShapeCoords.x : initialShapeState.x;
        const finalY = rawResizedShapeCoords.height > 0 ? rawResizedShapeCoords.y : initialShapeState.y;
        const finalW = rawResizedShapeCoords.width > 0 ? rawResizedShapeCoords.width : initialShapeState.width;
        const finalH = rawResizedShapeCoords.height > 0 ? rawResizedShapeCoords.height : initialShapeState.height;
        
        shape.x = finalX;
        shape.y = finalY;
        shape.width = finalW;
        shape.height = finalH;

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
      }
      draggingHandle = null;
      initialShapeState = null;
      dragTargetElement = null;
      rawResizedShapeCoords = { x: 0, y: 0, width: 0, height: 0 };
      return;
    }

    if (
      !isDrawing ||
      !pageContainer ||
      !shapeTypesList.includes(activeDoc.activeTool || "")
    ) {
      dragActive = false;
      dragPageRect = null;
      return;
    }
    
    isDrawing = false;
    dragActive = false;
    dragPageRect = null;

    const rect = pageContainer.getBoundingClientRect();
    const finalCurrentX = rawCurrentX - rect.left;
    const finalCurrentY = rawCurrentY - rect.top;
    const widthPixels = Math.abs(finalCurrentX - startX);
    const heightPixels = Math.abs(finalCurrentY - startY);

    if (widthPixels > 2 && heightPixels > 2) {
      const startNorm = normalizeCoordinates(startX, startY);
      const endNorm = normalizeCoordinates(finalCurrentX, finalCurrentY);
      const newShape: AnnotationShape = {
        type: activeDoc.activeTool as any,
        x: Math.min(startNorm.x, endNorm.x),
        y: Math.min(startNorm.y, endNorm.y),
        width: Math.abs(endNorm.x - startNorm.x),
        height: Math.abs(endNorm.y - startNorm.y),
        color: activeDoc.activeColor,
        thickness: activeDoc.activeThickness,
        lineStyle: activeDoc.activeLineStyle,
      };
      const existing = activeDoc.shapes[pageNumber] || [];
      activeDoc.shapes = {
        ...activeDoc.shapes,
        [pageNumber]: [...existing, newShape],
      };
    }
  }

  function initHandleDrag(e: MouseEvent, index: number, handleType: string) {
    if (!pageContainer) return;
    e.stopPropagation();
    e.preventDefault();
    draggingHandle = handleType;
    const shape = activeDoc.shapes[pageNumber]?.[index];
    if (shape) {
      initialShapeState = {
        x: shape.x,
        y: shape.y,
        width: shape.width || 0,
        height: shape.height || 0,
      };
      dragTargetElement = e.currentTarget ? (e.currentTarget as HTMLElement).parentElement : null;

      dragPageRect = pageContainer.getBoundingClientRect();
      dragActive = true;
      rawStartX = e.clientX;
      rawStartY = e.clientY;
      rawCurrentX = e.clientX;
      rawCurrentY = e.clientY;
      rawResizedShapeCoords = { x: shape.x, y: shape.y, width: shape.width || 0, height: shape.height || 0 };
    }
  }

  function handleMouseLeave() {
    isMouseOverPage = false;
    dragPageRect = null;
    if (isDrawing) {
      isDrawing = false;
      dragActive = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }
  }
  function finalizeTextEdit(index: number, element: HTMLInputElement) {
    if (!element.isConnected || (activelyEditingIndex !== null && activelyEditingIndex !== index)) return;
    const existing = activeDoc.shapes[pageNumber] || [];
    if (existing[index]) {
      const textInputString = element.value;
      if (textInputString.trim().length === 0) {
        // STEP A: Explicitly isolate and clear active tracking variables first so nothing points to the target index
        activeDoc.selectedShape = null;
        activelyEditingIndex = null;

        // STEP B: Perform the state array cleanup pass only after trackers are safe
        const updated = existing.filter((_, idx) => idx !== index);
        activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: updated };
      } else {
        existing[index].text = textInputString.trim();
        activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: [...existing] };
        activelyEditingIndex = null;
        pushHistorySnapshot();
      }
    } else {
      activelyEditingIndex = null;
    }
  }

  onMount(() => {
    if (!pageContainer) return;
    const trueScrollViewport = pageContainer.parentElement?.parentElement;
    function handleDeletionShortcuts(event: KeyboardEvent): boolean {
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        activeDoc.selectedShape
      ) {
        if (document.activeElement?.tagName === "INPUT") return true;
        pushHistorySnapshot();
        const { pageNumber: targetPage, index: targetIdx } =
          activeDoc.selectedShape;
        const existingList = [...(activeDoc.shapes[targetPage] || [])];
        if (existingList[targetIdx]) {
          activeDoc.selectedShape = null;
          existingList.splice(targetIdx, 1);
          activeDoc.shapes = {
            ...activeDoc.shapes,
            [targetPage]: existingList,
          };
        }
        return true;
      }
      return false;
    }

    function handlePageNavigationShortcuts(event: KeyboardEvent): boolean {
      return false;
    }

    function handleViewZoomShortcuts(event: KeyboardEvent): boolean {
      return false;
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (handleDeletionShortcuts(event)) return;
      if (handlePageNavigationShortcuts(event)) return;
      if (handleViewZoomShortcuts(event)) return;
    }
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
    preloadObserver.observe(pageContainer);
    paintObserver.observe(pageContainer);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      preloadObserver.disconnect();
      paintObserver.disconnect();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };
  });

  $effect(() => {
    // Self-register to the centralized parent scroll loop upon painting
    if (pageContainer && scrollObserver) {
      scrollObserver.observe(pageContainer);
    }
    return () => {
      if (pageContainer && scrollObserver) {
        scrollObserver.unobserve(pageContainer);
      }
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
  data-page-number={pageNumber}
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseenter={() => (isMouseOverPage = true)}
  onmouseleave={handleMouseLeave}
  class="bg-white relative rounded-sm mb-12 select-none"
  style="box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.65);
         {activeDoc.fileType === 'image'
           ? `width: ${currentWidth * scaleFactor}px; height: ${currentHeight * scaleFactor}px;`
           : `width: ${expectedDimensions.width}px; min-height: ${expectedDimensions.height}px; aspect-ratio: ${expectedDimensions.aspectRatio};`}"
>
  {#if isRendered}
    <canvas use:canvasLifecycle class="block max-w-full h-auto rounded-sm"
    ></canvas>
    <!-- PDF.js text layer: sits above canvas; spans capture selection, empty areas pass through -->
    <div
      bind:this={textLayerElement}
      class="textLayer absolute inset-0 overflow-hidden rounded-sm z-[35]"
      class:textLayer--interactive={activeDoc.activeTool === "select"}
      aria-hidden="true"
    ></div>
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
      : 'pointer-events-none'} {[...shapeTypesList, 'highlight', 'pen'].includes(
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
        {#if shape && shape.type === "highlight" && shape.points}
          <polyline
            onclick={(e) => {
              e.stopPropagation();
              if (activeDoc.activeTool === "select")
                activeDoc.selectedShape = { pageNumber, index: idx };
            }}
            points={getDisplayPoints(shape.points).map((p) => `${p.x},${p.y}`).join(" ")}
            stroke={shape.color || "#fff200"}
            stroke-opacity={shape.color && shape.color.length === 9 ? undefined : "0.42"}
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cursor-pointer pointer-events-auto hover:stroke-yellow-300 transition-colors {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'stroke-yellow-300 stroke-opacity-60' : ''}"
          />
        {:else}
          {#if shape && shape.type === "pen" && shape.points}
            <polyline
              onclick={(e) => {
                e.stopPropagation();
                if (activeDoc.activeTool === "select")
                  activeDoc.selectedShape = { pageNumber, index: idx };
              }}
              points={getDisplayPoints(shape.points).map((p) => `${p.x},${p.y}`).join(" ")}
              stroke={shape.color || "#ef4444"}
              stroke-width={(shape.thickness || 3) * 0.22}
              stroke-opacity="1"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="cursor-pointer pointer-events-auto hover:stroke-cyan-400 transition-colors {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'stroke-cyan-400' : ''}"
            />
          {/if}
        {/if}
      {/each}
      {#if liveHighlightPoints.length > 1}
        {#if activeDoc.activeTool === "highlight"}
          <polyline
            points={getDisplayPoints(liveHighlightPoints).map((p) => `${p.x},${p.y}`).join(" ")}
            stroke={activeDoc.activeColor || "#fff200"}
            stroke-width="2.0"
            stroke-opacity={activeDoc.activeColor && activeDoc.activeColor.length === 9 ? undefined : "0.48"}
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {:else if activeDoc.activeTool === "pen"}
          <polyline
            points={getDisplayPoints(liveHighlightPoints).map((p) => `${p.x},${p.y}`).join(" ")}
            stroke={activeDoc.activeColor}
            stroke-width={(activeDoc.activeThickness || 3) * 0.22}
            stroke-opacity="1"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {/if}
      {/if}
    </svg>

    {#each activeDoc.shapes[pageNumber] || [] as shape, idx}
      {@const display = getDisplayCoords(shape)}
      {#if shape && shapeTypesList.includes(shape.type)}
        {#if shape.type === "oval" || shape.type === "oval-fill"}
          <div
            data-shape-idx={idx}
            onmousedown={(e) => initShapeMove(e, idx)}
            class="absolute cursor-move z-20 transition-shadow duration-100
              {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
              ? 'shadow-[0_0_12px_rgba(0,210,255,0.35)] ring-1 ring-[#00d2ff]/40'
              : ''}"
            style="left: {display.x}%; top: {display.y}%; width: {display.width}%; height: {display.height}%; overflow: visible;"
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              class="w-full h-full overflow-visible pointer-events-none"
            >
              <ellipse
                cx="50"
                cy="50"
                rx="47"
                ry="47"
                stroke={shape.color || "#000000"}
                stroke-width={shape.type === "oval" ? (shape.thickness || 3) : "0"}
                stroke-dasharray={shape.type === "oval" && shape.lineStyle ? strokeDasharrays[shape.lineStyle] : "none"}
                vector-effect="non-scaling-stroke"
                fill={shape.type === "oval-fill" ? shape.color || "#000000" : "none"}
              />
            </svg>
            {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
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
            data-shape-idx={idx}
            onmousedown={(e) => initShapeMove(e, idx)}
            class="absolute cursor-move z-20 transition-shadow duration-100
              {shape.type.includes('round') ? 'rounded-lg' : 'rounded-none'}
              {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
              ? 'shadow-[0_0_12px_rgba(0,210,255,0.35)] ring-1 ring-[#00d2ff]/40'
              : ''}"
            style="left: {display.x}%; top: {display.y}%; width: {display.width}%; height: {display.height}%; overflow: visible;"
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              class="w-full h-full overflow-visible pointer-events-none absolute inset-0"
            >
              <rect
                x="1.5"
                y="1.5"
                width="97"
                height="97"
                rx={shape.type.includes('round') ? 8 : 0}
                ry={shape.type.includes('round') ? 8 : 0}
                stroke={shape.type.includes('-fill') ? 'none' : (shape.color || "#000000")}
                stroke-width={shape.type.includes('-fill') ? 0 : (shape.thickness || 3)}
                stroke-dasharray={!shape.type.includes('-fill') && shape.lineStyle ? strokeDasharrays[shape.lineStyle] : "none"}
                vector-effect="non-scaling-stroke"
                fill={shape.type.includes('-fill') ? shape.color || "#000000" : "none"}
              />
            </svg>
            {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
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
      {:else if shape && shape.type === "text"}
        <div
          data-shape-idx={idx}
          class="absolute pointer-events-auto transform -translate-y-1/2 z-40"
          style="left: {display.x}%; top: {display.y}%; color: {shape.textColor || shape.color || '#000000'};"
        >
          {#if activelyEditingIndex === idx && activeDoc.shapes[pageNumber]?.[idx]}
            <input
              type="text"
              bind:value={activeDoc.shapes[pageNumber][idx].text}
              use:autofocusAction
              onmousedown={(e) => e.stopPropagation()}
              onblur={(e) => finalizeTextEdit(idx, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === "Enter") finalizeTextEdit(idx, e.currentTarget);
              }}
              class="bg-white/95 border border-[#00d2ff] outline-none px-1.5 py-0.5 rounded shadow-xl max-w-[280px]"
              style="color: {shape.textColor || shape.color || '#000000'}; font-size: calc({shape.size || 12}px * {Math.max(0.1, Math.abs(zoomScale / 100))}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
            />
          {:else}
            <span
              onmousedown={(e) => startTextDrag(e, idx)}
              ondblclick={(e) => {
                e.stopPropagation();
                activelyEditingIndex = idx;
              }}
              class="block bg-transparent border border-dashed rounded-xs whitespace-nowrap transition-colors cursor-move p-0.5 {activeDoc
                .selectedShape?.pageNumber === pageNumber &&
              activeDoc.selectedShape?.index === idx
                ? 'border-[#00d2ff] bg-cyan-500/5'
                : 'border-transparent hover:border-slate-400/30'}"
              style="color: {shape.textColor || shape.color || '#000000'}; font-size: calc({shape.size || 12}px * {Math.max(0.1, Math.abs(zoomScale / 100))}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
              >{shape?.text || " "}</span
            >
          {/if}
        </div>
      {:else if shape && shape.type === "tick"}
        <div
          data-shape-idx={idx}
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm cursor-move transition-[border-color,background-color] duration-100"
          style="left: {display.x}%; top: {display.y}%; width: {display.width}%; height: {display.height}%; border-color: {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
            ? '#00d2ff'
            : 'transparent'}; background-color: {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
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
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
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
      {:else if shape && shape.type === "dash"}
        <div
          data-shape-idx={idx}
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center p-0.5 border rounded-sm cursor-move transition-[border-color,background-color] duration-100"
          style="left: {display.x}%; top: {display.y}%; width: {display.width}%; height: {display.height}%; border-color: {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
            ? '#00d2ff'
            : 'transparent'}; background-color: {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
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
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
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
      {:else if shape && (shape.type === "signature" || shape.type === "initial")}
        <div
          data-shape-idx={idx}
          onmousedown={(e) => initShapeMove(e, idx)}
          class="absolute pointer-events-auto z-40 flex items-center justify-center border rounded-sm cursor-move p-0.5 overflow-hidden mix-blend-multiply bg-transparent transition-[border-color,box-shadow] duration-100 {activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)
            ? 'border-[#00d2ff] shadow-[0_0_12px_rgba(0,210,255,0.35)]'
            : 'border-transparent hover:border-slate-400/30'}"
          style="left: {display.x}%; top: {display.y}%; width: {display.width}%; height: {display.height}%;"
        >
          <img
            src={shape.dataUrl}
            alt="Sign"
            class="w-full h-full object-contain pointer-events-none"
          />
          {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
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
      {@const displayCursor = getDisplayCoords({ x: hoverPctX, y: hoverPctY, width: 0, height: 0 } as any)}
      {#if ["signature", "initial"].includes(activeDoc.activeTool) && activeDoc.activeStampDataUrl}
        <div
          class="absolute pointer-events-none opacity-45 mix-blend-multiply transform -translate-x-1/2 -translate-y-1/2 border border-dashed border-[#00d2ff] bg-cyan-500/5 flex items-center justify-center p-0.5 rounded-xs"
          style="left: {displayCursor.x}%; top: {displayCursor.y}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
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
          style="left: {displayCursor.x}%; top: {displayCursor.y}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
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
          style="left: {displayCursor.x}%; top: {displayCursor.y}%; width: {ghostDimensions.w}%; height: {ghostDimensions.h}%;"
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
            class="w-full h-full overflow-visible"
          >
            <ellipse
              cx="50"
              cy="50"
              rx="47"
              ry="47"
              stroke={activeDoc.activeColor}
              stroke-width={activeDoc.activeTool === "oval" ? (activeDoc.activeThickness || 3) : "0"}
              stroke-dasharray={activeDoc.activeTool === "oval" && activeDoc.activeLineStyle ? strokeDasharrays[activeDoc.activeLineStyle] : "none"}
              vector-effect="non-scaling-stroke"
              fill={activeDoc.activeTool === "oval-fill" ? activeDoc.activeColor : activeDoc.activeColor + '12'}
            />
          </svg>
        </div>
      {:else}
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
            class="w-full h-full overflow-visible pointer-events-none absolute inset-0"
          >
            <rect
              x="1.5"
              y="1.5"
              width="97"
              height="97"
              rx={activeDoc.activeTool?.includes('round') ? 8 : 0}
              ry={activeDoc.activeTool?.includes('round') ? 8 : 0}
              stroke={activeDoc.activeTool?.includes('-fill') ? 'none' : activeDoc.activeColor}
              stroke-width={activeDoc.activeTool?.includes('-fill') ? 0 : (activeDoc.activeThickness || 3)}
              stroke-dasharray={!activeDoc.activeTool?.includes('-fill') && activeDoc.activeLineStyle ? strokeDasharrays[activeDoc.activeLineStyle] : "none"}
              vector-effect="non-scaling-stroke"
              fill={activeDoc.activeTool?.includes('-fill') ? activeDoc.activeColor : activeDoc.activeColor + '12'}
            />
          </svg>
        </div>
      {/if}
    {/if}
  </div>

  <div class="absolute top-2 left-[calc(100%+8px)] z-30 group">
    {#if activeDoc.bookmarks.some(b => b.pageNum === pageNumber)}
      {@const match = activeDoc.bookmarks.find(b => b.pageNum === pageNumber)!}
      {#snippet flagUI()}
        {@const s = (() => {
          let isHovered = $state(false);
          let isEditing = $state(false);
          let tempName = $state(match.name);
          return {
            get isHovered() { return isHovered },
            set isHovered(v) { isHovered = v },
            get isEditing() { return isEditing },
            set isEditing(v) { isEditing = v },
            get tempName() { return tempName },
            set tempName(v) { tempName = v }
          };
        })()}

        <div 
          onmouseenter={() => s.isHovered = true}
          onmouseleave={() => s.isHovered = false}
          class="flex items-start bg-transparent select-none">
          
          <button 
            onclick={() => activeDoc.currentPage = pageNumber}
            class="text-cyan-400 hover:text-cyan-300 drop-shadow-lg transition-transform active:scale-95 shrink-0 block">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          {#if s.isHovered || s.isEditing}
            <div class="flex items-center gap-2 bg-slate-950/95 border border-slate-800 rounded-lg px-2 py-1 shadow-2xl ml-1.5 backdrop-blur-sm z-50 whitespace-nowrap">
              {#if s.isEditing}
                <input 
                  type="text"
                  bind:value={s.tempName}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      updateBookmarkNameAction(pageNumber, s.tempName);
                      s.isEditing = false;
                    } else if (e.key === 'Escape') {
                      s.tempName = match.name;
                      s.isEditing = false;
                    }
                  }}
                  class="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500 max-w-[110px] font-sans"
                  autofocus
                />
                <button 
                  onclick={() => {
                    updateBookmarkNameAction(pageNumber, s.tempName);
                    s.isEditing = false;
                  }}
                  class="p-0.5 rounded text-emerald-400 hover:bg-slate-800"
                  title="Save Changes">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              {:else}
                <span class="text-[10px] font-medium text-slate-300 max-w-[130px] truncate font-sans">
                  {match.name || 'Untitled reference'}
                </span>
                <button 
                  onclick={() => s.isEditing = true}
                  class="p-0.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-800"
                  title="Rename Note">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
              {/if}

              <button 
                onclick={() => deleteBookmarkAction(pageNumber)}
                class="p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          {/if}
        </div>
      {/snippet}
      {@render flagUI()}
    {:else}
      <div class="flex items-center relative pr-4">
        <button 
          onclick={() => addOrToggleBookmarkAction(pageNumber)}
          class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-400 drop-shadow-md transition-all active:scale-95"
          title="Add Bookmark">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Minimal PDF.js text layer styles — characters are invisible but selectable.
     :global() is required because TextLayer injects spans at runtime. */
  .textLayer {
    pointer-events: none;
    line-height: 1;
    text-align: initial;
    opacity: 1;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
    transform-origin: 0 0;
    caret-color: transparent;
    --text-scale-factor: calc(var(--total-scale-factor, 1) * var(--min-font-size, 1));
    --min-font-size-inv: calc(1 / var(--min-font-size, 1));
  }

  .textLayer :global(:is(span, br)) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    -webkit-user-select: text;
    user-select: text;
    pointer-events: none;
  }

  /* Only capture pointer events on glyphs when the select tool is active.
     Overrides parent select-none so the browser can form a selection. */
  .textLayer.textLayer--interactive {
    -webkit-user-select: text;
    user-select: text;
  }

  .textLayer.textLayer--interactive :global(:is(span, br)) {
    pointer-events: auto;
  }

  .textLayer :global(> :not(.markedContent)),
  .textLayer :global(.markedContent span:not(.markedContent)) {
    z-index: 1;
    font-size: calc(var(--text-scale-factor) * var(--font-height, 0));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x))
      scale(var(--min-font-size-inv));
  }

  .textLayer :global(.markedContent) {
    display: contents;
  }

  .textLayer :global(::selection) {
    background: rgba(0, 100, 255, 0.28);
    color: transparent;
  }

  .textLayer :global(::-moz-selection) {
    background: rgba(0, 100, 255, 0.28);
    color: transparent;
  }
</style>
