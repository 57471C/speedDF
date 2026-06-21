<script lang="ts">
  import { activeDoc, saveSignatureSetAction } from "../pdfStore.svelte";

  let { zoomScale = $bindable() }: { zoomScale: number } = $props();

  const doc = activeDoc as any;

  let isMenuOpen = $state(false);
  let isModalOpen = $state(false);
  let isColorMenuOpen = $state(false);
  let isShapeMenuOpen = $state(false); // ⚡ NEW STATE: Tracks hidden context shape menu tray
  let setPendingDeletion = $state<string | null>(null);

  let sigCanvas = $state<HTMLCanvasElement | null>(null);
  let initCanvas = $state<HTMLCanvasElement | null>(null);

  let sigDrawing = false;
  let initDrawing = false;
  let lastX = 0;
  let lastY = 0;

  const colorPalette = [
    { name: "Black", hex: "#000000" },
    { name: "Cyan", hex: "#00d2ff" },
    { name: "Red", hex: "#ef4444" },
    { name: "Green", hex: "#22c55e" },
    { name: "Yellow", hex: "#ffea00" },
  ];

  // ⚡ NEW PARAMETER: Matrix array of supported vector shapes
  const shapeVariants = [
    {
      id: "rect",
      label: "Box Outline",
      icon: `<rect x="3" y="3" width="18" height="18" rx="0" fill="none" stroke="currentColor" stroke-width="2.5"/>`,
    },
    {
      id: "round-rect",
      label: "Round Outline",
      icon: `<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/>`,
    },
    {
      id: "oval",
      label: "Oval Outline",
      icon: `<ellipse cx="12" cy="12" rx="9" ry="7" fill="none" stroke="currentColor" stroke-width="2.5"/>`,
    },
    {
      id: "rect-fill",
      label: "Box Filled",
      icon: `<rect x="3" y="3" width="18" height="18" rx="0" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    },
    {
      id: "round-rect-fill",
      label: "Round Filled",
      icon: `<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    },
    {
      id: "oval-fill",
      label: "Oval Filled",
      icon: `<ellipse cx="12" cy="12" rx="9" ry="7" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    },
  ];

  // Gets current active sub-icon state to draw on primary toolbar strip button
  let activeShapeIcon = $derived(() => {
    const matched = shapeVariants.find((s) => s.id === doc.activeTool);
    return matched ? matched.icon : shapeVariants[0].icon;
  });

  function handleSelectStamp(type: "signature" | "initial", dataUrl: string) {
    doc.activeTool = type;
    doc.activeStampDataUrl = dataUrl;
    isMenuOpen = false;
  }

  function triggerDeletePrompt(e: MouseEvent, id: string) {
    e.stopPropagation();
    setPendingDeletion = id;
  }

  function executeDeletion() {
    if (!setPendingDeletion) return;
    doc.savedSignatureSets = doc.savedSignatureSets.filter(
      (set: any) => set.id !== setPendingDeletion,
    );
    localStorage.setItem(
      "speeddf_signature_sets",
      JSON.stringify(doc.savedSignatureSets),
    );
    if (doc.activeStampDataUrl) {
      doc.activeTool = "select";
      doc.activeStampDataUrl = null;
    }
    setPendingDeletion = null;
  }

  function startDraw(e: MouseEvent, target: "sig" | "init") {
    const canvas = target === "sig" ? sigCanvas : initCanvas;
    if (!canvas) return;
    if (target === "sig") sigDrawing = true;
    else initDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
  }

  function drawMove(e: MouseEvent, target: "sig" | "init") {
    const isDrawing = target === "sig" ? sigDrawing : initDrawing;
    const canvas = target === "sig" ? sigCanvas : initCanvas;
    if (!isDrawing || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const currentY = (e.clientY - rect.top) * (canvas.height / rect.height);
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
    lastX = currentX;
    lastY = currentY;
  }

  function stopDraw(target: "sig" | "init") {
    if (target === "sig") sigDrawing = false;
    else initDrawing = false;
  }
  function clearCanvas(target: "sig" | "init") {
    const canvas = target === "sig" ? sigCanvas : initCanvas;
    if (canvas)
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function commitNewSignatureSet() {
    if (!sigCanvas || !initCanvas) return;
    saveSignatureSetAction({
      id: crypto.randomUUID(),
      signatureDataUrl: sigCanvas.toDataURL("image/png"),
      initialDataUrl: initCanvas.toDataURL("image/png"),
    });
    isModalOpen = false;
    isMenuOpen = true;
  }
</script>

<div
  class="w-12 h-full bg-[#090d16] border-r border-slate-900 flex flex-col items-center py-4 gap-2 select-none relative z-40"
>
  <button
    onclick={() => {
      doc.activeTool = "select";
      doc.activeStampDataUrl = null;
    }}
    class="w-8 h-8 flex items-center justify-center rounded transition-all {doc.activeTool ===
    'select'
      ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30 shadow-[0_0_8px_rgba(0,210,255,0.1)]'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Select Pointer"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><polygon points="3 3 10.07 19.97 12.58 12.58 19.97 10.07 3 3" /><line
        x1="13"
        y1="13"
        x2="19"
        y2="19"
      /></svg
    >
  </button>

  <button
    onclick={() => (doc.activeTool = "text")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all {doc.activeTool ===
    'text'
      ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30 shadow-[0_0_8px_rgba(0,210,255,0.1)]'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Text Annotation"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><polyline points="4 7 4 4 20 4 20 7" /><line
        x1="9"
        y1="20"
        x2="15"
        y2="20"
      /><line x1="12" y1="4" x2="12" y2="20" /></svg
    >
  </button>

  <div class="relative flex flex-col items-center">
    <button
      onclick={() => (isShapeMenuOpen = !isShapeMenuOpen)}
      class="w-8 h-8 flex items-center justify-center rounded transition-all
        {[
        'rect',
        'round-rect',
        'oval',
        'rect-fill',
        'round-rect-fill',
        'oval-fill',
      ].includes(doc.activeTool || '') || isShapeMenuOpen
        ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30 shadow-[0_0_8px_rgba(0,210,255,0.1)]'
        : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
      title="Vector Shape Matrix"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        class="block"
      >
        {@html activeShapeIcon()}
      </svg>
    </button>

    {#if isShapeMenuOpen}
      <div
        onclick={() => (isShapeMenuOpen = false)}
        class="fixed inset-0 z-40 bg-transparent cursor-default"
      ></div>
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-14 top-0 w-44 bg-[#090d16] border border-slate-900 rounded-lg shadow-2xl p-2 flex flex-col gap-1 z-50 text-left"
      >
        <span
          class="text-[8px] font-bold tracking-widest uppercase text-slate-500 block border-b border-slate-900/40 pb-1.5 px-1"
          >Shape Tools</span
        >
        {#each shapeVariants as shape}
          <button
            onclick={() => {
              doc.activeTool = shape.id;
              isShapeMenuOpen = false;
            }}
            class="w-full px-2 py-1.5 rounded flex items-center gap-2.5 text-[10px] font-bold font-sans tracking-wide transition-colors text-left
              {doc.activeTool === shape.id
              ? 'bg-[#00d2ff]/10 text-[#00d2ff]'
              : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              class="shrink-0"
            >
              {@html shape.icon}
            </svg>
            <span>{shape.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <button
    onclick={() => (doc.activeTool = "highlight")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all {doc.activeTool ===
    'highlight'
      ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30 shadow-[0_0_8px_rgba(0,210,255,0.1)]'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Highlighter (Yellow)"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path
        d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21"
        opacity="0.4"
      /><path d="M14 10l5-5 2 2-5 5z" fill="currentColor" /></svg
    >
  </button>

  <div class="w-6 h-[1px] bg-slate-800 my-1"></div>

  <button
    onclick={() => (doc.activeTool = "tick")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all font-sans font-bold text-sm {doc.activeTool ===
    'tick'
      ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Tick Stamp">✓</button
  >

  <button
    onclick={() => (doc.activeTool = "dash")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all font-sans font-bold text-sm {doc.activeTool ===
    'dash'
      ? 'bg-[#00d2ff]/10 text-[#00d2ff] border border-[#00d2ff]/30'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Dash Stamp">—</button
  >

  <div class="w-6 h-[1px] bg-slate-800 my-1"></div>

  <button
    onclick={() => (isMenuOpen = !isMenuOpen)}
    class="w-8 h-8 flex items-center justify-center rounded transition-all relative {[
      'signature',
      'initial',
    ].includes(doc.activeTool || '') || isMenuOpen
      ? 'bg-cyan-500/10 text-[#00d2ff] border border-cyan-500/30'
      : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}"
    title="Signatures & Initials"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M12 3v7" /><path d="M16 10H8l2 5h4z" /><path
        d="m14 15-2 6-2-6z"
      /><path
        d="M3 20c3-3 5-1 8-3s4-4 8-1"
        stroke-width="1.8"
        opacity="0.9"
      /></svg
    >
    {#if isMenuOpen}
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-14 top-0 w-72 bg-[#090d16] border border-slate-900 rounded-lg shadow-2xl p-3 flex flex-col gap-2 z-50 text-left"
      >
        <span
          class="text-[9px] font-bold tracking-widest uppercase text-slate-500 block border-b border-slate-900/40 pb-1.5"
          >Saved Stamp Sets</span
        >
        <div class="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {#each doc.savedSignatureSets as set}
            <div
              class="flex items-center gap-1.5 bg-[#141b2b]/60 border border-slate-900 rounded p-1.5 hover:border-slate-800 transition-all"
            >
              <button
                onclick={() =>
                  handleSelectStamp("signature", set.signatureDataUrl)}
                class="flex-1 h-10 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                ><img
                  src={set.signatureDataUrl}
                  alt="Sig"
                  class="max-h-full max-w-full object-contain"
                /></button
              >
              <button
                onclick={() => handleSelectStamp("initial", set.initialDataUrl)}
                class="w-12 h-10 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                ><img
                  src={set.initialDataUrl}
                  alt="Init"
                  class="max-h-full max-w-full object-contain"
                /></button
              >
              <button
                onclick={(e) => triggerDeletePrompt(e, set.id)}
                class="w-7 h-10 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                ><svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  ><path d="M3 6h18" /><path
                    d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                  /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg
                ></button
              >
            </div>
          {:else}
            <div
              class="text-[10px] text-slate-600 font-medium italic text-center py-4"
            >
              No signature profiles mapped
            </div>
          {/each}
        </div>
        <button
          onclick={() => {
            isModalOpen = true;
            isMenuOpen = false;
          }}
          class="w-full mt-1 py-2 bg-slate-800/40 border border-slate-800 text-slate-300 rounded text-[10px] font-bold flex items-center justify-center gap-1.5 hover:text-white"
          ><svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            ><line x1="12" y1="5" x2="12" y2="19" /><line
              x1="5"
              y1="12"
              x2="19"
              y2="12"
            /></svg
          >Add Signature Set</button
        >
      </div>
    {/if}
  </button>

  <div class="w-6 h-[1px] bg-slate-800 my-1"></div>

  <div class="relative mt-1 flex flex-col items-center">
    <button
      onclick={() => (isColorMenuOpen = !isColorMenuOpen)}
      class="w-[18px] h-[18px] rounded-full border transition-all duration-150 cursor-pointer shadow-md flex items-center justify-center relative hover:scale-105 active:scale-95 {doc.activeColor ===
      '#000000'
        ? 'border-slate-700/80 bg-black'
        : 'border-white/20'}"
      style="background-color: {doc.activeColor};"
      title="Ink Profile: Click to change color"
    >
      {#if doc.activeColor === "#000000"}<div
          class="absolute inset-0 rounded-full border border-slate-800 pointer-events-none"
        ></div>{/if}
    </button>
    {#if isColorMenuOpen}
      <div
        onclick={() => (isColorMenuOpen = false)}
        class="fixed inset-0 z-40 bg-transparent cursor-default"
      ></div>
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-10 top-0 bg-[#090d16] border border-slate-900 rounded-lg shadow-2xl p-2 flex flex-col gap-2 z-50 text-center pointer-events-auto select-none"
      >
        <span
          class="text-[8px] font-bold tracking-widest uppercase text-slate-500 block border-b border-slate-900/40 pb-1 px-1 whitespace-nowrap"
          >Ink Color</span
        >
        <div class="flex flex-col gap-1.5 items-center px-1">
          {#each colorPalette as color}
            <button
              onclick={() => {
                doc.activeColor = color.hex;
                isColorMenuOpen = false;
              }}
              class="w-4 h-4 rounded-full border transition-all duration-150 cursor-pointer relative shadow-inner {doc.activeColor ===
              color.hex
                ? 'ring-2 ring-slate-400 scale-110 border-white'
                : 'border-slate-900/80 hover:scale-110'}"
              style="background-color: {color.hex};"
              title={color.name}
            >
              {#if color.hex === "#000000"}<div
                  class="absolute inset-0 rounded-full border border-slate-800 pointer-events-none"
                ></div>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if isModalOpen}
  <div
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
  >
    <div
      class="bg-[#090d16] border border-slate-900 rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col"
    >
      <div
        class="p-4 border-b border-slate-900/50 flex items-center justify-between bg-[#0b101c]"
      >
        <span class="text-xs font-bold tracking-wider text-slate-200 uppercase"
          >Draw Ink Profile Signoff Set</span
        >
        <button
          onclick={() => (isModalOpen = false)}
          class="text-slate-500 hover:text-white transition-colors text-xs font-bold"
          >✕</button
        >
      </div>
      <div class="p-6 grid grid-cols-3 gap-5 bg-[#080b12]">
        <div class="col-span-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between px-1">
            <span
              class="text-[9px] font-bold text-slate-500 uppercase tracking-widest"
              >Master Signature</span
            ><button
              onclick={() => clearCanvas("sig")}
              class="text-[9px] text-[#00d2ff]/70 font-bold uppercase"
              >Clear</button
            >
          </div>
          <canvas
            bind:this={sigCanvas}
            width="380"
            height="160"
            onmousedown={(e) => startDraw(e, "sig")}
            onmousemove={(e) => drawMove(e, "sig")}
            onmouseup={() => stopDraw("sig")}
            onmouseleave={() => stopDraw("sig")}
            class="w-full bg-white rounded-lg border border-slate-800/40 cursor-crosshair block"
          ></canvas>
        </div>
        <div class="col-span-1 flex flex-col gap-1.5">
          <div class="flex items-center justify-between px-1">
            <span
              class="text-[9px] font-bold text-slate-500 uppercase tracking-widest"
              >Initials</span
            ><button
              onclick={() => clearCanvas("init")}
              class="text-[9px] text-[#00d2ff]/70 font-bold uppercase"
              >Clear</button
            >
          </div>
          <canvas
            bind:this={initCanvas}
            width="170"
            height="160"
            onmousedown={(e) => startDraw(e, "init")}
            onmousemove={(e) => drawMove(e, "init")}
            onmouseup={() => stopDraw("init")}
            onmouseleave={() => stopDraw("init")}
            class="w-full bg-white rounded-lg border border-slate-800/40 cursor-crosshair block"
          ></canvas>
        </div>
      </div>
      <div
        class="p-4 border-t border-slate-900/60 flex items-center justify-end gap-2 bg-[#0b101c]"
      >
        <button
          onclick={() => (isModalOpen = false)}
          class="px-4 py-2 bg-slate-900 text-slate-400 font-bold text-[10px] rounded-md transition-colors uppercase"
          >Cancel</button
        >
        <button
          onclick={commitNewSignatureSet}
          class="px-5 py-2 bg-[#00d2ff] text-slate-950 font-bold text-[10px] rounded-md hover:bg-cyan-400 transition-colors uppercase"
          >Save Profile Combo</button
        >
      </div>
    </div>
  </div>
{/if}

{#if setPendingDeletion !== null}
  <div
    class="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
  >
    <div
      class="bg-[#0d1321] border border-slate-900 max-w-sm w-full rounded-xl shadow-2xl p-5 flex flex-col gap-4 border-t-2 border-t-red-500"
    >
      <div class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 shrink-0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            ><path
              d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
            /><line x1="12" y1="9" x2="12" y2="13" /><line
              x1="12"
              y1="17"
              x2="12.01"
              y2="17"
            /></svg
          >
        </div>
        <div class="flex flex-col gap-1">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">
            Delete Profile Set?
          </h3>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            This template will be permanently removed from disk.
          </p>
        </div>
      </div>
      <div
        class="flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-wider mt-1"
      >
        <button
          onclick={() => (setPendingDeletion = null)}
          class="px-3 py-1.5 bg-slate-900 text-slate-400 rounded-md"
          >Cancel</button
        >
        <button
          onclick={executeDeletion}
          class="px-3 py-1.5 bg-red-600 text-white rounded-md shadow-lg"
          >Delete</button
        >
      </div>
    </div>
  </div>
{/if}
