<script lang="ts">
  import { activeDoc, FONT_MAP } from "../pdfStore.svelte";
  import type { PageInteraction } from "../lib/interaction/dragHandler.svelte";

  let {
    pageNumber,
    zoomScale,
    strokeDasharrays,
    shapeTypesList,
    ghostDimensions,
    ix,
    initShapeMove,
    startTextDrag,
    initHandleDrag,
    finalizeTextEdit,
    getDisplayCoords,
    getDisplayPoints,
  } = $props<{
    pageNumber: number;
    zoomScale: number;
    strokeDasharrays: Record<string, string>;
    shapeTypesList: readonly string[];
    ghostDimensions: { w: number; h: number };
    ix: PageInteraction;
    initShapeMove: (e: MouseEvent, index: number) => void;
    startTextDrag: (e: MouseEvent, index: number) => void;
    initHandleDrag: (e: MouseEvent, index: number, handleType: string) => void;
    finalizeTextEdit: (index: number, element: HTMLInputElement | HTMLTextAreaElement) => void;
    getDisplayCoords: (shape: { x: number; y: number; width?: number; height?: number }) => { x: number; y: number; width: number; height: number };
    getDisplayPoints: (points: { x: number; y: number }[] | undefined) => { x: number; y: number }[];
  }>();

  function autofocusAction(node: HTMLInputElement | HTMLTextAreaElement) {
    setTimeout(() => {
      node.focus();
    }, 0);
  }
</script>

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
            points={getDisplayPoints(shape.points).map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ")}
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
              points={getDisplayPoints(shape.points).map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ")}
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
      {#if ix.liveHighlightPoints.length > 1}
        {#if activeDoc.activeTool === "highlight"}
          <polyline
            points={getDisplayPoints(ix.liveHighlightPoints).map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ")}
            stroke={activeDoc.activeColor || "#fff200"}
            stroke-width="2.0"
            stroke-opacity={activeDoc.activeColor && activeDoc.activeColor.length === 9 ? undefined : "0.48"}
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {:else if activeDoc.activeTool === "pen"}
          <polyline
            points={getDisplayPoints(ix.liveHighlightPoints).map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ")}
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
          class="absolute pointer-events-auto z-40"
          style="left: {display.x}%; top: {display.y}%; color: {shape.textColor || shape.color || '#000000'};"
        >
          {#if ix.activelyEditingIndex === idx && activeDoc.shapes[pageNumber]?.[idx]}
            <textarea
              bind:value={activeDoc.shapes[pageNumber][idx].text}
              use:autofocusAction
              onmousedown={(e) => e.stopPropagation()}
              onblur={(e) => finalizeTextEdit(idx, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  finalizeTextEdit(idx, e.currentTarget);
                } else if (e.key === "Escape") {
                  finalizeTextEdit(idx, e.currentTarget);
                }
              }}
              class="bg-transparent text-black border border-slate-300 rounded p-1 text-sm shadow-md focus:outline-none focus:ring-1 focus:ring-cyan-500 font-sans block"
              class:text-center={shape.alignment === 'center'}
              class:text-right={shape.alignment === 'right'}
              class:text-left={!shape.alignment || shape.alignment === 'left'}
              style="text-align: {shape.alignment || 'left'}; text-align-last: {shape.alignment || 'left'}; direction: ltr; resize: both; font-size: calc({shape.size || 12}px * {Math.max(0.1, Math.abs(zoomScale / 100))}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
            ></textarea>
          {:else}
            <span
              onmousedown={(e) => startTextDrag(e, idx)}
              ondblclick={(e) => {
                e.stopPropagation();
                ix.beginTextEdit(idx);
              }}
              class="block bg-transparent border border-dashed rounded-xs whitespace-pre-wrap transition-colors cursor-move p-0.5 {activeDoc
                .selectedShape?.pageNumber === pageNumber &&
              activeDoc.selectedShape?.index === idx
                ? 'border-[#00d2ff] bg-cyan-500/5'
                : 'border-transparent hover:border-slate-400/30'}"
              class:text-center={shape.alignment === 'center'}
              class:text-right={shape.alignment === 'right'}
              class:text-left={!shape.alignment || shape.alignment === 'left'}
              style="text-align: {shape.alignment || 'left'}; color: {shape.textColor || shape.color || '#000000'}; font-size: calc({shape.size || 12}px * {Math.max(0.1, Math.abs(zoomScale / 100))}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
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

    {#if ix.isMouseOverPage && activeDoc.activeTool && !ix.isDrawing}
      {@const displayCursor = getDisplayCoords({ x: ix.hoverPctX, y: ix.hoverPctY, width: 0, height: 0 } as any)}
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

    {#if ix.isDrawing && activeDoc.activeTool && shapeTypesList.includes(activeDoc.activeTool)}
      {#if activeDoc.activeTool === "oval" || activeDoc.activeTool === "oval-fill"}
        <div
          class="absolute"
          style="left: {Math.min(ix.startX, ix.currentX)}px; top: {Math.min(
            ix.startY,
            ix.currentY,
          )}px; 
                 width: {Math.abs(ix.currentX - ix.startX)}px; height: {Math.abs(
            ix.currentY - ix.startY,
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
          style="left: {Math.min(ix.startX, ix.currentX)}px; top: {Math.min(
            ix.startY,
            ix.currentY,
          )}px; 
                 width: {Math.abs(ix.currentX - ix.startX)}px; height: {Math.abs(
            ix.currentY - ix.startY,
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
