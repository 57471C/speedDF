<script lang="ts">
  let {
    x = 0,
    y = 0,
    show = $bindable(false),
    showAddComment = false,
    onOpen,
    onSave,
    onSaveAs,
    onAddComment,
    onOpenCalculator,
    onOpenTimer,
    onOpenStopwatch,
    onOpenMagic8Ball,
  }: {
    x?: number;
    y?: number;
    show: boolean;
    /** When true, show "Add Comment Here" (right-click landed on a document page). */
    showAddComment?: boolean;
    onOpen: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onAddComment?: () => void;
    onOpenCalculator?: () => void;
    onOpenTimer?: () => void;
    onOpenStopwatch?: () => void;
    onOpenMagic8Ball?: () => void;
  } = $props();

  function openTool(fn?: () => void) {
    show = false;
    fn?.();
  }

  /** Match ToolSidebar idle/hover chrome for icon buttons. */
  const iconBtn =
    "w-8 h-8 flex items-center justify-center rounded transition-all text-slate-400 hover:bg-slate-800/50 hover:text-white bg-transparent border-0 cursor-pointer";
</script>

{#if show}
  <div
    class="fixed bg-zinc-900 border border-zinc-700 text-zinc-200 py-1.5 rounded-lg shadow-xl min-w-[200px] z-[99999] select-none text-sm font-sans"
    style="top: {y}px; left: {x}px;"
    role="menu"
  >
    {#if showAddComment && onAddComment}
      <button
        type="button"
        onclick={onAddComment}
        class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit border-b border-zinc-800 pb-2 mb-1"
        role="menuitem"
      >
        <span class="flex items-center gap-2">
          <span class="text-amber-400" aria-hidden="true">⚑</span>
          Add Comment Here
        </span>
      </button>
    {/if}
    <button
      type="button"
      onclick={onOpen}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit"
      role="menuitem"
    >
      <span>Open Document</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+O</span>
    </button>
    <button
      type="button"
      onclick={onSave}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit"
      role="menuitem"
    >
      <span>Save</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+S</span>
    </button>
    <button
      type="button"
      onclick={onSaveAs}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit"
      role="menuitem"
    >
      <span>Save As...</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+Shift+S</span>
    </button>

    <!-- Quick tools: lucide-style icons (replaces version footer) -->
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
        <!-- lucide: calculator -->
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
          aria-hidden="true"
        >
          <rect width="16" height="20" x="4" y="2" rx="2" />
          <line x1="8" x2="16" y1="6" y2="6" />
          <line x1="16" x2="16" y1="14" y2="18" />
          <path d="M16 10h.01" />
          <path d="M12 10h.01" />
          <path d="M8 10h.01" />
          <path d="M12 14h.01" />
          <path d="M8 14h.01" />
          <path d="M12 18h.01" />
          <path d="M8 18h.01" />
        </svg>
      </button>

      <button
        type="button"
        class={iconBtn}
        title="Timer"
        aria-label="Timer"
        onclick={() => openTool(onOpenTimer)}
      >
        <!-- lucide: timer -->
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
          aria-hidden="true"
        >
          <line x1="10" x2="14" y1="2" y2="2" />
          <line x1="12" x2="15" y1="14" y2="11" />
          <circle cx="12" cy="14" r="8" />
        </svg>
      </button>

      <button
        type="button"
        class={iconBtn}
        title="Stopwatch"
        aria-label="Stopwatch"
        onclick={() => openTool(onOpenStopwatch)}
      >
        <!-- lucide-style stopwatch (timer + crown) -->
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
          aria-hidden="true"
        >
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2" />
          <path d="M5 4 7.5 6.5" />
          <path d="M19 4 16.5 6.5" />
          <path d="M12 5V3" />
          <path d="M10 3h4" />
        </svg>
      </button>

      <button
        type="button"
        class={iconBtn}
        title="Magic 8 Ball"
        aria-label="Magic 8 Ball"
        onclick={() => openTool(onOpenMagic8Ball)}
      >
        <!-- Mini 8-ball icon -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.9" />
          <circle cx="12" cy="12" r="4.2" fill="#0ea5e9" />
          <text
            x="12"
            y="13.5"
            text-anchor="middle"
            font-size="6"
            font-weight="700"
            font-family="system-ui, sans-serif"
            fill="white"
          >8</text>
        </svg>
      </button>
    </div>
  </div>
{/if}
