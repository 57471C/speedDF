<script lang="ts">
  /**
   * Multi-document tab bar (Phase 2 polish):
   * - Scrollable tabs with active/dirty polish
   * - Pointer-based drag-reorder (reliable in WebView2; no HTML5 DnD forbidden cursor)
   * - Ctrl+Tab / Ctrl+Shift+Tab
   * - Recent dropdown on the LEFT; Close-all overflow on the RIGHT
   */
  import { onMount } from "svelte";
  import {
    activeDoc,
    switchActiveDocument,
    cycleActiveDocument,
    reorderOpenDocuments,
    documentKey,
    type DocumentWorkspace,
  } from "../pdfStore.svelte";

  type RecentItem = {
    name: string;
    path: string;
    thumbnail?: string;
    timestamp?: number;
  };

  let {
    onRequestClose,
    onRequestCloseAll,
    recentFiles = [],
    fileStatusMap = {},
    onOpenRecent,
  }: {
    onRequestClose: (docId: string) => void;
    onRequestCloseAll: () => void;
    recentFiles?: RecentItem[];
    /** path → exists on disk; missing keys treated as available */
    fileStatusMap?: Record<string, boolean>;
    onOpenRecent?: (name: string, path: string) => void;
  } = $props();

  let tabStrip = $state<HTMLDivElement | null>(null);
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);
  let isDragging = $state(false);
  let suppressClick = false;
  let showRecentMenu = $state(false);
  let showOverflowMenu = $state(false);
  let recentMenuEl = $state<HTMLDivElement | null>(null);

  function docId(doc: DocumentWorkspace): string {
    return documentKey(doc);
  }

  function shortName(name: string): string {
    if (!name) return "Untitled";
    const base = name.split(/[/\\]/).pop() || name;
    return base.length > 28 ? base.slice(0, 25) + "…" : base;
  }

  /** Recents not already open as a tab (by path). Unavailable files stay listed. */
  let availableRecents = $derived.by(() => {
    const openPaths = new Set(
      activeDoc.openDocuments
        .map((d) => (d.filePath || "").toLowerCase())
        .filter(Boolean),
    );
    return (recentFiles || [])
      .filter((r) => r.path && !openPaths.has(r.path.toLowerCase()))
      .slice(0, 12);
  });

  function scrollActiveTabIntoView() {
    if (!tabStrip) return;
    const active = tabStrip.querySelector(
      '[role="tab"][aria-selected="true"]',
    ) as HTMLElement | null;
    active?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  $effect(() => {
    void activeDoc.activeDocumentId;
    void activeDoc.openDocuments.length;
    requestAnimationFrame(scrollActiveTabIntoView);
  });

  function tabIndexFromPoint(clientX: number, clientY: number): number | null {
    const el = document.elementFromPoint(clientX, clientY);
    const tab = el?.closest?.("[data-tab-index]") as HTMLElement | null;
    if (!tab) return null;
    const idx = parseInt(tab.getAttribute("data-tab-index") || "-1", 10);
    return idx >= 0 ? idx : null;
  }

  function onTabPointerDown(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    // Never start a drag from the close control
    if (t.closest("button")) return;

    dragFromIndex = index;
    dragOverIndex = index;
    isDragging = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onTabPointerMove(e: PointerEvent) {
    if (dragFromIndex === null) return;

    // Require a small movement threshold before treating as drag
    if (!isDragging) {
      isDragging = true;
    }

    const over = tabIndexFromPoint(e.clientX, e.clientY);
    if (over === null || over === dragFromIndex) {
      dragOverIndex = over;
      return;
    }

    reorderOpenDocuments(dragFromIndex, over);
    dragFromIndex = over;
    dragOverIndex = over;
  }

  function onTabPointerUp(e: PointerEvent, index: number) {
    const wasDragging = isDragging;
    if (dragFromIndex !== null) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    dragFromIndex = null;
    dragOverIndex = null;
    isDragging = false;

    if (wasDragging) {
      // Prevent the synthetic click that would re-switch after a reorder
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      return;
    }

    // Plain click → activate
    if (!suppressClick) {
      const id = docId(activeDoc.openDocuments[index]);
      if (id) switchActiveDocument(id);
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      if (activeDoc.openDocuments.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      cycleActiveDocument(e.shiftKey ? -1 : 1);
    }
  }

  function handleDocumentClick(e: MouseEvent) {
    const t = e.target as Node;
    if (showRecentMenu && recentMenuEl && !recentMenuEl.contains(t)) {
      showRecentMenu = false;
    }
    if (showOverflowMenu) {
      const menu = document.getElementById("doc-tabs-overflow-menu");
      const btn = document.getElementById("doc-tabs-overflow-btn");
      if (menu && !menu.contains(t) && btn && !btn.contains(t)) {
        showOverflowMenu = false;
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeydown, { capture: true });
    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown, {
        capture: true,
      } as EventListenerOptions);
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  });
</script>

{#if activeDoc.openDocuments.length > 0}
  <div
    class="w-full shrink-0 flex items-stretch border-b select-none"
    style="background: var(--sdf-bg-app); border-color: var(--sdf-border-subtle);"
  >
    <!-- LEFT: Recent documents -->
    <div
      class="flex items-center shrink-0 border-r bg-transparent px-1 relative"
      style="border-color: var(--sdf-border-subtle);"
      bind:this={recentMenuEl}
    >
      <button
        type="button"
        class="h-7 px-2.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
        style={showRecentMenu
          ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);'
          : 'color: var(--sdf-text-muted);'}
        title="Open from Recent"
        onclick={() => {
          showRecentMenu = !showRecentMenu;
          showOverflowMenu = false;
        }}
      >
        Recent
      </button>

      {#if showRecentMenu}
        <div
          class="absolute left-0 top-full mt-1 z-[80] w-64 max-h-72 overflow-y-auto rounded-lg border shadow-2xl py-1"
          style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border);"
        >
          <div
            class="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest font-sans"
            style="color: var(--sdf-text-muted); border-bottom: 1px solid var(--sdf-border-subtle);"
          >
            Recent documents
          </div>
          {#if availableRecents.length === 0}
            <div class="px-3 py-4 text-[11px] text-center" style="color: var(--sdf-text-faint);">
              No other recent files
            </div>
          {:else}
            {#each availableRecents as rec}
              {@const exists = fileStatusMap[rec.path] !== false}
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
                  {exists
                    ? 'hover:bg-slate-900/80 cursor-pointer'
                    : 'opacity-45 cursor-default'}"
                aria-disabled={!exists}
                onclick={() => {
                  if (!exists) return;
                  showRecentMenu = false;
                  onOpenRecent?.(rec.name, rec.path);
                }}
                title={exists ? rec.path : "File unavailable on disk"}
              >
                {#if rec.thumbnail}
                  <img
                    src={rec.thumbnail}
                    alt=""
                    class="w-8 h-10 object-cover rounded shrink-0 {exists
                      ? ''
                      : 'grayscale brightness-75'}"
                    style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border-subtle);"
                  />
                {:else}
                  <div
                    class="w-8 h-10 rounded shrink-0 flex items-center justify-center text-[10px]"
                    style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border-subtle); color: var(--sdf-text-faint);"
                  >
                    📄
                  </div>
                {/if}
                <div class="min-w-0 flex-1">
                  <div
                    class="text-[11px] font-medium truncate"
                    style="color: {exists ? 'var(--sdf-text-primary)' : 'var(--sdf-text-muted)'};"
                  >
                    {rec.name}
                  </div>
                  <div class="text-[9px] truncate" style="color: var(--sdf-text-faint);">
                    {exists ? rec.path : "Unavailable"}
                  </div>
                </div>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- CENTER: Scrollable tab strip -->
    <div
      bind:this={tabStrip}
      class="doc-tab-strip flex-1 min-w-0 flex items-stretch overflow-x-auto overflow-y-hidden"
      role="tablist"
      aria-label="Open documents"
    >
      {#each activeDoc.openDocuments as doc, index (docId(doc))}
        {@const id = docId(doc)}
        {@const isActive = activeDoc.activeDocumentId === id}
        {@const isDragSource = dragFromIndex === index}
        {@const isDragOver = dragOverIndex === index && dragFromIndex !== index}
        <div
          role="tab"
          data-tab-index={index}
          aria-selected={isActive}
          tabindex="0"
          class="doc-tab group relative flex items-center gap-1.5 max-w-[200px] min-w-[110px] px-3 py-1.5 border-r cursor-grab active:cursor-grabbing transition-colors shrink-0 touch-none"
          style="border-color: var(--sdf-border-subtle); {isActive ? 'background: var(--sdf-bg-elevated); color: var(--sdf-text-primary); box-shadow: inset 0 -2px 0 0 var(--sdf-accent);' : 'color: var(--sdf-text-muted);'} {isDragOver ? 'outline: 1px solid rgba(6,182,212,0.5); background: var(--sdf-accent-bg);' : ''} {isDragSource && isDragging ? 'opacity: 0.5;' : ''}"
          onpointerdown={(e) => onTabPointerDown(e, index)}
          onpointermove={onTabPointerMove}
          onpointerup={(e) => onTabPointerUp(e, index)}
          onpointercancel={(e) => onTabPointerUp(e, index)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              switchActiveDocument(id);
            }
          }}
          title={doc.fileName +
            (doc.isDirty ? " (unsaved)" : "") +
            " — drag to reorder"}
        >
          {#if isActive}
            <span
              class="absolute left-0 top-1 bottom-1 w-0.5 rounded-r"
              style="background: var(--sdf-accent);"
              aria-hidden="true"
            ></span>
          {/if}
          <span class="text-[10px] opacity-70 shrink-0 pointer-events-none" aria-hidden="true">
            {doc.fileType === "image"
              ? "🖼"
              : doc.fileType === "tiff"
                ? "📑"
                : "📄"}
          </span>
          <span class="truncate text-[11px] font-medium tracking-tight pointer-events-none">
            {shortName(doc.fileName)}{#if doc.isDirty}<span
                class="text-amber-400 ml-0.5 font-bold"
                title="Unsaved changes">*</span
              >{/if}
          </span>
          <button
            type="button"
            class="ml-auto shrink-0 w-4 h-4 flex items-center justify-center rounded text-[11px] leading-none transition-all hover:text-red-400
              {isActive
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'}"
            style={isActive ? 'color: var(--sdf-text-secondary);' : 'color: var(--sdf-text-muted);'}
            title="Close tab"
            onclick={(e) => {
              e.stopPropagation();
              onRequestClose(id);
            }}
            onpointerdown={(e) => e.stopPropagation()}
          >
            ×
          </button>
        </div>
      {/each}
    </div>

    <!-- RIGHT: Overflow / Close all -->
    <div class="flex items-center shrink-0 border-l bg-transparent px-1 relative" style="border-color: var(--sdf-border-subtle);">
      <button
        id="doc-tabs-overflow-btn"
        type="button"
        class="h-7 w-7 flex items-center justify-center rounded transition-colors text-sm"
        style={showOverflowMenu ? 'background: var(--sdf-accent-bg); color: var(--sdf-accent);' : 'color: var(--sdf-text-muted);'}
        title="Tab options"
        onclick={() => {
          showOverflowMenu = !showOverflowMenu;
          showRecentMenu = false;
        }}
      >
        ⋯
      </button>
      {#if showOverflowMenu}
        <div
          id="doc-tabs-overflow-menu"
          class="absolute right-0 top-full mt-1 z-[80] w-44 rounded-lg border shadow-2xl py-1"
          style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border);"
        >
          <button
            type="button"
            class="w-full px-3 py-2 text-left text-[11px] hover:text-red-400 transition-colors"
            style="color: var(--sdf-text-secondary);"
            onclick={() => {
              showOverflowMenu = false;
              onRequestCloseAll();
            }}
          >
            Close all tabs
          </button>
          <div
            class="px-3 py-1.5 text-[9px] font-mono"
            style="color: var(--sdf-text-faint); border-top: 1px solid var(--sdf-border-subtle);"
          >
            Ctrl+Tab cycle · drag to reorder
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .doc-tab-strip {
    scrollbar-width: thin;
    scrollbar-color: var(--sdf-scrollbar-thumb) transparent;
  }
  .doc-tab-strip::-webkit-scrollbar {
    height: 4px;
  }
  .doc-tab-strip::-webkit-scrollbar-thumb {
    background: var(--sdf-scrollbar-thumb);
    border-radius: 2px;
  }
  .doc-tab-strip::-webkit-scrollbar-track {
    background: transparent;
  }

  /* Unavailable rows stay listed; never show the forbidden (not-allowed) cursor */
  button[aria-disabled="true"] {
    cursor: default !important;
  }
</style>
