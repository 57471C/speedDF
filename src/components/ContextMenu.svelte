<script lang="ts">
  let {
    x = 0,
    y = 0,
    show = $bindable(false),
    onOpen,
    onSave,
    onSaveAs,
  }: {
    x?: number;
    y?: number;
    show: boolean;
    onOpen: () => void;
    onSave: () => void;
    onSaveAs: () => void;
  } = $props();
</script>

{#if show}
  <div
    class="fixed bg-zinc-900 border border-zinc-700 text-zinc-200 py-1.5 rounded-lg shadow-xl min-w-[180px] z-[99999] select-none text-sm font-sans"
    style="top: {y}px; left: {x}px;"
  >
    <button
      onclick={onOpen}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit"
    >
      <span>Open Document</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+O</span>
    </button>
    <button
      onclick={onSave}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit"
    >
      <span>Save</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+S</span>
    </button>
    <button
      onclick={onSaveAs}
      class="w-full text-left px-4 py-2 hover:bg-zinc-800 transition flex justify-between items-center bg-transparent border-0 cursor-pointer text-inherit border-b border-zinc-800 pb-2 mb-1"
    >
      <span>Save As...</span>
      <span class="text-xs text-zinc-500 font-mono">Ctrl+Shift+S</span>
    </button>
    <div class="px-4 py-1.5 text-xs text-zinc-500 italic">speedDF v0.8.0</div>
  </div>
{/if}
