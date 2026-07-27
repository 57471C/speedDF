<script lang="ts">
  let {
    x = 0,
    y = 0,
    show = $bindable(false),
    showAddComment = false,
    /** When true, show the richer selection-aware menu. */
    hasTextSelection = false,
    /** When true, selection is on PDF text layer (annotation actions apply). */
    canAnnotateSelection = false,
    /** Truncated label for “Search for …” (optional). */
    selectionPreview = "",
    onAddComment,
    onCopy,
    onCut,
    onPaste,
    onSelectAll,
    onHighlightSelection,
    onUnderlineSelection,
    onStrikethroughSelection,
    onCommentOnSelection,
    onSearchSelection,
    onOpenCalculator,
    onOpenTimer,
    onOpenStopwatch,
    onOpenMagic8Ball,
    onOpenScratchPad,
  }: {
    x?: number;
    y?: number;
    show: boolean;
    showAddComment?: boolean;
    hasTextSelection?: boolean;
    canAnnotateSelection?: boolean;
    selectionPreview?: string;
    onAddComment?: () => void;
    onCopy?: () => void;
    onCut?: () => void;
    onPaste?: () => void;
    onSelectAll?: () => void;
    onHighlightSelection?: () => void;
    onUnderlineSelection?: () => void;
    onStrikethroughSelection?: () => void;
    onCommentOnSelection?: () => void;
    onSearchSelection?: () => void;
    onOpenCalculator?: () => void;
    onOpenTimer?: () => void;
    onOpenStopwatch?: () => void;
    onOpenMagic8Ball?: () => void;
    onOpenScratchPad?: () => void;
  } = $props();

  function openTool(fn?: () => void) {
    show = false;
    fn?.();
  }

  function runAction(fn?: () => void) {
    show = false;
    fn?.();
  }

  const iconBtn =
    "w-8 h-8 flex items-center justify-center rounded transition-all text-slate-400 hover:bg-slate-800/50 hover:text-white bg-transparent border-0 cursor-pointer";

  const rowBtn =
    "w-full text-left px-4 py-1.5 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit text-[13px]";

  const searchLabel = $derived.by(() => {
    const t = (selectionPreview || "").trim();
    if (!t) return "Search for selection";
    const short = t.length > 24 ? `${t.slice(0, 24)}…` : t;
    return `Search for “${short}”`;
  });
</script>

{#if show}
  <div
    class="fixed bg-zinc-900 border border-zinc-700 text-zinc-200 py-1.5 rounded-lg shadow-xl min-w-[220px] max-w-[280px] z-[99999] select-none text-sm font-sans"
    style="top: {y}px; left: {x}px;"
    role="menu"
  >
    {#if hasTextSelection}
      <!-- Selection-aware menu -->
      <button type="button" onclick={() => runAction(onCopy)} class={rowBtn} role="menuitem">
        <span>Copy</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+C</span>
      </button>
      <button type="button" onclick={() => runAction(onCut)} class={rowBtn} role="menuitem">
        <span>Cut</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+X</span>
      </button>
      <button type="button" onclick={() => runAction(onPaste)} class={rowBtn} role="menuitem">
        <span>Paste</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+V</span>
      </button>
      <button type="button" onclick={() => runAction(onSelectAll)} class={rowBtn} role="menuitem">
        <span>Select All</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+A</span>
      </button>

      {#if canAnnotateSelection}
        <div class="border-t border-zinc-800 my-1" role="separator"></div>

        <button
          type="button"
          onclick={() => runAction(onHighlightSelection)}
          class={rowBtn}
          role="menuitem"
        >
          <span class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-sm bg-yellow-300/80" aria-hidden="true"></span>
            Highlight Selection
          </span>
        </button>
        <button
          type="button"
          onclick={() => runAction(onUnderlineSelection)}
          class={rowBtn}
          role="menuitem"
        >
          <span class="underline decoration-cyan-400/80">Underline Selection</span>
        </button>
        <button
          type="button"
          onclick={() => runAction(onStrikethroughSelection)}
          class={rowBtn}
          role="menuitem"
        >
          <span class="line-through decoration-zinc-400">Strikethrough Selection</span>
        </button>
        <button
          type="button"
          onclick={() => runAction(onCommentOnSelection)}
          class={rowBtn}
          role="menuitem"
        >
          <span class="flex items-center gap-2">
            <span class="text-amber-400" aria-hidden="true">⚑</span>
            Add Comment on Selection
          </span>
        </button>
      {/if}
      <button
        type="button"
        onclick={() => runAction(onSearchSelection)}
        class="{rowBtn} truncate"
        role="menuitem"
        title={searchLabel}
      >
        <span class="truncate pr-2">{searchLabel}</span>
      </button>
    {:else}
      <!-- Simple menu (no text selection) -->
      {#if showAddComment && onAddComment}
        <button
          type="button"
          onclick={() => runAction(onAddComment)}
          class="{rowBtn} border-b border-zinc-800 pb-2 mb-1"
          role="menuitem"
        >
          <span class="flex items-center gap-2">
            <span class="text-amber-400" aria-hidden="true">⚑</span>
            Add Comment Here
          </span>
        </button>
      {/if}

      <button type="button" onclick={() => runAction(onCopy)} class={rowBtn} role="menuitem">
        <span>Copy</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+C</span>
      </button>
      <button type="button" onclick={() => runAction(onPaste)} class={rowBtn} role="menuitem">
        <span>Paste</span>
        <span class="text-xs text-zinc-500 font-mono">Ctrl+V</span>
      </button>
    {/if}

    <!-- Quick tools row (both states) -->
    <div
      class="flex items-center justify-center gap-1.5 px-3 pt-2 pb-1 mt-1 border-t border-zinc-800"
      role="group"
      aria-label="Quick tools"
    >
      <button
        type="button"
        class={iconBtn}
        title="Calculator"
        aria-label="Calculator"
        onclick={() => openTool(onOpenCalculator)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect width="16" height="20" x="4" y="2" rx="2" /><line x1="8" x2="16" y1="6" y2="6" /><line x1="16" x2="16" y1="14" y2="18" />
          <path d="M16 10h.01" /><path d="M12 10h.01" /><path d="M8 10h.01" /><path d="M12 14h.01" /><path d="M8 14h.01" /><path d="M12 18h.01" /><path d="M8 18h.01" />
        </svg>
      </button>
      <button type="button" class={iconBtn} title="Timer" aria-label="Timer" onclick={() => openTool(onOpenTimer)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />
        </svg>
      </button>
      <button type="button" class={iconBtn} title="Stopwatch" aria-label="Stopwatch" onclick={() => openTool(onOpenStopwatch)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 4 7.5 6.5" /><path d="M19 4 16.5 6.5" /><path d="M12 5V3" /><path d="M10 3h4" />
        </svg>
      </button>
      <button type="button" class={iconBtn} title="Magic 8 Ball" aria-label="Magic 8 Ball" onclick={() => openTool(onOpenMagic8Ball)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.9" />
          <circle cx="12" cy="12" r="4.2" fill="#0ea5e9" />
          <text x="12" y="13.5" text-anchor="middle" font-size="6" font-weight="700" font-family="system-ui, sans-serif" fill="white">8</text>
        </svg>
      </button>
      <button type="button" class={iconBtn} title="Scratch Pad" aria-label="Scratch Pad" onclick={() => openTool(onOpenScratchPad)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
          <path d="M15 3v6h6" /><path d="M10 16h4" /><path d="M10 12h4" /><path d="M8 16h.01" /><path d="M8 12h.01" />
        </svg>
      </button>
    </div>
  </div>
{/if}
