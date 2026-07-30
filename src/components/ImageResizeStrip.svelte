<script lang="ts">
  /**
   * Thin control strip under title bar + tab strip for image documents only.
   * Width / Height / Scale (%) with aspect-ratio lock (on by default).
   * Stacks above the floating text-style toolbar (Workspace.svelte) when both show.
   */
  import { onMount } from "svelte";
  import { activeDoc, applyImageResizeAction } from "../pdfStore.svelte";
  import {
    clampScale,
    computeLinkedResize,
    SCALE_PRESETS,
    type ImageResizeState,
  } from "../lib/annotation/imageResize";

  let lockAspect = $state(true);
  let widthInput = $state(0);
  let heightInput = $state(0);
  /** Displayed scale % (may be 100 at native; typed/preset values clamp 1–99). */
  let scaleInput = $state(100);
  let applying = $state(false);
  let showScaleDropdown = $state(false);
  let scaleFieldRef = $state<HTMLDivElement | null>(null);
  /** Suppress feedback loops while syncing from document dimensions. */
  let syncing = false;

  const isImageDoc = $derived(activeDoc.fileType === "image");

  const nativeW = $derived(
    activeDoc.imageNativeWidth ||
      activeDoc.current?.cachedDimensions?.[0]?.width ||
      0,
  );
  const nativeH = $derived(
    activeDoc.imageNativeHeight ||
      activeDoc.current?.cachedDimensions?.[0]?.height ||
      0,
  );
  const currentW = $derived(
    activeDoc.current?.cachedDimensions?.[0]?.width || nativeW || 0,
  );
  const currentH = $derived(
    activeDoc.current?.cachedDimensions?.[0]?.height || nativeH || 0,
  );

  // Keep inputs in sync when the active image doc / dimensions change
  $effect(() => {
    if (!isImageDoc) return;
    const w = currentW;
    const h = currentH;
    const nw = Math.max(1, nativeW || w || 1);
    if (w <= 0 || h <= 0) return;
    syncing = true;
    widthInput = w;
    heightInput = h;
    scaleInput = Math.round((w / nw) * 100 * 100) / 100;
    syncing = false;
  });

  onMount(() => {
    const onDocPointer = (e: PointerEvent) => {
      if (!showScaleDropdown || !scaleFieldRef) return;
      if (!scaleFieldRef.contains(e.target as Node)) {
        showScaleDropdown = false;
      }
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    return () => document.removeEventListener("pointerdown", onDocPointer, true);
  });

  function applyLinked(
    field: "width" | "height" | "scale",
    raw: number,
  ): ImageResizeState {
    const nw = Math.max(1, nativeW || widthInput || 1);
    const nh = Math.max(1, nativeH || heightInput || 1);
    return computeLinkedResize(
      field,
      raw,
      lockAspect,
      { nativeWidth: nw, nativeHeight: nh },
      {
        width: widthInput || nw,
        height: heightInput || nh,
        scale: scaleInput || 100,
      },
    );
  }

  function setFromLinked(next: ImageResizeState) {
    widthInput = next.width;
    heightInput = next.height;
    scaleInput = next.scale;
  }

  function parsePx(raw: string): number | null {
    const cleaned = raw.replace(/[^\d]/g, "");
    if (!cleaned) return null;
    const val = parseInt(cleaned, 10);
    return Number.isFinite(val) ? val : null;
  }

  function onWidthInput(e: Event) {
    if (syncing) return;
    const val = parsePx((e.target as HTMLInputElement).value);
    if (val == null) return;
    setFromLinked(applyLinked("width", val));
  }

  function onHeightInput(e: Event) {
    if (syncing) return;
    const val = parsePx((e.target as HTMLInputElement).value);
    if (val == null) return;
    setFromLinked(applyLinked("height", val));
  }

  function onScaleInput(e: Event) {
    if (syncing) return;
    const raw = (e.target as HTMLInputElement).value.replace(/[^\d]/g, "");
    (e.target as HTMLInputElement).value = raw;
    if (!raw) return;
    const val = clampScale(parseInt(raw, 10));
    setFromLinked(applyLinked("scale", val));
  }

  function selectScalePreset(pct: number) {
    const val = clampScale(pct);
    setFromLinked(applyLinked("scale", val));
    showScaleDropdown = false;
    void commitResize();
  }

  async function commitResize() {
    if (!isImageDoc || applying) return;
    // Clamp scale field if user left a value outside 1–99 after typing
    if (scaleInput < 1 || scaleInput > 99) {
      // Only force-clamp when they intentionally edited scale toward a resize;
      // at native 100% leave W/H alone unless dimensions changed.
      if (scaleInput !== 100 && scaleInput > 0) {
        const clamped = clampScale(scaleInput);
        setFromLinked(applyLinked("scale", clamped));
      }
    }
    const w = Math.round(widthInput);
    const h = Math.round(heightInput);
    if (w < 1 || h < 1) return;
    if (w === currentW && h === currentH) return;
    applying = true;
    try {
      await applyImageResizeAction(w, h);
    } finally {
      applying = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      showScaleDropdown = false;
      void commitResize();
      (e.target as HTMLElement)?.blur?.();
    } else if (e.key === "Escape") {
      showScaleDropdown = false;
    }
  }

  function onScaleBlur() {
    // Delay so preset button click can fire first
    setTimeout(() => {
      if (showScaleDropdown) return;
      void commitResize();
    }, 120);
  }

  function toggleLock() {
    lockAspect = !lockAspect;
  }
</script>

{#if isImageDoc && (nativeW > 0 || currentW > 0)}
  <div
    class="image-resize-strip fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl flex items-center gap-3 select-none pointer-events-auto transition-all duration-200"
    role="toolbar"
    aria-label="Image resize"
  >
    <div
      class="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase pr-3" style="color: var(--sdf-text-secondary); border-right: 1px solid var(--sdf-border);"
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
        class="text-cyan-400"
      >
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
      <span>Resize</span>
    </div>

    <div class="flex items-center gap-1.5">
      <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide"
        >W</span
      >
      <input
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        value={widthInput}
        oninput={onWidthInput}
        onchange={() => void commitResize()}
        onkeydown={onKeyDown}
        disabled={applying}
        class="resize-px-input"
        title="Width (px)"
        aria-label="Width in pixels"
      />
      <span class="text-[10px]" style="color: var(--sdf-text-muted);">px</span>
    </div>

    <div class="flex items-center gap-1.5 pl-3" style="border-left: 1px solid var(--sdf-border);">
      <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide"
        >H</span
      >
      <input
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        value={heightInput}
        oninput={onHeightInput}
        onchange={() => void commitResize()}
        onkeydown={onKeyDown}
        disabled={applying}
        class="resize-px-input"
        title="Height (px)"
        aria-label="Height in pixels"
      />
      <span class="text-[10px]" style="color: var(--sdf-text-muted);">px</span>
    </div>

    <div class="flex items-center gap-1.5 pl-3" style="border-left: 1px solid var(--sdf-border);">
      <span class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--sdf-text-muted);"
        >Scale</span
      >
      <div class="relative flex items-center" bind:this={scaleFieldRef}>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          value={scaleInput}
          oninput={onScaleInput}
          onfocus={() => (showScaleDropdown = true)}
          onblur={onScaleBlur}
          onkeydown={onKeyDown}
          disabled={applying}
          class="resize-scale-input"
          title="Scale 1–99% of original"
          aria-label="Scale percent"
          aria-expanded={showScaleDropdown}
          aria-haspopup="listbox"
        />
        <button
          type="button"
          tabindex="-1"
          onclick={(e) => {
            e.stopPropagation();
            showScaleDropdown = !showScaleDropdown;
          }}
          disabled={applying}
          class="resize-scale-caret"
          aria-label="Scale presets"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            class="transition-transform duration-200 {showScaleDropdown
              ? 'rotate-180'
              : ''}"
            ><polyline points="6 9 12 15 18 9"></polyline></svg
          >
        </button>

        {#if showScaleDropdown}
          <div
            class="resize-scale-menu absolute top-full left-0 mt-1 z-50"
            role="listbox"
            aria-label="Scale presets"
          >
            {#each SCALE_PRESETS as pct}
              <button
                type="button"
                role="option"
                aria-selected={scaleInput === pct}
                onclick={() => selectScalePreset(pct)}
                class="resize-scale-option {scaleInput === pct
                  ? 'is-active'
                  : ''}"
              >
                {pct}%
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="text-[10px]" style="color: var(--sdf-text-muted);">%</span>
    </div>

    <div class="flex items-center pl-3" style="border-left: 1px solid var(--sdf-border);">
      <button
        type="button"
        onclick={toggleLock}
        disabled={applying}
        class="resize-lock-btn {lockAspect ? 'is-locked' : ''}"
        title={lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked"}
        aria-pressed={lockAspect}
        aria-label="Toggle aspect ratio lock"
      >
        {#if lockAspect}
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
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        {:else}
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
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
          </svg>
        {/if}
      </button>
    </div>

    {#if applying}
      <span class="text-[10px] font-mono pl-1" style="color: var(--sdf-text-muted);">…</span>
    {/if}
  </div>
{/if}

<style>
  /* Force dark chrome so OS light-mode form controls never flash white */
  .image-resize-strip {
    color-scheme: dark;
    background: color-mix(in srgb, var(--sdf-bg-app) 95%, transparent);
    border: 1px solid var(--sdf-border);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .resize-px-input,
  .resize-scale-input {
    color-scheme: dark;
    background-color: var(--sdf-bg-input);
    color: var(--sdf-text-primary);
    border: 1px solid var(--sdf-border);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-align: center;
    outline: none;
    width: 4rem;
    transition: border-color 0.15s ease;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .resize-px-input:focus,
  .resize-scale-input:focus {
    border-color: var(--sdf-accent);
  }

  .resize-px-input:disabled,
  .resize-scale-input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .resize-px-input::-webkit-outer-spin-button,
  .resize-px-input::-webkit-inner-spin-button,
  .resize-scale-input::-webkit-outer-spin-button,
  .resize-scale-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .resize-scale-input {
    width: 3.25rem;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    padding-right: 0.25rem;
  }

  .resize-scale-caret {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 1.75rem;
    padding: 0 0.35rem;
    background-color: var(--sdf-bg-input);
    color: var(--sdf-text-secondary);
    border: 1px solid var(--sdf-border);
    border-left: none;
    border-radius: 0 0.25rem 0.25rem 0;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .resize-scale-caret:hover:not(:disabled) {
    color: var(--sdf-text-primary);
  }

  .resize-scale-caret:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .resize-scale-menu {
    min-width: 3.5rem;
    max-height: 12rem;
    overflow-y: auto;
    background-color: var(--sdf-bg-input);
    border: 1px solid var(--sdf-border);
    border-radius: 0.375rem;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
    color-scheme: dark;
  }

  .resize-scale-option {
    display: block;
    width: 100%;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-align: center;
    color: var(--sdf-text-secondary);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--sdf-border-subtle);
    cursor: pointer;
    transition:
      color 0.12s ease,
      background-color 0.12s ease;
  }

  .resize-scale-option:last-child {
    border-bottom: none;
  }

  .resize-scale-option:hover,
  .resize-scale-option.is-active {
    color: var(--sdf-text-primary);
    background-color: var(--sdf-hover-bg);
  }

  .resize-lock-btn {
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    background-color: var(--sdf-bg-input);
    color: var(--sdf-text-muted);
    border: 1px solid var(--sdf-border);
    transition:
      color 0.15s ease,
      background-color 0.15s ease,
      border-color 0.15s ease;
  }

  .resize-lock-btn:hover:not(:disabled) {
    color: var(--sdf-text-secondary);
  }

  .resize-lock-btn.is-locked {
    background-color: rgba(6, 182, 212, 0.12);
    color: #22d3ee;
    border-color: rgba(6, 182, 212, 0.4);
  }

  .resize-lock-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
