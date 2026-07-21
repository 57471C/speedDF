<script lang="ts">
  import { activeDoc, FONT_MAP } from "../pdfStore.svelte";
  import type { PageInteraction } from "../lib/interaction/dragHandler.svelte";
  import {
    arrowHeadSizePct,
    arrowHeadVertices,
    DEFAULT_TEXT_BOX_H,
    DEFAULT_TEXT_BOX_W,
    HIGHLIGHT_COLOR,
    HIGHLIGHT_OPACITY,
    HIGHLIGHT_STROKE_WIDTH,
    lineStrokeEndpoints,
  } from "../lib/annotation/toolShapes";
  import { ANNOTATION_TEXT_KEY } from "../lib/forms/formMemory";
  import ValueMemoryPopover from "./ValueMemoryPopover.svelte";

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

  /** Value-memory popover state for the active text annotation editor. */
  let textMemoryOpen = $state(false);
  let textMemoryAnchor = $state<HTMLElement | null>(null);
  let textMemoryIdx = $state<number | null>(null);

  const annotationMemoryKeys = [ANNOTATION_TEXT_KEY];

  function autofocusAction(node: HTMLInputElement | HTMLTextAreaElement) {
    setTimeout(() => {
      node.focus();
      textMemoryAnchor = node;
      textMemoryIdx = ix.activelyEditingIndex;
      textMemoryOpen = true;
    }, 0);
  }

  function onTextMemoryFocus(idx: number, e: FocusEvent) {
    textMemoryIdx = idx;
    textMemoryAnchor = e.currentTarget as HTMLElement;
    textMemoryOpen = true;
  }

  function closeTextMemory() {
    textMemoryOpen = false;
  }

  function onTextMemoryBlur(idx: number, e: FocusEvent) {
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    // Capture the edit session index now — ignore stale blurs for other fields
    const sessionIdx = ix.activelyEditingIndex;
    // Popover uses mousedown preventDefault to keep focus; only finalize on true leave
    requestAnimationFrame(() => {
      if (document.activeElement === el) return;
      // Only finalize if this blur belongs to the live edit session
      if (sessionIdx === null || sessionIdx !== idx) return;
      if (ix.activelyEditingIndex !== idx) return;
      textMemoryOpen = false;
      textMemoryAnchor = null;
      textMemoryIdx = null;
      finalizeTextEdit(idx, el);
    });
  }

  function onTextMemorySelect(idx: number, value: string) {
    // Apply only to the focused edit session — never by matching text content
    const editIdx = ix.activelyEditingIndex;
    if (editIdx === null || editIdx !== idx) return;
    const pageShapes = activeDoc.shapes[pageNumber] || [];
    const shape = pageShapes[editIdx];
    if (!shape || shape.type !== "text") return;

    // Immutable single-slot update so siblings (even with the same string) stay put
    const next = pageShapes.slice();
    next[editIdx] = { ...shape, text: value };
    activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: next };

    // Keep editing; hide suggestions after pick
    textMemoryOpen = false;
    // Re-focus after Svelte patches the bound textarea, then grow to fit
    requestAnimationFrame(() => {
      const el = textMemoryAnchor;
      if (el instanceof HTMLTextAreaElement && el.isConnected) {
        el.focus();
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
        growTextBoxToContent(editIdx, el);
      }
    });
  }

  /**
   * Grow the text annotation box (and textarea) to fit content / newlines.
   * Height is stored as % of page so it survives confirm and zoom.
   */
  function growTextBoxToContent(idx: number, node: HTMLTextAreaElement) {
    const pageRoot = node.closest("[data-page-number]") as HTMLElement | null;
    const pageH = pageRoot?.clientHeight ?? 0;
    if (pageH <= 0) return;
    const host = node.parentElement as HTMLElement | null;
    if (!host) return;

    // Classic measure: collapse height, read scrollHeight, restore
    const prevHostH = host.style.height;
    const prevNodeH = node.style.height;
    host.style.height = "auto";
    node.style.height = "0px";
    const neededPx = Math.max(node.scrollHeight, 18);
    host.style.height = prevHostH;
    node.style.height = prevNodeH;

    const heightPct = Math.max(
      DEFAULT_TEXT_BOX_H,
      (neededPx / pageH) * 100,
    );

    const pageShapes = activeDoc.shapes[pageNumber] || [];
    const shape = pageShapes[idx];
    if (!shape || shape.type !== "text") return;

    const prev = shape.height ?? 0;
    if (Math.abs(prev - heightPct) >= 0.05) {
      const next = pageShapes.slice();
      next[idx] = { ...shape, height: heightPct };
      activeDoc.shapes = { ...activeDoc.shapes, [pageNumber]: next };
    }
    // Fill host (style % applied on next paint; % fallback via h-full)
    node.style.height = "100%";
  }

  /** Svelte action: auto-expand text box on input / Enter newlines. */
  function autoGrowTextBox(node: HTMLTextAreaElement, idx: number) {
    let index = idx;
    const onInput = () => growTextBoxToContent(index, node);
    node.addEventListener("input", onInput);
    // Initial fit after fonts/layout
    requestAnimationFrame(() => growTextBoxToContent(index, node));
    return {
      update(newIdx: number) {
        index = newIdx;
      },
      destroy() {
        node.removeEventListener("input", onInput);
      },
    };
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
      'line',
      'pen',
    ].includes(activeDoc.activeTool || '')
      ? 'pointer-events-auto'
      : 'pointer-events-none'} {[...shapeTypesList, 'highlight', 'pen', 'line'].includes(
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
            stroke={HIGHLIGHT_COLOR}
            stroke-width={HIGHLIGHT_STROKE_WIDTH}
            stroke-opacity={HIGHLIGHT_OPACITY}
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cursor-pointer pointer-events-auto mix-blend-multiply {activeDoc.selectedShape?.pageNumber === pageNumber && activeDoc.selectedShape?.index === idx ? 'stroke-opacity-60' : ''}"
          />
        {:else if shape && shape.type === "pen" && shape.points}
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
        {:else if shape && shape.type === "line" && shape.points && shape.points.length >= 2}
          {@const pts = getDisplayPoints(shape.points)}
          {@const p0 = pts[0]}
          {@const p1 = pts[1]}
          {@const isLineSelected = activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
          {@const lineThick = shape.thickness || 3}
          {@const arrowSize = arrowHeadSizePct(lineThick)}
          {@const strokePts = lineStrokeEndpoints(p0, p1, shape.lineEnds, arrowSize)}
          <!-- Hit stroke uses full geometry (handles still at true endpoints) -->
          <line
            x1={p0.x}
            y1={p0.y}
            x2={p1.x}
            y2={p1.y}
            stroke="transparent"
            stroke-width={Math.max(12, lineThick + 8)}
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
            class="pointer-events-auto cursor-move"
            onmousedown={(e) => {
              if (activeDoc.activeTool === "select") initShapeMove(e, idx);
            }}
          />
          <!-- Visible stroke stops at arrow bases so caps never poke past the tip -->
          <line
            x1={strokePts.start.x}
            y1={strokePts.start.y}
            x2={strokePts.end.x}
            y2={strokePts.end.y}
            stroke={shape.color || "#000000"}
            stroke-width={lineThick}
            stroke-opacity="1"
            stroke-dasharray={shape.lineStyle ? strokeDasharrays[shape.lineStyle] : "none"}
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
            fill="none"
            class="pointer-events-none {isLineSelected ? 'stroke-cyan-400' : ''}"
            style={isLineSelected ? "filter: drop-shadow(0 0 1.5px rgba(0,210,255,0.7));" : ""}
          />
          {#if shape.lineEnds === "end" || shape.lineEnds === "both"}
            {@const head = arrowHeadVertices(p0, p1, arrowSize)}
            <polygon
              points={head.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={shape.color || "#000000"}
              class="pointer-events-none"
            />
          {/if}
          {#if shape.lineEnds === "both"}
            {@const headStart = arrowHeadVertices(p1, p0, arrowSize)}
            <polygon
              points={headStart.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={shape.color || "#000000"}
              class="pointer-events-none"
            />
          {/if}
        {/if}
      {/each}
      {#if ix.liveHighlightPoints.length > 1}
        {#if activeDoc.activeTool === "highlight"}
          <polyline
            points={getDisplayPoints(ix.liveHighlightPoints).map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ")}
            stroke={HIGHLIGHT_COLOR}
            stroke-width={HIGHLIGHT_STROKE_WIDTH}
            stroke-opacity={HIGHLIGHT_OPACITY}
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mix-blend-multiply"
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
      <!-- Line tool rubber-band preview (non-scaling stroke = same px as shapes) -->
      {#if ix.lineAwaitingEnd && ix.lineStartPct && ix.linePreviewPct}
        {@const previewPts = getDisplayPoints([ix.lineStartPct, ix.linePreviewPct])}
        {@const rp0 = previewPts[0]}
        {@const rp1 = previewPts[1]}
        {@const previewThick = activeDoc.activeThickness || 3}
        {@const previewArrow = arrowHeadSizePct(previewThick)}
        {@const previewStroke = lineStrokeEndpoints(rp0, rp1, activeDoc.activeLineEnds, previewArrow)}
        <line
          x1={previewStroke.start.x}
          y1={previewStroke.start.y}
          x2={previewStroke.end.x}
          y2={previewStroke.end.y}
          stroke={activeDoc.activeColor || "#000000"}
          stroke-width={previewThick}
          stroke-opacity="0.85"
          stroke-dasharray={activeDoc.activeLineStyle ? strokeDasharrays[activeDoc.activeLineStyle] : "none"}
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        {#if activeDoc.activeLineEnds === "end" || activeDoc.activeLineEnds === "both"}
          {@const head = arrowHeadVertices(rp0, rp1, previewArrow)}
          <polygon
            points={head.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={activeDoc.activeColor || "#000000"}
            fill-opacity="0.85"
          />
        {/if}
        {#if activeDoc.activeLineEnds === "both"}
          {@const headStart = arrowHeadVertices(rp1, rp0, previewArrow)}
          <polygon
            points={headStart.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={activeDoc.activeColor || "#000000"}
            fill-opacity="0.85"
          />
        {/if}
        <!-- Start point marker (viewBox %; keep tiny) -->
        <circle
          cx={rp0.x}
          cy={rp0.y}
          r="0.35"
          fill={activeDoc.activeColor || "#000000"}
          fill-opacity="0.9"
        />
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
        {@const textSelected =
          activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
        {@const textEditing = ix.activelyEditingIndex === idx}
        {@const textActive = textSelected || textEditing}
        {@const textW = display.width > 0 ? display.width : DEFAULT_TEXT_BOX_W}
        {@const textH = display.height > 0 ? display.height : DEFAULT_TEXT_BOX_H}
        {@const textColor = shape.textColor || shape.color || '#000000'}
        <!-- Top-left anchored box: outline + BR handle share this element; only BR resizes -->
        <div
          data-shape-idx={idx}
          class="absolute pointer-events-auto z-40 box-border
            {textActive
              ? 'border border-[#00d2ff] bg-cyan-500/5 rounded-sm shadow-sm'
              : 'border border-transparent hover:border-slate-400/30 rounded-sm'}"
          style="left: {display.x}%; top: {display.y}%; width: {textW}%; height: {textH}%; color: {textColor};"
        >
          {#if textEditing && activeDoc.shapes[pageNumber]?.[idx]}
            {@const editFont = `calc(${shape.size || 12}px * ${Math.max(0.1, Math.abs(zoomScale / 100))})`}
            {@const editFamily = FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}
            {@const editWeight = shape.style === 'Bold' ? 'bold' : 'normal'}
            {@const editStyle = shape.style === 'Italic' ? 'italic' : 'normal'}
            <!-- Shared metrics with display span to avoid a vertical jump on confirm/blur -->
            <textarea
              bind:value={activeDoc.shapes[pageNumber][idx].text}
              use:autofocusAction
              use:autoGrowTextBox={idx}
              onmousedown={(e) => e.stopPropagation()}
              onfocus={(e) => onTextMemoryFocus(idx, e)}
              onblur={(e) => onTextMemoryBlur(idx, e)}
              onkeydown={(e) => {
                // Plain Enter inserts a newline (auto-grow handles height).
                // Ctrl/Cmd/Shift+Enter commits the text box.
                if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  textMemoryOpen = false;
                  textMemoryAnchor = null;
                  textMemoryIdx = null;
                  finalizeTextEdit(idx, e.currentTarget);
                } else if (e.key === "Escape") {
                  textMemoryOpen = false;
                  textMemoryAnchor = null;
                  textMemoryIdx = null;
                  finalizeTextEdit(idx, e.currentTarget);
                } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  // After newline is inserted, grow on next frame
                  requestAnimationFrame(() =>
                    growTextBoxToContent(idx, e.currentTarget as HTMLTextAreaElement),
                  );
                }
              }}
              rows="1"
              class="w-full h-full min-w-0 min-h-0 bg-transparent border-0 rounded-none p-0.5 m-0 focus:outline-none font-sans block overflow-hidden box-border"
              class:text-center={shape.alignment === 'center'}
              class:text-right={shape.alignment === 'right'}
              class:text-left={!shape.alignment || shape.alignment === 'left'}
              style="color: {textColor}; caret-color: {textColor}; text-align: {shape.alignment || 'left'}; text-align-last: {shape.alignment || 'left'}; direction: ltr; resize: none; line-height: 1.2; font-size: {editFont}; font-family: {editFamily}; font-weight: {editWeight}; font-style: {editStyle};"
              autocomplete="off"
            ></textarea>
            {#if textMemoryIdx === idx}
              <ValueMemoryPopover
                open={textMemoryOpen}
                anchorEl={textMemoryAnchor}
                memoryKeys={annotationMemoryKeys}
                currentValue={activeDoc.shapes[pageNumber][idx].text || ""}
                onSelect={(v) => onTextMemorySelect(idx, v)}
                onClose={closeTextMemory}
              />
            {/if}
          {:else}
            <span
              onmousedown={(e) => startTextDrag(e, idx)}
              ondblclick={(e) => {
                e.stopPropagation();
                ix.beginTextEdit(idx);
              }}
              class="block w-full h-full overflow-hidden whitespace-pre-wrap cursor-move p-0.5 m-0 box-border"
              class:text-center={shape.alignment === 'center'}
              class:text-right={shape.alignment === 'right'}
              class:text-left={!shape.alignment || shape.alignment === 'left'}
              style="text-align: {shape.alignment || 'left'}; color: {shape.textColor || shape.color || '#000000'}; line-height: 1.2; font-size: calc({shape.size || 12}px * {Math.max(0.1, Math.abs(zoomScale / 100))}); font-family: {FONT_MAP[shape.font || 'Helvetica']?.css || 'Helvetica, Arial, sans-serif'}; font-weight: {shape.style === 'Bold' ? 'bold' : 'normal'}; font-style: {shape.style === 'Italic' ? 'italic' : 'normal'};"
              >{shape?.text || " "}</span
            >
          {/if}
          <!-- Single BR grab: top-left stays fixed; handle is on the same box as the outline -->
          {#if textActive}
            <div
              onmousedown={(e) => initHandleDrag(e, idx, "br")}
              class="resize-handle-node absolute w-2.5 h-2.5 bg-white border-2 border-[#00d2ff] -bottom-1.5 -right-1.5 cursor-nwse-resize rounded-full shadow-md z-50"
              title="Resize text box"
            ></div>
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
      {:else if shape && shape.type === "line" && shape.points && shape.points.length >= 2}
        {@const linePts = getDisplayPoints(shape.points)}
        {@const lp0 = linePts[0]}
        {@const lp1 = linePts[1]}
        {#if activeDoc.activeTool === "select" && activeDoc.selectedShapes.length === 1 && activeDoc.selectedShapes.some(s => s.pageNumber === pageNumber && s.index === idx)}
          <!-- Compact endpoint handles (smaller than box corners — sit on a thin stroke) -->
          <div
            onmousedown={(e) => initHandleDrag(e, idx, "line-start")}
            class="resize-handle-node absolute w-1.5 h-1.5 bg-white border border-[#00d2ff] rounded-full shadow-sm z-50 cursor-move -translate-x-1/2 -translate-y-1/2"
            style="left: {lp0.x}%; top: {lp0.y}%;"
            title="Start point"
          ></div>
          <div
            onmousedown={(e) => initHandleDrag(e, idx, "line-end")}
            class="resize-handle-node absolute w-1.5 h-1.5 bg-white border border-[#00d2ff] rounded-full shadow-sm z-50 cursor-move -translate-x-1/2 -translate-y-1/2"
            style="left: {lp1.x}%; top: {lp1.y}%;"
            title="End point"
          ></div>
        {/if}
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
              fill={activeDoc.activeTool === "oval-fill" ? activeDoc.activeColor : "none"}
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
              fill={activeDoc.activeTool?.includes('-fill') ? activeDoc.activeColor : "none"}
            />
          </svg>
        </div>
      {/if}
    {/if}
  </div>
