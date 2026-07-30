<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    activeDoc,
    saveSignatureSetAction,
    updateSignatureSetAction,
    type SignatureSet,
  } from "../pdfStore.svelte";
  import {
    initialsFromName,
    setCommentAuthorProfile,
    signatureSetLabel,
  } from "../lib/comments/comments";

  // ⚡ FIXED: This explicitly sets up the missing property mapping for line 118 in +page.svelte
  let { zoomScale = $bindable() }: { zoomScale: number } = $props();

  const doc = activeDoc as any;

  let isMenuOpen = $state(false);
  let isModalOpen = $state(false);
  /** When set, modal is editing this set id instead of creating a new one. */
  let editingSetId = $state<string | null>(null);
  let profileFirstName = $state("");
  let profileLastName = $state("");
  let profileEmail = $state("");
  let profileFormError = $state("");
  let isColorMenuOpen = $state(false);
  let isShapeMenuOpen = $state(false);
  let isThicknessMenuOpen = $state(false);
  let isTextMenuOpen = $state(false);
  let setPendingDeletion = $state<string | null>(null);

  let sigCanvas = $state<HTMLCanvasElement | null>(null);
  let initCanvas = $state<HTMLCanvasElement | null>(null);

  let sigDrawing = false;
  let initDrawing = false;
  let lastX = 0;
  let lastY = 0;

  let customColor = $state('#22d3ee'); // Default cyan accent
  let globalOpacity = $state(100);    // Default 100% solid

  $effect(() => {
    const activeColor = doc.activeColor || '#000000';
    untrack(() => {
      const hex = activeColor.startsWith('#') ? activeColor : `#${activeColor}`;
      if (hex.length === 9) { // #RRGGBBAA is 9 characters (including #)
        const colorPart = hex.substring(0, 7);
        const alphaPart = hex.substring(7, 9);
        if (customColor !== colorPart) {
          customColor = colorPart;
        }
        const opacityVal = Math.round((parseInt(alphaPart, 16) / 255) * 100);
        if (globalOpacity !== opacityVal) {
          globalOpacity = opacityVal;
        }
      } else if (hex.length === 7) {
        if (customColor !== hex) {
          customColor = hex;
        }
        if (globalOpacity !== 100) {
          globalOpacity = 100;
        }
      }
    });
  });

  $effect(() => {
    const colorHex = customColor;
    const opacityVal = globalOpacity;
    untrack(() => {
      const alphaInt = Math.round((opacityVal / 100) * 255);
      const alphaHex = alphaInt.toString(16).padStart(2, '0');
      const hexPrefix = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
      const targetColor = `${hexPrefix}${alphaHex}`.toLowerCase();
      if ((doc.activeColor || '').toLowerCase() !== targetColor) {
        doc.activeColor = targetColor;
      }
    });
  });

  $effect(() => {
    const sel = doc.selectedShape;
    if (sel) {
      const shape = doc.shapes[sel.pageNumber]?.[sel.index];
      if (shape) {
        untrack(() => {
          if (shape.color && doc.activeColor !== shape.color) {
            doc.activeColor = shape.color;
          }
          if (shape.thickness && doc.activeThickness !== shape.thickness) {
            doc.activeThickness = shape.thickness;
          }
          if (shape.lineStyle && doc.activeLineStyle !== shape.lineStyle) {
            doc.activeLineStyle = shape.lineStyle;
          }
          if (shape.lineEnds && doc.activeLineEnds !== shape.lineEnds) {
            doc.activeLineEnds = shape.lineEnds;
          }
          if (shape.fontFamily && doc.activeFontFamily !== shape.fontFamily) {
            doc.activeFontFamily = shape.fontFamily;
          }
          if (shape.alignment && doc.activeTextAlignment !== shape.alignment) {
            doc.activeTextAlignment = shape.alignment;
          }
        });
      }
    }
  });

  const colorPalette = [
    { name: "Black", hex: "#000000" },
    { name: "Cyan", hex: "#00d2ff" },
    { name: "Red", hex: "#ef4444" },
    { name: "Green", hex: "#22c55e" },
    { name: "Yellow", hex: "#ffea00" },
    { name: "White", hex: "#ffffff" },
  ];

  const thicknessOptions = [1, 3, 5, 8, 12];

  const shapeVariants = [
    {
      id: "rect",
      label: "Box Outline",
    },
    {
      id: "oval",
      label: "Oval Outline",
    },
    {
      id: "rect-fill",
      label: "Box Filled",
    },
    {
      id: "oval-fill",
      label: "Oval Filled",
    },
  ];

  let activeShapeId = $derived(() => {
    const matched = shapeVariants.find((s) => s.id === doc.activeTool);
    return matched ? matched.id : shapeVariants[0].id;
  });

  function handleSelectStamp(
    type: "signature" | "initial",
    dataUrl: string,
    set?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      initials?: string;
      label?: string;
    },
  ) {
    doc.activeTool = type;
    doc.activeStampDataUrl = dataUrl;
    // Activate this profile as the comment author when the set has identity fields
    if (set && (set.initials || set.firstName || set.lastName)) {
      const fullName =
        `${set.firstName || ""} ${set.lastName || ""}`.trim() ||
        set.label?.replace(/:$/, "") ||
        set.initials ||
        "You";
      setCommentAuthorProfile({
        initials: set.initials || initialsFromName(set.firstName || "", set.lastName || ""),
        fullName,
        email: set.email,
      });
    }
    isMenuOpen = false;
  }

  function resetProfileForm() {
    editingSetId = null;
    profileFirstName = "";
    profileLastName = "";
    profileEmail = "";
    profileFormError = "";
  }

  function paintDataUrlOnCanvas(
    canvas: HTMLCanvasElement,
    dataUrl: string | undefined | null,
  ): Promise<void> {
    return new Promise((resolve) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve();
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!dataUrl) {
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  async function openSignatureModal() {
    resetProfileForm();
    isModalOpen = true;
    isMenuOpen = false;
    await tick();
    clearCanvas("sig");
    clearCanvas("init");
  }

  async function openEditSignatureModal(e: MouseEvent, set: SignatureSet) {
    e.stopPropagation();
    editingSetId = set.id;
    profileFormError = "";

    // Prefer explicit fields; fall back to parsing "First Last:" labels on legacy sets
    let first = (set.firstName || "").trim();
    let last = (set.lastName || "").trim();
    if (!first && !last && set.label) {
      const bare = set.label.replace(/:$/, "").trim();
      if (bare && bare.toLowerCase() !== "untitled") {
        const parts = bare.split(/\s+/).filter(Boolean);
        first = parts[0] || "";
        last = parts.slice(1).join(" ");
      }
    }
    profileFirstName = first;
    profileLastName = last;
    profileEmail = (set.email || "").trim();

    isModalOpen = true;
    isMenuOpen = false;
    await tick();
    if (sigCanvas && initCanvas) {
      await Promise.all([
        paintDataUrlOnCanvas(sigCanvas, set.signatureDataUrl),
        paintDataUrlOnCanvas(initCanvas, set.initialDataUrl),
      ]);
    }
  }

  let previewInitials = $derived(
    initialsFromName(profileFirstName, profileLastName),
  );
  let previewLabel = $derived(
    signatureSetLabel(profileFirstName, profileLastName),
  );

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

  function startDraw(e: PointerEvent, target: "sig" | "init") {
    e.preventDefault();
    const canvas = target === "sig" ? sigCanvas : initCanvas;
    if (!canvas) return;
    if (target === "sig") sigDrawing = true;
    else initDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
  }

  function drawMove(e: PointerEvent, target: "sig" | "init") {
    e.preventDefault();
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

  function validateSignatureCanvases(): boolean {
    return !!sigCanvas && !!initCanvas;
  }

  function extractSignatureData(): { signatureDataUrl: string; initialDataUrl: string } {
    if (!sigCanvas || !initCanvas) {
      throw new Error("Signature canvases are not initialized.");
    }
    return {
      signatureDataUrl: sigCanvas.toDataURL("image/png"),
      initialDataUrl: initCanvas.toDataURL("image/png"),
    };
  }

  function commitSignatureSet() {
    if (!validateSignatureCanvases()) return;
    const firstName = profileFirstName.trim();
    const lastName = profileLastName.trim();
    if (!firstName || !lastName) {
      profileFormError = "First and last name are required.";
      return;
    }
    profileFormError = "";
    try {
      const data = extractSignatureData();
      const initials = initialsFromName(firstName, lastName);
      const label = signatureSetLabel(firstName, lastName);
      const email = profileEmail.trim() || undefined;
      const payload: SignatureSet = {
        id: editingSetId || crypto.randomUUID(),
        signatureDataUrl: data.signatureDataUrl,
        initialDataUrl: data.initialDataUrl,
        firstName,
        lastName,
        email,
        label,
        initials,
      };
      if (editingSetId) {
        updateSignatureSetAction(payload);
      } else {
        saveSignatureSetAction(payload);
      }
      resetProfileForm();
      clearCanvas("sig");
      clearCanvas("init");
      isModalOpen = false;
      isMenuOpen = true;
    } catch (e) {
      console.error("Failed to commit signature set:", e);
    }
  }
</script>

<div
  class="w-12 h-full border-r flex flex-col items-center py-4 gap-2 select-none relative z-40"
  style="background: var(--sdf-bg-app); border-color: var(--sdf-border-subtle);"
>
  <button
    onclick={() => {
      doc.activeTool = "select";
      doc.activeStampDataUrl = null;
    }}
    class="w-8 h-8 flex items-center justify-center rounded transition-all"
    style={doc.activeTool === 'select'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
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

  <div class="relative flex flex-col items-center">
    <button
      onclick={(e) => {
        e.stopPropagation();
        isColorMenuOpen = false;
        isShapeMenuOpen = false;
        isThicknessMenuOpen = false;
        isMenuOpen = false;
        isTextMenuOpen = false;
        doc.activeTool = "text";
      }}
      class="w-8 h-8 flex items-center justify-center rounded transition-all"
      style={doc.activeTool === 'text'
        ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
        : 'color: var(--sdf-text-secondary);'}
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
  </div>

  <div class="h-px w-6 mx-auto my-1 pointer-events-auto" style="background: var(--sdf-border);"></div>

  <button
    onclick={() => (doc.activeTool = "pen")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all"
    style={doc.activeTool === 'pen'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    title="Pen"
  >
    <svg viewBox="0 0 24 24" class="w-[14px] h-[14px] fill-none stroke-current" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
      <path d="M2 2l7.586 7.586"></path>
      <circle cx="11" cy="11" r="2"></circle>
    </svg>
  </button>

  <div class="relative flex flex-col items-center">
    <button
      onclick={(e) => {
        e.stopPropagation();
        isColorMenuOpen = false;
        isMenuOpen = false;
        isThicknessMenuOpen = false;
        isShapeMenuOpen = !isShapeMenuOpen;
      }}
      class="w-8 h-8 flex items-center justify-center rounded transition-all"
      style={['rect', 'oval', 'rect-fill', 'oval-fill'].includes(doc.activeTool || '') || isShapeMenuOpen
        ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
        : 'color: var(--sdf-text-secondary);'}
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
        {#if activeShapeId() === "rect"}
          <rect x="3" y="3" width="18" height="18" rx="0" fill="none" stroke="currentColor" stroke-width="2.5"/>
        {:else if activeShapeId() === "oval"}
          <ellipse cx="12" cy="12" rx="9" ry="7" fill="none" stroke="currentColor" stroke-width="2.5"/>
        {:else if activeShapeId() === "rect-fill"}
          <rect x="3" y="3" width="18" height="18" rx="0" fill="currentColor" stroke="currentColor" stroke-width="1"/>
        {:else if activeShapeId() === "oval-fill"}
          <ellipse cx="12" cy="12" rx="9" ry="7" fill="currentColor" stroke="currentColor" stroke-width="1"/>
        {/if}
      </svg>
    </button>

    {#if isShapeMenuOpen}
      <div
        onclick={() => (isShapeMenuOpen = false)}
        class="fixed inset-0 z-40 bg-transparent cursor-default"
      ></div>
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-14 top-0 w-44 rounded-lg shadow-2xl p-2 flex flex-col gap-1 z-50 text-left backdrop-blur-md"
        style="background: var(--sdf-bg-chrome); border: 1px solid var(--sdf-border);"
      >
        <span
          class="text-[8px] font-bold tracking-widest uppercase block pb-1.5 px-1"
          style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);"
          >Shape Tools</span
        >
        {#each shapeVariants as shape}
          <button
            onclick={() => {
              doc.activeTool = shape.id;
              isShapeMenuOpen = false;
            }}
            class="w-full px-2 py-1.5 rounded flex items-center gap-2.5 text-[10px] font-bold font-sans tracking-wide transition-colors text-left"
            style={doc.activeTool === shape.id
              ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);'
              : 'color: var(--sdf-text-secondary);'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              class="shrink-0"
            >
              {#if shape.id === "rect"}
                <rect x="3" y="3" width="18" height="18" rx="0" fill="none" stroke="currentColor" stroke-width="2.5"/>
              {:else if shape.id === "oval"}
                <ellipse cx="12" cy="12" rx="9" ry="7" fill="none" stroke="currentColor" stroke-width="2.5"/>
              {:else if shape.id === "rect-fill"}
                <rect x="3" y="3" width="18" height="18" rx="0" fill="currentColor" stroke="currentColor" stroke-width="1"/>
              {:else if shape.id === "oval-fill"}
                <ellipse cx="12" cy="12" rx="9" ry="7" fill="currentColor" stroke="currentColor" stroke-width="1"/>
              {/if}
            </svg>
            <span>{shape.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <button
    onclick={() => (doc.activeTool = "line")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all"
    style={doc.activeTool === 'line'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    title="Line (click start, click end)"
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
    >
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  </button>

  <button
    onclick={() => (doc.activeTool = "highlight")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all"
    style={doc.activeTool === 'highlight'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    title="Highlighter (Yellow)"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m9 11-6 6v3h9l3-3"/>
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
    </svg>
  </button>

  <div class="w-6 h-[1px] my-1" style="background: var(--sdf-border);"></div>

  <button
    onclick={() => (doc.activeTool = "tick")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all font-sans font-bold text-sm"
    style={doc.activeTool === 'tick'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    title="Tick Stamp">✓</button
  >

  <button
    onclick={() => (doc.activeTool = "dash")}
    class="w-8 h-8 flex items-center justify-center rounded transition-all font-sans font-bold text-sm"
    style={doc.activeTool === 'dash'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    title="Dash Stamp">—</button
  >

  <div class="w-6 h-[1px] my-1" style="background: var(--sdf-border);"></div>

  <div class="relative flex flex-col items-center">
    <button
      onclick={(e) => {
        e.stopPropagation();
        isColorMenuOpen = false;
        isShapeMenuOpen = false;
        isThicknessMenuOpen = false;
        isMenuOpen = !isMenuOpen;
      }}
      class="w-8 h-8 flex items-center justify-center rounded transition-all relative"
      style={['signature', 'initial'].includes(doc.activeTool || '') || isMenuOpen
        ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
        : 'color: var(--sdf-text-secondary);'}
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
      >
        <path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284"/>
        <path d="M3 21h18"/>
      </svg>
    </button>
    {#if isMenuOpen}
      <div
        onclick={() => (isMenuOpen = false)}
        class="fixed inset-0 z-40 bg-transparent cursor-default"
      ></div>
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-14 top-0 w-72 border rounded-lg shadow-2xl p-3 flex flex-col gap-2 z-50 text-left"
        style="background: var(--sdf-bg-app); border-color: var(--sdf-border-subtle);"
      >
        <span
          class="text-[9px] font-bold tracking-widest uppercase block pb-1.5"
          style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);"
          >Saved Stamp Sets</span
        >
        <div class="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {#each doc.savedSignatureSets || [] as set}
            <div
              class="flex flex-col gap-1 rounded p-1.5 transition-all"
              style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border-subtle);"
            >
              {#if set.label || set.firstName || set.lastName}
                <div class="flex items-center justify-between gap-1 px-0.5">
                  <span
                    class="text-[9px] font-semibold truncate"
                    style="color: var(--sdf-text-secondary);"
                    title={set.email || set.label || ""}
                  >
                    {set.label ||
                      signatureSetLabel(set.firstName || "", set.lastName || "")}
                  </span>
                  {#if set.initials}
                    <span class="text-[8px] font-mono font-bold text-cyan-500/80 shrink-0">{set.initials}</span>
                  {/if}
                </div>
              {/if}
              <div class="flex items-center gap-1.5">
                <button
                  onclick={() =>
                    handleSelectStamp("signature", set.signatureDataUrl, set)}
                  class="flex-1 h-10 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                  ><img
                    src={set.signatureDataUrl}
                    alt="Sig"
                    class="max-h-full max-w-full object-contain"
                  /></button
                >
                <button
                  onclick={() =>
                    handleSelectStamp("initial", set.initialDataUrl, set)}
                  class="w-12 h-10 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                  ><img
                    src={set.initialDataUrl}
                    alt="Init"
                    class="max-h-full max-w-full object-contain"
                  /></button
                >
                <button
                  onclick={(e) => openEditSignatureModal(e, set)}
                  class="w-7 h-10 rounded flex items-center justify-center text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                  title="Edit profile set"
                  ><svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M12 20h9" /><path
                      d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                    /></svg
                  ></button
                >
                <button
                  onclick={(e) => triggerDeletePrompt(e, set.id)}
                  class="w-7 h-10 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete profile set"
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
            </div>
          {:else}
            <div
              class="text-[10px] font-medium italic text-center py-4"
              style="color: var(--sdf-text-faint);"
            >
              No signature profiles mapped
            </div>
          {/each}
        </div>
        <button
          onclick={openSignatureModal}
          class="w-full mt-1 py-2 rounded text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors"
          style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border); color: var(--sdf-text-secondary);"
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
  </div>

  <div class="w-6 h-[1px] my-1" style="background: var(--sdf-border);"></div>

  <div class="relative mt-1 flex flex-col items-center">
    <button
      onclick={(e) => {
        e.stopPropagation();
        isShapeMenuOpen = false;
        isMenuOpen = false;
        isThicknessMenuOpen = false;
        isColorMenuOpen = !isColorMenuOpen;
      }}
      class="w-[18px] h-[18px] rounded-full border transition-all duration-150 cursor-pointer shadow-md flex items-center justify-center relative hover:scale-105 active:scale-95 {(doc.activeColor || '').substring(0, 7) ===
      '#000000'
        ? 'border-slate-700/80 bg-black'
        : 'border-white/20'}"
      style="background-color: {doc.activeColor};"
      title="Ink Profile: Click to change color"
    >
      {#if (doc.activeColor || '').substring(0, 7) === "#000000"}<div
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
        class="absolute z-[100] mt-2 p-3 rounded-lg shadow-2xl w-72 backdrop-blur-md left-10 top-0 text-left pointer-events-auto select-none"
        style="background: var(--sdf-bg-chrome); border: 1px solid var(--sdf-border); color: var(--sdf-text-primary);"
      >
        <span
          class="text-[8px] font-bold tracking-widest uppercase block pb-1.5 px-1 whitespace-nowrap mb-2"
          style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);"
          >Ink Color</span
        >
        <div class="flex items-center gap-1.5 px-1">
          {#each colorPalette as color}
            <button
              onclick={() => {
                doc.activeColor = color.hex;
                isColorMenuOpen = false;
              }}
              class="w-4 h-4 rounded-full border transition-all duration-150 cursor-pointer relative shadow-inner {(doc.activeColor || '').substring(0, 7) ===
              color.hex
                ? 'ring-2 ring-slate-400 scale-110 border-white'
                : 'hover:scale-110'}"
              style="background-color: {color.hex}; border-color: var(--sdf-border);"
              title={color.name}
            >
              {#if color.hex === "#000000"}<div
                  class="absolute inset-0 rounded-full border pointer-events-none"
                  style="border-color: var(--sdf-border);"
                ></div>{/if}
            </button>
          {/each}

          <div class="flex items-center gap-3 pl-2 ml-1" style="border-left: 1px solid var(--sdf-border);">
            <div 
              class="relative w-6 h-6 rounded-full border shadow-md group hover:scale-105 transition-transform cursor-pointer"
              style="background-color: {customColor}; border-color: var(--sdf-border);"
              title="Choose Custom Color"
            >
              <input 
                type="color" 
                bind:value={customColor}
                oninput={() => {
                  const alphaInt = Math.round((globalOpacity / 100) * 255);
                  const alphaHex = alphaInt.toString(16).padStart(2, '0');
                  const colorHex = customColor.startsWith('#') ? customColor : `#${customColor}`;
                  doc.activeColor = `${colorHex}${alphaHex}`.toLowerCase();
                }}
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div class="flex flex-col gap-0.5 w-24">
              <div class="flex justify-between items-center text-[10px] font-mono select-none" style="color: var(--sdf-text-muted);">
                <span>Opacity</span>
                <span style="color: var(--sdf-text-secondary);">{globalOpacity}%</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="100" 
                step="5"
                bind:value={globalOpacity}
                oninput={() => {
                  const alphaInt = Math.round((globalOpacity / 100) * 255);
                  const alphaHex = alphaInt.toString(16).padStart(2, '0');
                  const colorHex = customColor.startsWith('#') ? customColor : `#${customColor}`;
                  doc.activeColor = `${colorHex}${alphaHex}`.toLowerCase();
                }}
                class="w-full h-1 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all"
                style="background: var(--sdf-bg-surface);"
              />
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="relative flex flex-col items-center">
    <button
      onclick={(e) => {
        e.stopPropagation();
        isColorMenuOpen = false;
        isShapeMenuOpen = false;
        isMenuOpen = false;
        isThicknessMenuOpen = !isThicknessMenuOpen;
      }}
      class="w-6 h-6 flex items-center justify-center transition-all bg-transparent pointer-events-auto relative overflow-hidden group/thickness hover:scale-110 active:scale-95"
      title="Line Thickness"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        class="text-slate-400 group-hover/thickness:text-white transition-colors"
      >
        <line x1="3" y1="6" x2="21" y2="6" stroke-width="1.5" />
        <line x1="3" y1="12" x2="21" y2="12" stroke-width="3" />
        <line x1="3" y1="18" x2="21" y2="18" stroke-width="5.5" />
      </svg>
    </button>

    {#if isThicknessMenuOpen}
      <div
        onclick={() => (isThicknessMenuOpen = false)}
        class="fixed inset-0 z-40 bg-transparent cursor-default"
      ></div>
      <div
        onclick={(e) => e.stopPropagation()}
        class="absolute left-10 top-0 flex gap-4 p-3 rounded-lg shadow-2xl z-50 pointer-events-auto backdrop-blur-md select-none"
        style="background: var(--sdf-bg-chrome); border: 1px solid var(--sdf-border); color: var(--sdf-text-primary);"
      >
        <!-- Column 1: Thickness -->
        <div class="flex flex-col gap-2 min-w-[48px]">
          <span class="text-[8px] font-bold uppercase tracking-wider text-center pb-1" style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);">Size</span>
          {#each thicknessOptions as thick}
            <button
              onclick={(e) => {
                e.stopPropagation();
                doc.activeThickness = thick;
              }}
              class="w-full flex items-center justify-center py-2 cursor-pointer rounded transition-colors"
              style={doc.activeThickness === thick ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);' : 'color: var(--sdf-text-secondary);'}
              title="{thick}px"
            >
              <div class="w-8 rounded-full transition-colors" style="height: {thick}px; background-color: {doc.activeThickness === thick ? 'var(--sdf-accent)' : 'var(--sdf-text-muted)'};"></div>
            </button>
          {/each}
        </div>

        <!-- Vertical Divider -->
        <div class="w-[1px]" style="background: var(--sdf-border-subtle);"></div>

        <!-- Column 2: Line Style -->
        <div class="flex flex-col gap-2 min-w-[80px]">
          <span class="text-[8px] font-bold uppercase tracking-wider text-center pb-1" style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);">Style</span>
          {#each [
            { id: "solid", name: "Solid", dash: "none" },
            { id: "dashed", name: "Dashed", dash: "6,6" },
            { id: "dotted", name: "Dotted", dash: "2,4" },
            { id: "dash-dot", name: "Dash-Dot", dash: "6,3,2,3" }
          ] as style}
            <button
              onclick={(e) => {
                e.stopPropagation();
                doc.activeLineStyle = style.id;
              }}
              class="w-full flex flex-col items-center justify-center py-1.5 px-2 cursor-pointer rounded transition-colors"
              style={doc.activeLineStyle === style.id ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);' : 'color: var(--sdf-text-secondary);'}
              title={style.name}
            >
              <span class="text-[8px] font-medium tracking-wide mb-1 font-sans">{style.name}</span>
              <svg width="48" height="6" class="overflow-visible">
                <line 
                  x1="0" 
                  y1="3" 
                  x2="48" 
                  y2="3" 
                  stroke={doc.activeLineStyle === style.id ? 'var(--sdf-accent)' : 'currentColor'} 
                  stroke-width="2.5" 
                  stroke-linecap="round"
                  stroke-dasharray={style.dash} 
                />
              </svg>
            </button>
          {/each}
        </div>

        <!-- Vertical Divider -->
        <div class="w-[1px]" style="background: var(--sdf-border-subtle);"></div>

        <!-- Column 3: Line ends (arrows) -->
        <div class="flex flex-col gap-2 min-w-[80px]">
          <span class="text-[8px] font-bold uppercase tracking-wider text-center pb-1" style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);">Ends</span>
          {#each [
            { id: "plain", name: "Plain" },
            { id: "end", name: "End arrow" },
            { id: "both", name: "Start + End" },
          ] as ends}
            <button
              onclick={(e) => {
                e.stopPropagation();
                doc.activeLineEnds = ends.id;
              }}
              class="w-full flex flex-col items-center justify-center py-1.5 px-2 cursor-pointer rounded transition-colors"
              style={doc.activeLineEnds === ends.id ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);' : 'color: var(--sdf-text-secondary);'}
              title={ends.name}
            >
              <span class="text-[8px] font-medium tracking-wide mb-1 font-sans">{ends.name}</span>
              <svg width="48" height="12" class="overflow-visible" viewBox="0 0 48 12">
                <line
                  x1="4"
                  y1="6"
                  x2={ends.id === "plain" ? 44 : 38}
                  y2="6"
                  stroke={doc.activeLineEnds === ends.id ? 'var(--sdf-accent)' : 'currentColor'}
                  stroke-width="2.5"
                  stroke-linecap="round"
                />
                {#if ends.id === "end" || ends.id === "both"}
                  <polygon
                    points="44,6 36,2.5 36,9.5"
                    fill={doc.activeLineEnds === ends.id ? 'var(--sdf-accent)' : 'currentColor'}
                  />
                {/if}
                {#if ends.id === "both"}
                  <polygon
                    points="4,6 12,2.5 12,9.5"
                    fill={doc.activeLineEnds === ends.id ? 'var(--sdf-accent)' : 'currentColor'}
                  />
                {/if}
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="w-6 h-[1px] my-1" style="background: var(--sdf-border);"></div>

  <button
    type="button"
    class="w-8 h-8 flex items-center justify-center rounded transition-all"
    style={doc.activeTool === 'snapshot'
      ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent); border: 1px solid var(--sdf-accent-border);'
      : 'color: var(--sdf-text-secondary);'}
    onclick={() => doc.activeTool = doc.activeTool === 'snapshot' ? 'select' : 'snapshot'}
    title="Take Selection Snapshot (Copy region to clipboard)"
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
      class="lucide lucide-camera"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
      <circle cx="12" cy="13" r="3"/>
    </svg>
  </button>
</div>

{#if isModalOpen}
  <div
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
    onclick={(e) => e.stopPropagation()}
  >
    <div
      class="border rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col"
      style="background: var(--sdf-bg-app); border-color: var(--sdf-border-subtle);"
      onclick={(e) => e.stopPropagation()}
    >
      <div
        class="p-4 border-b flex items-center justify-between"
        style="border-color: var(--sdf-border-subtle); background: var(--sdf-bg-chrome);"
      >
        <span class="text-xs font-bold tracking-wider uppercase" style="color: var(--sdf-text-primary);"
          >{editingSetId ? "Edit Ink Profile Signoff Set" : "Draw Ink Profile Signoff Set"}</span
        >
        <button
          onclick={() => {
            resetProfileForm();
            isModalOpen = false;
          }}
          class="transition-colors text-xs font-bold"
          style="color: var(--sdf-text-muted);"
          >✕</button
        >
      </div>
      <div class="p-6 grid grid-cols-3 gap-5" style="background: var(--sdf-bg-surface);">
        <div class="col-span-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between px-1">
            <span
              class="text-[9px] font-bold text-slate-500 uppercase tracking-widest"
              >Master Signature</span
            ><button
              onclick={(e) => { e.stopPropagation(); clearCanvas("sig"); }}
              class="text-[9px] text-[#00d2ff]/70 font-bold uppercase"
              >Clear</button
            >
          </div>
          <canvas
            bind:this={sigCanvas}
            width="380"
            height="160"
            onclick={(e) => e.stopPropagation()}
            onpointerdown={(e) => { e.stopPropagation(); startDraw(e, "sig"); }}
            onpointermove={(e) => { e.stopPropagation(); drawMove(e, "sig"); }}
            onpointerup={() => stopDraw("sig")}
            onpointerleave={() => stopDraw("sig")}
            class="w-full bg-white rounded-lg border border-slate-800/40 cursor-crosshair block touch-none"
          ></canvas>
        </div>
        <div class="col-span-1 flex flex-col gap-1.5">
          <div class="flex items-center justify-between px-1">
            <span
              class="text-[9px] font-bold text-slate-500 uppercase tracking-widest"
              >Initials</span
            ><button
              onclick={(e) => { e.stopPropagation(); clearCanvas("init"); }}
              class="text-[9px] text-[#00d2ff]/70 font-bold uppercase"
              >Clear</button
            >
          </div>
          <canvas
            bind:this={initCanvas}
            width="170"
            height="160"
            onclick={(e) => e.stopPropagation()}
            onpointerdown={(e) => { e.stopPropagation(); startDraw(e, "init"); }}
            onpointermove={(e) => { e.stopPropagation(); drawMove(e, "init"); }}
            onpointerup={() => stopDraw("init")}
            onpointerleave={() => stopDraw("init")}
            class="w-full bg-white rounded-lg border border-slate-800/40 cursor-crosshair block touch-none"
          ></canvas>
        </div>
      </div>

      <!-- Profile identity fields -->
      <div class="px-6 pb-5 flex flex-col gap-3" style="background: var(--sdf-bg-surface);">
        <div class="flex items-center justify-between px-0.5">
          <span class="text-[9px] font-bold uppercase tracking-widest" style="color: var(--sdf-text-muted);"
            >Profile identity</span
          >
          <span class="text-[9px] font-mono" style="color: var(--sdf-text-muted);">
            {#if profileFirstName.trim() || profileLastName.trim()}
              <span class="font-bold" style="color: var(--sdf-accent);">{previewInitials}</span>
              <span class="mx-1" style="color: var(--sdf-border);">·</span>
              <span style="color: var(--sdf-text-secondary);">{previewLabel}</span>
            {:else}
              Initials auto from name
            {/if}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-[9px] font-bold uppercase tracking-wider px-0.5" style="color: var(--sdf-text-muted);"
              >First name <span class="text-red-400/80">*</span></span
            >
            <input
              type="text"
              bind:value={profileFirstName}
              autocomplete="given-name"
              placeholder="First name"
              class="rounded-md px-2.5 py-1.5 text-[11px] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 font-sans"
              style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[9px] font-bold uppercase tracking-wider px-0.5" style="color: var(--sdf-text-muted);"
              >Last name <span class="text-red-400/80">*</span></span
            >
            <input
              type="text"
              bind:value={profileLastName}
              autocomplete="family-name"
              placeholder="Last name"
              class="rounded-md px-2.5 py-1.5 text-[11px] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 font-sans"
              style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
            />
          </label>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-[9px] font-bold uppercase tracking-wider px-0.5" style="color: var(--sdf-text-muted);"
            >Email <span class="normal-case tracking-normal font-medium" style="color: var(--sdf-text-faint);">(optional)</span></span
          >
          <input
            type="email"
            bind:value={profileEmail}
            autocomplete="email"
            placeholder="email@example.com"
            class="rounded-md px-2.5 py-1.5 text-[11px] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 font-sans"
            style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
          />
        </label>
        {#if profileFormError}
          <p class="text-[10px] text-red-400 font-medium px-0.5">{profileFormError}</p>
        {/if}
      </div>

      <div
        class="p-4 border-t flex items-center justify-end gap-2"
        style="border-color: var(--sdf-border-subtle); background: var(--sdf-bg-chrome);"
      >
        <button
          onclick={() => {
            resetProfileForm();
            isModalOpen = false;
          }}
          class="px-4 py-2 font-bold text-[10px] rounded-md transition-colors uppercase"
          style="background: var(--sdf-bg-surface); color: var(--sdf-text-secondary);"
          >Cancel</button
        >
        <button
          onclick={commitSignatureSet}
          class="px-5 py-2 font-bold text-[10px] rounded-md transition-colors uppercase"
          style="background: var(--sdf-accent); color: var(--sdf-bg-app);"
          >{editingSetId ? "Update Profile Combo" : "Save Profile Combo"}</button
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
      class="border max-w-sm w-full rounded-xl shadow-2xl p-5 flex flex-col gap-4 border-t-2 border-t-red-500"
      style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border-subtle);"
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
          <h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--sdf-text-primary);">
            Delete Profile Set?
          </h3>
          <p class="text-[11px] leading-relaxed" style="color: var(--sdf-text-secondary);">
            This template will be permanently removed from disk.
          </p>
        </div>
      </div>
      <div
        class="flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-wider mt-1"
      >
        <button
          onclick={() => (setPendingDeletion = null)}
          class="px-3 py-1.5 rounded-md"
          style="background: var(--sdf-bg-surface); color: var(--sdf-text-secondary);"
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

<svelte:window
  onclick={() => {
    isMenuOpen = false;
    isModalOpen = false;
    isColorMenuOpen = false;
    isShapeMenuOpen = false;
    isThicknessMenuOpen = false;
    setPendingDeletion = null;
  }}
/>
