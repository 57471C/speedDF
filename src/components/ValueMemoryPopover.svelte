<script lang="ts">
  /**
   * Lightweight “remembered values” autocomplete for text / form fields.
   * Portaled to body so page overflow:hidden does not clip it.
   * Only opens after 2+ characters (starts-with, case-insensitive).
   * Keyboard: ArrowDown/ArrowUp to highlight, Enter to apply.
   */
  import {
    clearAllFormMemory,
    getSuggestions,
    rememberFormValue,
    removeFormValue,
    valueIsRemembered,
  } from "../lib/forms/formMemory.svelte";
  import { MIN_SUGGESTION_QUERY_LEN } from "../lib/forms/formMemory";

  let {
    open = false,
    anchorEl = null as HTMLElement | null,
    /** Memory keys for this field (specific first, then type). */
    memoryKeys = [] as string[],
    currentValue = "",
    onSelect,
    onClose,
  }: {
    open?: boolean;
    anchorEl?: HTMLElement | null;
    memoryKeys?: string[];
    currentValue?: string;
    onSelect: (value: string) => void;
    /** Called when user clicks outside (hide popdown without applying). */
    onClose?: () => void;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);
  let pos = $state({ top: 0, left: 0, width: 220 });
  /** -1 = none highlighted yet (Down Arrow starts at 0). */
  let highlightIdx = $state(-1);

  const trimmed = $derived(currentValue.replace(/\s+/g, " ").trim());
  const queryReady = $derived(trimmed.length >= MIN_SUGGESTION_QUERY_LEN);
  const suggestions = $derived(
    open && queryReady ? getSuggestions(memoryKeys, trimmed) : [],
  );
  const alreadySaved = $derived(
    trimmed ? valueIsRemembered(trimmed, memoryKeys) : true,
  );
  const canRemember = $derived(queryReady && trimmed.length > 0 && !alreadySaved);
  /** Modern autocomplete: only after 2+ chars, and only if there is something useful to show. */
  const showPanel = $derived(
    open && queryReady && (suggestions.length > 0 || canRemember),
  );

  // Reset highlight when the suggestion list changes
  $effect(() => {
    void suggestions;
    highlightIdx = -1;
  });

  function portal(node: HTMLElement) {
    // Move immediately so the panel never participates in the field’s layout
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  function place() {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const width = Math.max(200, Math.min(320, Math.max(r.width, 160)));
    let left = r.left;
    let top = r.bottom + 4;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    // Prefer below the field; flip above only if it would clip the viewport
    if (panelEl) {
      const h = panelEl.getBoundingClientRect().height;
      if (top + h > window.innerHeight - 8 && r.top - h - 4 > 8) {
        top = r.top - h - 4;
      }
    }
    pos = { top, left, width };
  }

  /**
   * Keep the panel glued to the anchor bottom while it grows (newlines /
   * auto-expand) or the page scrolls/zooms. Re-run when value changes so
   * layout that hasn't hit ResizeObserver yet still updates after Enter.
   */
  $effect(() => {
    if (!showPanel || !anchorEl) return;
    // Track typed content so Enter/newlines re-place even mid-layout
    void currentValue;

    place();
    const onScroll = () => place();
    const onResize = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    // Anchor size changes (textarea auto-grow / annotation box height %)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => place());
      ro.observe(anchorEl);
      // Parent host often owns the % height; observe it too when present
      const host = anchorEl.parentElement;
      if (host) ro.observe(host);
    }

    // After panel paints, re-measure (height flip above/below)
    const raf = requestAnimationFrame(() => place());

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  });

  // Hide when pointer goes outside the field + panel
  $effect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelEl && panelEl.contains(t)) return;
      if (anchorEl && anchorEl.contains(t)) return;
      onClose?.();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  });

  // Keyboard navigation while the autocomplete list is visible
  $effect(() => {
    if (!showPanel || suggestions.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        highlightIdx =
          highlightIdx < 0
            ? 0
            : Math.min(highlightIdx + 1, suggestions.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (highlightIdx <= 0) {
          highlightIdx = -1;
        } else {
          highlightIdx = highlightIdx - 1;
        }
      } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
          e.preventDefault();
          e.stopPropagation();
          pick(suggestions[highlightIdx]);
        }
        // else: let Enter insert a newline in the textarea
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        highlightIdx = -1;
        onClose?.();
      }
    };
    // Capture so we win over page-level shortcuts when a row is active
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  function pick(value: string) {
    highlightIdx = -1;
    onSelect(value);
    onClose?.();
  }

  function onRemember(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!canRemember) return;
    rememberFormValue(trimmed, memoryKeys);
  }

  function onRemove(e: MouseEvent, value: string) {
    e.preventDefault();
    e.stopPropagation();
    removeFormValue(value);
  }

  function onClearAll(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    clearAllFormMemory();
  }

  /** Keep focus on the input so field blur does not fire while using the menu. */
  function keepFocus(e: MouseEvent) {
    e.preventDefault();
  }
</script>

{#if showPanel}
  <div
    use:portal
    bind:this={panelEl}
    class="value-memory-popover fixed z-[220] pointer-events-auto"
    style="top: {pos.top}px; left: {pos.left}px; width: {pos.width}px;"
    role="listbox"
    aria-label="Remembered values"
    aria-activedescendant={highlightIdx >= 0 ? `mem-opt-${highlightIdx}` : undefined}
    onmousedown={keepFocus}
  >
    <div
      class="rounded-md border shadow-xl shadow-black/40 backdrop-blur-sm overflow-hidden"
      style="background: color-mix(in srgb, var(--sdf-bg-chrome) 97%, transparent); border-color: var(--sdf-border);"
    >
      {#if suggestions.length > 0}
        <ul class="max-h-40 overflow-y-auto py-0.5">
          {#each suggestions as item, i (item)}
            <li class="group flex items-stretch">
              <button
                type="button"
                id="mem-opt-{i}"
                role="option"
                aria-selected={highlightIdx === i}
                class="flex-1 min-w-0 text-left px-2.5 py-1.5 text-[11px] truncate font-sans transition-colors"
                style="{highlightIdx === i
                  ? 'background: var(--sdf-accent-bg); color: var(--sdf-text-primary);'
                  : 'color: var(--sdf-text-secondary);'}"
                title={item}
                onmousedown={keepFocus}
                onmouseenter={() => (highlightIdx = i)}
                onclick={() => pick(item)}
              >
                {item}
              </button>
              <button
                type="button"
                class="shrink-0 px-2 text-[11px] text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-70 group-hover:opacity-100"
                title="Remove remembered value"
                aria-label="Remove {item}"
                onmousedown={keepFocus}
                onclick={(e) => onRemove(e, item)}
              >
                ×
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div
        class="flex items-center gap-1 border-t px-1.5 py-1"
        style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-surface) 80%, transparent);"
        class:border-t-0={suggestions.length === 0}
      >
        <button
          type="button"
          class="flex-1 min-w-0 text-left px-1.5 py-1 rounded text-[10px] font-semibold tracking-wide transition-colors
            {canRemember
              ? 'text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300'
              : 'text-slate-600 cursor-default'}"
          disabled={!canRemember}
          title={canRemember
            ? "Save this value for quick fill later"
            : alreadySaved
              ? "Already remembered"
              : "Type at least 2 characters to remember"}
          onmousedown={keepFocus}
          onclick={onRemember}
        >
          {canRemember
            ? "★ Remember this value"
            : alreadySaved && trimmed
              ? "★ Saved"
              : "★ Remember this value"}
        </button>
        {#if suggestions.length > 0}
          <button
            type="button"
            class="shrink-0 px-1.5 py-1 rounded text-[9px] font-medium text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
            title="Clear all remembered values"
            onmousedown={keepFocus}
            onclick={onClearAll}
          >
            Clear all
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
