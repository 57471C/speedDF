<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import * as pdfjsLib from "pdfjs-dist";
  import { activeDoc, FONT_MAP, undoStack, redoStack } from "../pdfStore.svelte";
  import { PDFDocument, rgb, degrees, BlendMode, LineCapStyle, PDFString, PDFName } from "pdf-lib";
  import fontkit from "@pdf-lib/fontkit";

  let {
    onMinimize,
    onMaximize,
    onClose,
    onToggleHelp,
    onPrint,
    onOpenFile,
    onCloseDocument,
    onSaveSuccess,
    onToggleOcr,
    // --- NEW TOOLBAR PROPS ---
    onNew,
    onSave,
    onSaveAs,
    onUndo,
    onRedo,
  }: {
    onMinimize: () => void;
    onMaximize: () => void;
    onClose: () => void;
    onToggleHelp: () => void;
    onPrint?: () => void;
    onOpenFile?: () => void;
    onCloseDocument?: () => void;
    onSaveSuccess?: (msg: string) => void;
    onToggleOcr?: () => void;
    // --- NEW TOOLBAR PROPS TYPES ---
    onNew?: () => void;
    onSave?: () => void;
    onSaveAs?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  interface FilePayload {
    bytes: number[];
    name: string;
    path: string;
  }

  function hexToRgb(hexString: string): any {
    const hex = hexString.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }

  function getHexOpacity(hexString: string): number {
    const hex = hexString.replace("#", "");
    if (hex.length === 8) {
      return parseInt(hex.substring(6, 8), 16) / 255;
    }
    return 1.0;
  }

  function getDashArray(lineStyle?: string): number[] | undefined {
    if (!lineStyle || lineStyle === "solid") return undefined;
    if (lineStyle === "dashed") return [6, 6];
    if (lineStyle === "dotted") return [2, 3];
    if (lineStyle === "dash-dot") return [6, 3, 2, 3];
    return undefined;
  }

  async function drawAnnotationsOnPage(
    destDoc: PDFDocument,
    page: any,
    originalPageNumber: number,
    pageWidth: number,
    pageHeight: number,
    imageCache: Map<string, any>,
    fontCache: Map<string, any>,
  ) {
    const pageShapes = activeDoc.shapes[originalPageNumber] || [];
    for (const shape of pageShapes) {
      if (!shape) continue;
      const s = shape as any;

      const x = (s.x / 100) * pageWidth;
      const w = ((s.width ?? 0) / 100) * pageWidth;
      const h = ((s.height ?? 0) / 100) * pageHeight;
      const y = pageHeight - (s.y / 100) * pageHeight - h;

      const shapeColorHex = s.color || "#000000";
      const resolvedColorRgb = hexToRgb(shapeColorHex);

      if (s.type === "rect") {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: resolvedColorRgb,
          borderWidth: 2,
          opacity: getHexOpacity(shapeColorHex),
          borderDashArray: getDashArray(s.lineStyle),
        });
      } else if (s.type === "rect-fill") {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: resolvedColorRgb,
          opacity: getHexOpacity(shapeColorHex),
        });
      } else if (s.type === "oval") {
        page.drawEllipse({
          x: x + w / 2,
          y: y + h / 2,
          xScale: w / 2,
          yScale: h / 2,
          borderColor: resolvedColorRgb,
          borderWidth: 2,
          opacity: getHexOpacity(shapeColorHex),
          borderDashArray: getDashArray(s.lineStyle),
        });
      } else if (s.type === "oval-fill") {
        page.drawEllipse({
          x: x + w / 2,
          y: y + h / 2,
          xScale: w / 2,
          yScale: h / 2,
          color: resolvedColorRgb,
          opacity: getHexOpacity(shapeColorHex),
        });
      } else if (s.type === "text") {
        const fontName = s.fontFamily || s.font || "Helvetica";
        let pdfFont;

        if (fontName === 'Inter') {
          let fontPromise = fontCache.get('Inter');
          if (!fontPromise) {
            fontPromise = (async () => {
              const fontResponse = await fetch('/fonts/inter/Inter-Regular.ttf');
              const fontBuffer = await fontResponse.arrayBuffer();
              return await destDoc.embedFont(fontBuffer);
            })();
            fontCache.set('Inter', fontPromise);
          }
          pdfFont = await fontPromise;
        } else if (fontName === 'JetBrainsMono') {
          let fontPromise = fontCache.get('JetBrainsMono');
          if (!fontPromise) {
            fontPromise = (async () => {
              const fontResponse = await fetch('/fonts/jetbrains/JetBrainsMono-Regular.ttf');
              const fontBuffer = await fontResponse.arrayBuffer();
              return await destDoc.embedFont(fontBuffer);
            })();
            fontCache.set('JetBrainsMono', fontPromise);
          }
          pdfFont = await fontPromise;
        } else {
          const fontStyle = (s.style || "Normal") as "Normal" | "Bold" | "Italic";
          const fontMapping = FONT_MAP[fontName];
          const pdfFontKey = fontMapping ? (fontMapping.pdf[fontStyle] || fontMapping.pdf["Normal"]) : "Helvetica";

          let fontPromise = fontCache.get(pdfFontKey);
          if (!fontPromise) {
            fontPromise = destDoc.embedStandardFont(pdfFontKey as any);
            fontCache.set(pdfFontKey, fontPromise);
          }
          pdfFont = await fontPromise;
        }

        const fontSize = s.size || 12;
        const textBaselineY = pageHeight - (s.y / 100) * pageHeight;
        const zoomMultiplier = (activeDoc.zoomScale || 120) / 100;
        const yOffset = 10 / zoomMultiplier;
        const textHexColor = s.textColor || s.color || "#000000";
        const resolvedTextColorRgb = hexToRgb(textHexColor);
        page.drawText(s?.text || "", {
          x,
          y: textBaselineY - yOffset,
          size: fontSize,
          font: pdfFont,
          color: resolvedTextColorRgb,
          opacity: getHexOpacity(textHexColor),
        });
      } else if (s.type === "tick") {
        const startPt = { x: x + w * 0.167, y: y + h * 0.5 };
        const vertexPt = { x: x + w * 0.375, y: y + h * 0.292 };
        const endPt = { x: x + w * 0.833, y: y + h * 0.75 };
        page.drawLine({
          start: startPt,
          end: vertexPt,
          color: resolvedColorRgb,
          thickness: 3.5,
          lineCap: LineCapStyle.Round,
          opacity: getHexOpacity(shapeColorHex),
        });
        page.drawLine({
          start: vertexPt,
          end: endPt,
          color: resolvedColorRgb,
          thickness: 3.5,
          lineCap: LineCapStyle.Round,
          opacity: getHexOpacity(shapeColorHex),
        });
      } else if (s.type === "dash") {
        page.drawLine({
          start: { x, y: y + h / 2 },
          end: { x: x + w, y: y + h / 2 },
          color: resolvedColorRgb,
          thickness: 3.5,
          lineCap: LineCapStyle.Round,
          opacity: getHexOpacity(shapeColorHex),
        });
      } else if (
        (s.type === "signature" || s.type === "initial") &&
        s.dataUrl
      ) {
        let imgPromise = imageCache.get(s.dataUrl);
        if (!imgPromise) {
          imgPromise = destDoc.embedPng(s.dataUrl);
          imageCache.set(s.dataUrl, imgPromise);
        }
        const embeddedImageDest = await imgPromise;
        const imgW = embeddedImageDest.width;
        const imgH = embeddedImageDest.height;
        const dampedH = h * 0.80;
        const targetW = dampedH * (imgW / imgH);
        const dampedY = y + (h - dampedH) / 2;
        page.drawImage(embeddedImageDest, { x, y: dampedY, width: targetW, height: dampedH });
      } else if (
        s.type === "highlight" &&
        s.points &&
        s.points.length > 1
      ) {
        for (let k = 0; k < s.points.length - 1; k++) {
          const p1 = s.points[k];
          const p2 = s.points[k + 1];
          page.drawLine({
            start: {
              x: (p1.x / 100) * pageWidth,
              y: pageHeight - (p1.y / 100) * pageHeight,
            },
            end: {
              x: (p2.x / 100) * pageWidth,
              y: pageHeight - (p2.y / 100) * pageHeight,
            },
            color: resolvedColorRgb,
            thickness: s.thickness || (2.0 / 100) * pageWidth,
            opacity: shapeColorHex.replace('#', '').length === 8 ? getHexOpacity(shapeColorHex) : 0.40,
            blendMode: BlendMode.Multiply,
            lineCap: LineCapStyle.Round,
          });
        }
      } else if (
        s.type === "pen" &&
        s.points &&
        s.points.length > 1
      ) {
        for (let k = 0; k < s.points.length - 1; k++) {
          const p1 = s.points[k];
          const p2 = s.points[k + 1];
          page.drawLine({
            start: {
              x: (p1.x / 100) * pageWidth,
              y: pageHeight - (p1.y / 100) * pageHeight,
            },
            end: {
              x: (p2.x / 100) * pageWidth,
              y: pageHeight - (p2.y / 100) * pageHeight,
            },
            color: resolvedColorRgb,
            thickness: s.thickness || 3,
            opacity: getHexOpacity(shapeColorHex),
            lineCap: LineCapStyle.Round,
          });
        }
      }
    }
  }

  async function flattenWorkspaceToPDF(): Promise<Uint8Array | null> {
    if (!activeDoc.rawBytes || activeDoc.pageOrder.length === 0) return null;
    try {
      const destDoc = await PDFDocument.create();
      destDoc.registerFontkit(fontkit);
      const imageCache = new Map<string, any>();
      const fontCache = new Map<string, any>();
      if (activeDoc.fileType === "tiff") {
        console.log("Save Engine: Compiling native multi-page TIFF drawing into a standard PDF structure...");
        const annotationPromises = [];
        for (let i = 0; i < activeDoc.pageOrder.length; i++) {
          const originalPageNumber = activeDoc.pageOrder[i];
          const rawPngBytes = activeDoc.tiffPages[originalPageNumber - 1];
          if (!rawPngBytes) continue;

          const embeddedImage = await destDoc.embedPng(rawPngBytes);
          const rotationAngle = activeDoc.rotations[originalPageNumber] ?? 0;
          let pageWidth = embeddedImage.width;
          let pageHeight = embeddedImage.height;

          if (rotationAngle === 90 || rotationAngle === 270) {
            pageWidth = embeddedImage.height;
            pageHeight = embeddedImage.width;
          }

          const page = destDoc.addPage([pageWidth, pageHeight]);
          let drawX = 0;
          let drawY = 0;
          if (rotationAngle === 90) {
            drawX = pageWidth;
            drawY = 0;
          } else if (rotationAngle === 180) {
            drawX = pageWidth;
            drawY = pageHeight;
          } else if (rotationAngle === 270) {
            drawX = 0;
            drawY = pageHeight;
          }

          page.drawImage(embeddedImage, {
            x: drawX,
            y: drawY,
            width: embeddedImage.width,
            height: embeddedImage.height,
            rotate: degrees(-rotationAngle)
          });
          annotationPromises.push(
            drawAnnotationsOnPage(destDoc, page, originalPageNumber, pageWidth, pageHeight, imageCache, fontCache)
          );
        }
        await Promise.all(annotationPromises);
      } else {
        const srcDoc = await PDFDocument.load(activeDoc.rawBytes);
        const copiedPages = await destDoc.copyPages(
          srcDoc,
          activeDoc.pageOrder.map((num) => num - 1),
        );
        const annotationPromises = [];
        for (let i = 0; i < activeDoc.pageOrder.length; i++) {
          const originalPageNumber = activeDoc.pageOrder[i];
          const page = copiedPages[i];
          destDoc.addPage(page);

          const { width: pageWidth, height: pageHeight } = page.getSize();
          if (activeDoc.rotations[originalPageNumber] !== undefined) {
            const existingAngle = page.getRotation().angle;
            page.setRotation(
              degrees(
                (existingAngle + activeDoc.rotations[originalPageNumber]) % 360,
              ),
            );
          }

          annotationPromises.push(
            drawAnnotationsOnPage(destDoc, page, originalPageNumber, pageWidth, pageHeight, imageCache, fontCache)
          );
        }
        await Promise.all(annotationPromises);
      }

      // Outline / Bookmark Serialization Layer
      if (activeDoc.bookmarks && activeDoc.bookmarks.length > 0) {
        const { context } = destDoc;
        const pageRefs = destDoc.getPages().map(p => p.ref); // Get native Object IDs for pages
        const pageOrderSet = new Set(activeDoc.pageOrder);
        const validBookmarks = activeDoc.bookmarks.filter(b => pageOrderSet.has(b.pageNum));
        if (validBookmarks.length > 0) {
          const pageIndexMap = new Map();
          activeDoc.pageOrder.forEach((p, i) => pageIndexMap.set(p, i));
          // Create individual outline item dictionaries
          const outlineItems = validBookmarks.map((b) => {
            const targetIndex = pageIndexMap.get(b.pageNum);
            const itemRef = context.nextRef();
            return {
              ref: itemRef,
              dict: context.obj({
                Title: PDFString.of(b.name || `Page ${b.pageNum}`),
                Dest: [pageRefs[targetIndex], 'XYZ', null, null, null], // Maps accurately to target page object reference
              })
            };
          });
          // Wire up the linked-list properties (/Parent, /Next, /Prev) for each item ref
          const outlinesDictRef = context.nextRef();
          outlineItems.forEach((item, idx) => {
            item.dict.set(PDFName.of('Parent'), outlinesDictRef);
            if (idx > 0) item.dict.set(PDFName.of('Prev'), outlineItems[idx - 1].ref);
            if (idx < outlineItems.length - 1) item.dict.set(PDFName.of('Next'), outlineItems[idx + 1].ref);
            context.assign(item.ref, item.dict);
          });
          // Compile the parent /Outlines root control block
          const outlinesDict = context.obj({
            Type: PDFName.of('Outlines'),
            First: outlineItems[0].ref,
            Last: outlineItems[outlineItems.length - 1].ref,
            Count: outlineItems.length,
          });
          context.assign(outlinesDictRef, outlinesDict);

          // Securely attach the completed hierarchy directly to the main file catalog registry
          destDoc.catalog.set(PDFName.of('Outlines'), outlinesDictRef);
        } else {
          destDoc.catalog.delete(PDFName.of('Outlines'));
        }
      } else {
        destDoc.catalog.delete(PDFName.of('Outlines'));
      }

      return await destDoc.save();
    } catch (err) {
      console.error("PDF Flattening/Compilation Failure:", err);
      return null;
    }
  }

  async function triggerFileOpen() {
    if (onOpenFile) {
      onOpenFile();
      return;
    }
    try {
      console.log("Invoking native Windows file dialog payload bridge...");
      const payload = await invoke<FilePayload>("native_open_file");
      if (payload && payload.bytes) {
        const typedBytes = new Uint8Array(payload.bytes);
        const loadingTask = pdfjsLib.getDocument({
          data: typedBytes.slice(0),
          cMapUrl: window.location.origin + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: window.location.origin + "/standard_fonts/",
          wasmUrl: window.location.origin + "/"
        });
        const pdfDocument = await loadingTask.promise;

        activeDoc.rawBytes = typedBytes;
        activeDoc.pageCount = pdfDocument.numPages;
        activeDoc.pageOrder = Array.from(
          { length: pdfDocument.numPages },
          (_, idx) => idx + 1,
        );
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.fileName = payload.name;
        activeDoc.filePath = payload.path;
        // Ingestion of outlines / bookmarks
        try {
          const outline = await pdfDocument.getOutline();
          if (outline && outline.length > 0) {
            const loadedBookmarks = [];
            for (const item of outline) {
              let pageNum = 1;
              if (item.dest) {
                let destObj: any = item.dest;
                if (typeof destObj === 'string') {
                  destObj = await pdfDocument.getDestination(destObj);
                }
                if (Array.isArray(destObj) && destObj[0]) {
                  const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
                  pageNum = pageIndex + 1;
                }
              }
              loadedBookmarks.push({ pageNum, name: item.title || "" });
            }
            activeDoc.bookmarks = loadedBookmarks;
          } else {
            activeDoc.bookmarks = [];
          }
        } catch (outlineErr) {
          console.error("Failed to parse document outline tree:", outlineErr);
          activeDoc.bookmarks = [];
        }
      }
    } catch (err) {
      console.error("Native file load intercept breakdown:", err);
    }
  }

  async function flattenWorkspaceToImage(outputPath: string | null = null): Promise<Uint8Array | null> {
    if (!activeDoc.imageUrl) return null;
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(err);
        img.src = activeDoc.imageUrl || "";
      });

      const basePageWidth = img.naturalWidth || img.width;
      const basePageHeight = img.naturalHeight || img.height;

      const shapes = activeDoc.shapes[1] || [];
      const imgElements: { [key: number]: HTMLImageElement } = {};
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        if (shape && (shape.type === 'signature' || shape.type === 'initial') && shape.dataUrl) {
          try {
            const sigImg = new Image();
            await new Promise<void>((resolve, reject) => {
              sigImg.onload = () => resolve();
              sigImg.onerror = (err) => reject(err);
              sigImg.src = shape.dataUrl || "";
            });
            imgElements[i] = sigImg;
          } catch (e) {
            console.error("Failed to preload signature image:", e);
          }
        }
      }

      const canvas = document.createElement('canvas');
      const rotation = activeDoc.imageRotation || 0;
      const isRotated90 = rotation === 90 || rotation === 270;
      
      const W = basePageWidth;
      const H = basePageHeight;
      
      canvas.width = isRotated90 ? H : W;
      canvas.height = isRotated90 ? W : H;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        if (!shape) continue;
        
        const x = -W / 2 + (shape.x / 100) * W;
        const y = -H / 2 + (shape.y / 100) * H;
        const w = (shape.width ?? 0) / 100 * W;
        const h = (shape.height ?? 0) / 100 * H;
        
        ctx.save();
        ctx.strokeStyle = shape.color || '#000000';
        ctx.fillStyle = shape.color || '#000000';
        ctx.lineWidth = shape.thickness || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const dashPattern = getDashArray(shape.lineStyle);
        if (dashPattern) {
          ctx.setLineDash(dashPattern);
        }
        
        if (shape.type === 'rect') {
          ctx.strokeRect(x, y, w, h);
        } else if (shape.type === 'rect-fill') {
          ctx.fillRect(x, y, w, h);
        } else if (shape.type === 'round-rect') {
          ctx.beginPath();
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(x, y, w, h, 8);
          } else {
            ctx.rect(x, y, w, h);
          }
          ctx.stroke();
        } else if (shape.type === 'round-rect-fill') {
          ctx.beginPath();
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(x, y, w, h, 8);
          } else {
            ctx.rect(x, y, w, h);
          }
          ctx.fill();
        } else if (shape.type === 'oval') {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (shape.type === 'oval-fill') {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
          ctx.fill();
        } else if (shape.type === 'text') {
          ctx.fillStyle = shape.textColor || shape.color || '#000000';
          const fontSize = shape.size || 12;
          const fontName = shape.fontFamily || shape.font || 'Helvetica';
          const fontStyle = shape.style === 'Bold' ? 'bold' : shape.style === 'Italic' ? 'italic' : 'normal';
          const cssFontFamily = FONT_MAP[fontName]?.css || `${fontName}, sans-serif`;
          ctx.font = `${fontStyle} ${fontSize}px ${cssFontFamily}`;
          ctx.textBaseline = 'middle';
          ctx.fillText(shape.text || '', x, y);
        } else if (shape.type === 'tick') {
          ctx.beginPath();
          ctx.moveTo(x + (20/24)*w, y + (6/24)*h);
          ctx.lineTo(x + (9/24)*w, y + (17/24)*h);
          ctx.lineTo(x + (4/24)*w, y + (12/24)*h);
          ctx.stroke();
        } else if (shape.type === 'dash') {
          ctx.beginPath();
          ctx.moveTo(x + (2/24)*w, y + (12/24)*h);
          ctx.lineTo(x + (22/24)*w, y + (12/24)*h);
          ctx.stroke();
        } else if (shape.type === 'signature' || shape.type === 'initial') {
          const sigImg = imgElements[i];
          if (sigImg) {
            ctx.drawImage(sigImg, x, y, w, h);
          }
        } else if ((shape.type === 'pen' || shape.type === 'highlight') && shape.points) {
          if (shape.points.length > 0) {
            ctx.beginPath();
            const firstPt = shape.points[0];
            const fx = -W / 2 + (firstPt.x / 100) * W;
            const fy = -H / 2 + (firstPt.y / 100) * H;
            ctx.moveTo(fx, fy);
            for (let j = 1; j < shape.points.length; j++) {
              const pt = shape.points[j];
              const px = -W / 2 + (pt.x / 100) * W;
              const py = -H / 2 + (pt.y / 100) * H;
              ctx.lineTo(px, py);
            }
            if (shape.type === 'highlight') {
              ctx.strokeStyle = '#fff200';
              ctx.lineWidth = (2.0 / 100) * W;
              ctx.globalAlpha = 0.42;
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      
      ctx.restore();

      const lowerPath = (outputPath || activeDoc.filePath || "").toLowerCase();
      let mimeType = 'image/jpeg';
      if (lowerPath.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (lowerPath.endsWith('.webp')) {
        mimeType = 'image/webp';
      }

      const dataUrl = mimeType === 'image/jpeg'
        ? canvas.toDataURL(mimeType, 0.95)
        : canvas.toDataURL(mimeType);

      const base64Data = dataUrl.split(',')[1];
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const resultBytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        resultBytes[i] = binaryString.charCodeAt(i);
      }
      return resultBytes;
    } catch (err) {
      console.error("Failed to compile image annotations:", err);
      return null;
    }
  }

  async function triggerFileSaveAs() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    try {
      let defaultName = "";

      if (activeDoc.fileType === 'image') {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(jpg|jpeg|png)$/i, "") + "_revised.jpg"
          : 'Untitled.jpg';
      } else {
        defaultName = activeDoc.fileName
          ? activeDoc.fileName.replace(/\.(pdf|tiff|tif)$/i, "") + "_revised.pdf"
          : 'Untitled.pdf';
      }

      // 1. Generate dynamic window filters based on file session mode
      const dialogFilters = activeDoc.fileType === 'image'
        ? [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png']
            }
          ]
        : [
            {
              name: 'PDF',
              extensions: ['pdf']
            }
          ];

      // 2. Pass these filters down into the native Tauri save picker launch options
      const savedPath = await save({
        defaultPath: defaultName,
        filters: dialogFilters
      });

      if (!savedPath) return;

      let compiledBytes: Uint8Array | null = null;
      if (activeDoc.fileType === 'image') {
        console.log("Compiling and flattening image annotations...");
        compiledBytes = await flattenWorkspaceToImage(savedPath);
      } else {
        console.log("Compiling and flattening PDF annotations...");
        compiledBytes = await flattenWorkspaceToPDF();
      }

      if (!compiledBytes) {
        alert("Failed to compile annotations.");
        return;
      }

      await invoke("native_overwrite_file", {
        path: savedPath,
        fileBytes: Array.from(compiledBytes),
      });
      activeDoc.filePath = savedPath;
      const parts = savedPath.split(/[\\/]/);
      activeDoc.fileName = parts[parts.length - 1];
      activeDoc.isDirty = false;
      if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
      console.log("Document footprint committed cleanly to disk via Save As.");
    } catch (err) {
      if (err !== "User cancelled save layout") {
        console.error("File generation layer fault:", err);
      }
    }
  }

  async function triggerFileSave() {
    if (!activeDoc.rawBytes && !activeDoc.imageUrl) return;
    if (!activeDoc.filePath) {
      await triggerFileSaveAs();
      return;
    }
    try {
      if (activeDoc.fileType === 'image') {
        console.log("Compiling and flattening image annotations for silent save...");
        const compiledBytes = await flattenWorkspaceToImage(activeDoc.filePath);
        if (!compiledBytes) {
          alert("Failed to compile annotations into Image object stream.");
          return;
        }
        await invoke("native_overwrite_file", {
          path: activeDoc.filePath,
          fileBytes: Array.from(compiledBytes),
        });
        activeDoc.isDirty = false;
        console.log("Document footprint committed silently to disk.");
        if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
        return;
      }

      console.log(
        "Compiling and flattening PDF annotations for silent save...",
      );
      const compiledBytes = await flattenWorkspaceToPDF();
      if (!compiledBytes) {
        alert("Failed to compile annotations into PDF object stream.");
        return;
      }
      await invoke("native_overwrite_file", {
        path: activeDoc.filePath,
        fileBytes: Array.from(compiledBytes),
      });
      activeDoc.isDirty = false;
      console.log("Document footprint committed silently to disk.");
      if (typeof onSaveSuccess === 'function') onSaveSuccess("File Saved Successfully");
    } catch (err) {
      console.error("Silent file overwrite fault:", err);
    }
  }

  function closeActiveDocument() {
    activeDoc.rawBytes = null;
    activeDoc.fileName = "";
    activeDoc.filePath = null;
    activeDoc.pageCount = 0;
    activeDoc.pageOrder = [];
    activeDoc.currentPage = 1;
    activeDoc.shapes = {};
  }

  function handlePrintClick() {
    if (onPrint) {
      onPrint();
    } else {
      console.error("TitleBar: onPrint prop callback is undefined/not passed!");
    }
  }

  // Export methods to be called via bind:this reference
  export const triggerOpen = triggerFileOpen;
  export const triggerSave = triggerFileSave;
  export const triggerSaveAs = triggerFileSaveAs;
  export const getAnnotatedPdfBytes = flattenWorkspaceToPDF;
</script>

<div
  class="h-9 w-full bg-[#0b101c] border-b border-slate-900 select-none relative z-50 font-sans"
>
  <div data-tauri-drag-region class="absolute inset-0 z-0 bg-transparent pointer-events-auto"></div>

  <div class="relative z-10 w-full h-full flex items-center justify-between px-3 pointer-events-none">
    <div class="flex items-center gap-4 z-50">
      <div class="flex items-center gap-2 pointer-events-none">
        <svg
          width="22"
          height="22"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
          data-fg-d3bl89="0.8:1.18514:/src/app/App.tsx:215:5:7461:343:e:svg:ete:1"
          data-fgid-d3bl89=":r4i:"
          data-fg-callsite-d3bl187=""
          style="display: block;"
        >
          <rect
            x="0"
            y="0"
            width="32"
            height="32"
            rx="6"
            fill="#0f172a"
            data-fg-d3bl90="0.8:1.18514:/src/app/App.tsx:222:7:7619:65:e:rect"
          ></rect>
          <polygon
            points="20,4 14,16 18,16 11,28 9,28 16,16 12,16 18,4"
            fill="#06b6d4"
            data-fg-d3bl91="0.8:1.18514:/src/app/App.tsx:223:7:7691:102:e:polygon"
          ></polygon>
        </svg>
        <h1 class="text-lg font-bold tracking-tight text-slate-100" style="font-family: 'Space Grotesk', sans-serif;">speed<span class="text-cyan-400">DF</span></h1>
      </div>

      <div class="flex items-center gap-0.5 ml-4">
        <button 
          disabled={!!activeDoc.rawBytes}
          onclick={onNew} 
          title="New Blank A4 (Ctrl+N)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>

        <button onclick={onOpenFile} title="Open Document (Ctrl+O)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>

        <button onclick={onSave} title="Save (Ctrl+S)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>

        <button onclick={onSaveAs} title="Save As... (Ctrl+Shift+S)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.33 13H8a1 1 0 00-1 1v7" />
            <path d="M14.363 17.634a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506l4.013-4.009a1 1 0 10-3.004-3.004z" />
            <path d="M7 3v4a1 1 0 001 1h7" />
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h10.2a2 2 0 011.4.6l3.8 3.8a2 2 0 01.6 1.4v.3" />
          </svg>
        </button>

        <button onclick={onPrint} title="Print (Ctrl+P)" class="toolbar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>
          </svg>
        </button>

        <div class="w-px h-4 bg-slate-700 mx-1.5"></div>

        <button 
          disabled={!activeDoc.rawBytes || undoStack.length === 0}
          onclick={onUndo} 
          title="Undo (Ctrl+Z)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>

        <button 
          disabled={!activeDoc.rawBytes || redoStack.length === 0}
          onclick={onRedo} 
          title="Redo (Ctrl+Y)" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
          </svg>
        </button>

        <div class="w-px h-4 bg-slate-700 mx-1.5"></div>

        <button 
          disabled={!activeDoc.rawBytes}
          onclick={onToggleOcr} 
          title="Extract Text" 
          class="toolbar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a4 4 0 0 1 4 4"/><path d="M21 17a4 4 0 0 1-4 4"/><path d="M7 21a4 4 0 0 1-4-4"/><path d="M3 7a4 4 0 0 1 4-4"/>
            <path d="M12 7l3 9"/><path d="M9 16h6"/><path d="M12 7L9 16"/>
          </svg>
        </button>
      </div>
    </div>

    <div
      class="flex-1 h-full flex items-center justify-center cursor-move"
    >
      <div class="flex items-center gap-1.5 pointer-events-auto cursor-default">
        <span
          class="titlebar-btn text-[11px] font-semibold text-slate-400 tracking-wide truncate max-w-xs hover:!text-white transition-colors"
        >
          {activeDoc.fileName ?
            activeDoc.fileName : "No Document Active"}
        </span>
        {#if activeDoc.fileName}
          <button
            onclick={() => { if (typeof onCloseDocument === 'function') onCloseDocument();
            else closeActiveDocument(); }}
            class="titlebar-btn w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:!text-white transition-colors pointer-events-auto"
            title="Close Document"
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
              ><line x1="18" y1="6" x2="6" y2="18"></line><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
            ></line></svg>
          </button>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-3 z-50">
      <div class="flex items-center gap-1">
        <button
          onclick={onToggleHelp}
          class="titlebar-btn p-1 rounded-md text-slate-400 hover:!text-white transition-colors flex items-center justify-center"
          title="System Help Information Operations (F1)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
      </div>

      <div class="flex items-center h-full border-l border-slate-900/60 pl-2">
        <button
          onclick={onMinimize}
          class="titlebar-btn w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:!text-white transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg
          >
        </button>
        <button
          onclick={onMaximize}
          class="titlebar-btn w-7 h-7 
            flex items-center justify-center rounded text-slate-400 hover:!text-white transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            ><rect width="18" height="18" x="3" y="3" rx="2" /></svg
          >
        </button>
        <button
          onclick={onClose}
          class="titlebar-close-btn w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:!bg-red-600 hover:!text-white transition-all"
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
            ><line x1="18" y1="6" x2="6" y2="18" /><line
              x1="6"
              y1="6"
              x2="18"
              y2="18"
            ></line></svg
          >
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .toolbar-btn {
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: #94a3b8;
    cursor: pointer;
    pointer-events: auto;
    transition: color 0.15s ease, background-color 0.15s ease;
  }
  
  .toolbar-btn:hover {
    background-color: #1e293b;
    color: #f1f5f9;
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  .titlebar-btn {
    color: #94a3b8 !important;
    /* text-slate-400 fallback */
    transition: color 0.15s ease, background-color 0.15s ease !important;
    pointer-events: auto !important;
  }
  .titlebar-btn:hover {
    color: #ffffff !important;
  }
  .titlebar-close-btn {
    color: #94a3b8 !important;
    pointer-events: auto !important;
    transition: all 0.15s ease !important;
  }
  .titlebar-close-btn:hover {
    background-color: #dc2626 !important;
    /* bg-red-600 fallback */
    color: #ffffff !important;
  }
</style>