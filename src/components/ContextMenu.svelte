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
  } = $props();
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
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit border-b border-zinc-800 pb-2 mb-1"
      role="menuitem"
    >
      <span>Save As...</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+Shift+S</span>
    </button>
    <div class="px-4 py-1.5 text-xs text-zinc-500 italic">speedDF v1.0.7</div>
  </div>
{/if}
