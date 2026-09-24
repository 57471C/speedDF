<script lang="ts">
  /**
   * Markdown source-left / live-preview-right (narrow: source above preview).
   * Editor writes markdownSource immediately; preview re-parses after a debounce.
   */
  import { tick } from "svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import MarkdownSourceEditor from "./MarkdownSourceEditor.svelte";
  import {
    activeDoc,
    MARKDOWN_SPLIT_RATIO_MAX,
    MARKDOWN_SPLIT_RATIO_MIN,
  } from "../pdfStore.svelte";
  import { MARKDOWN_PREVIEW_DEBOUNCE_MS } from "../lib/markdown/source";
  import {
    createMarkdownScrollSync,
    MARKDOWN_EDITOR_LINE_HEIGHT_PX,
    readLineAnchors,
    restoreScrollTop,
    sourceLineAtOffset,
    sourceLineAtScrollTop,
  } from "../lib/markdown/scrollSync";

  let { zoomScale = 150 }: { zoomScale?: number } = $props();

  let previewSource = $state("");
  let lastWorkspaceId = $state<string | null>(null);
  let editorEl = $state<HTMLTextAreaElement | null>(null);
  let previewScrollEl = $state<HTMLDivElement | null>(null);
  let splitRoot = $state<HTMLDivElement | null>(null);
  let wasSplit = $state(false);
  let gutterDragging = $state(false);
  let scrollSync: ReturnType<typeof createMarkdownScrollSync> | null = null;

  const GUTTER_PX = 6;

  const sourceRatio = $derived(activeDoc.markdownSplitRatio ?? 0.5);

  function applyGutterX(clientX: number) {
    const root = splitRoot;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const track = rect.width - GUTTER_PX;
    if (track <= 0) return;
    activeDoc.markdownSplitRatio = (clientX - rect.left - GUTTER_PX / 2) / track;
  }

  function onGutterPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom or a browser without capture */
    }
    gutterDragging = true;
    e.preventDefault();
  }

  function onGutterPointerMove(e: PointerEvent) {
    if (!gutterDragging) return;
    applyGutterX(e.clientX);
  }

  function onGutterPointerUp(e: PointerEvent) {
    if (!gutterDragging) return;
    gutterDragging = false;
    const handle = e.currentTarget as HTMLElement;
    try {
      if (handle.hasPointerCapture?.(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  }

  function handleType() {
    scrollSync?.noteTyping();
  }

  /**
   * Push source into the preview without destroying the scroll container.
   * Hold sync, patch, restore scrollTop, then release so echo cannot fight.
   */
  function commitPreviewSource(next: string) {
    if (next === previewSource) return;
    const scroller = previewScrollEl;
    const savedTop = scroller?.scrollTop ?? 0;
    scrollSync?.hold();
    previewSource = next;
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scroller) restoreScrollTop(scroller, savedTop);
          scrollSync?.release();
        });
      });
    });
  }

  $effect(() => {
    const src = activeDoc.markdownSource ?? "";
    const wsId = activeDoc.activeDocumentId ?? null;
    const tabChanged = wsId !== lastWorkspaceId;
    lastWorkspaceId = wsId;

    if (tabChanged || previewSource === "") {
      commitPreviewSource(src);
      return;
    }

    const timer = window.setTimeout(() => {
      commitPreviewSource(src);
    }, MARKDOWN_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  });

  // Focus the source pane when the user enters split (not on every remount).
  $effect(() => {
    const split = !!activeDoc.markdownSplitView;
    if (split && !wasSplit) {
      void tick().then(() => editorEl?.focus());
    }
    wasSplit = split;
  });

  const zoomPct = $derived(Math.max(5, Math.abs(zoomScale)) / 100);

  // Line-map scroll sync. Lock + rAF live in createMarkdownScrollSync.
  $effect(() => {
    const editor = editorEl;
    const preview = previewScrollEl;
    if (!editor || !preview) return;

    const lineHeight = () => {
      const lh = parseFloat(getComputedStyle(editor).lineHeight);
      return Number.isFinite(lh) && lh > 0 ? lh : MARKDOWN_EDITOR_LINE_HEIGHT_PX;
    };

    const sync = createMarkdownScrollSync({
      getEditor: () => editor,
      getPreview: () => preview,
      getEditorLineHeight: lineHeight,
      getViewportLine: () => sourceLineAtScrollTop(editor.scrollTop, lineHeight()),
      getCaretLine: () =>
        sourceLineAtOffset(editor.value ?? "", editor.selectionStart ?? 0),
      getPreviewAnchors: () => readLineAnchors(preview),
    });
    scrollSync = sync;

    const onEditorScroll = () => sync.onEditorScroll();
    const onPreviewScroll = () => sync.onPreviewScroll();
    const onImageLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) sync.realign();
    };
    editor.addEventListener("scroll", onEditorScroll, { passive: true });
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    preview.addEventListener("load", onImageLoad, true);

    return () => {
      editor.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
      preview.removeEventListener("load", onImageLoad, true);
      sync.dispose();
      if (scrollSync === sync) scrollSync = null;
    };
  });
</script>

<div
  bind:this={splitRoot}
  class="md-split"
  class:md-split--dragging={gutterDragging}
  data-markdown-split
  style="--md-split-source: {sourceRatio};"
>
  <section class="md-split__pane md-split__source">
    <header class="md-split__label">Source</header>
    <div class="md-split__body">
      <MarkdownSourceEditor bind:textareaEl={editorEl} onType={handleType} />
    </div>
  </section>
  <div
    class="md-split__gutter"
    data-markdown-split-gutter
    role="separator"
    aria-orientation="vertical"
    aria-valuemin={MARKDOWN_SPLIT_RATIO_MIN * 100}
    aria-valuemax={MARKDOWN_SPLIT_RATIO_MAX * 100}
    aria-valuenow={Math.round(sourceRatio * 100)}
    aria-label="Resize source and preview"
    onpointerdown={onGutterPointerDown}
    onpointermove={onGutterPointerMove}
    onpointerup={onGutterPointerUp}
    onpointercancel={onGutterPointerUp}
  ></div>
  <section
    class="md-split__pane md-split__preview"
    data-markdown-preview-pane
  >
    <header class="md-split__label">Preview</header>
    <div
      bind:this={previewScrollEl}
      class="md-split__body md-split__preview-scroll"
      data-markdown-preview-scroll
    >
      <div class="md-split__preview-zoom" style="zoom: {zoomPct};">
        <MarkdownView source={previewSource} variant="pane" />
      </div>
    </div>
  </section>
</div>

<style>
  .md-split {
    container-type: inline-size;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    gap: 0;
  }

  .md-split__pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--sdf-bg-elevated, #0f172a);
    border: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.15));
    overflow: hidden;
  }

  .md-split__source {
    flex: 0 0 calc((100% - 6px) * var(--md-split-source, 0.5));
    max-width: calc((100% - 6px) * var(--md-split-source, 0.5));
    border-radius: 0.5rem 0 0 0.5rem;
    border-right-width: 0;
  }

  .md-split__gutter {
    flex: 0 0 6px;
    width: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    cursor: col-resize;
    touch-action: none;
    background: var(--sdf-border);
    position: relative;
    z-index: 2;
  }

  .md-split__gutter::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    right: -4px;
  }

  .md-split__gutter:hover,
  .md-split--dragging .md-split__gutter {
    background: var(--sdf-accent);
  }

  .md-split--dragging,
  .md-split--dragging * {
    cursor: col-resize;
    user-select: none;
  }

  .md-split__preview {
    flex: 1 1 auto;
    border-radius: 0 0.5rem 0.5rem 0;
    border-left-width: 0;
    background: var(--sdf-bg-chrome);
  }

  .md-split__label {
    flex: 0 0 auto;
    padding: 0.35rem 0.75rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sdf-text-muted, #64748b);
    background: var(--sdf-bg-chrome, #0b1220);
    border-bottom: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.15));
    user-select: none;
  }

  .md-split__body {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
  }

  .md-split__preview-scroll {
    overflow: auto;
  }

  .md-split__preview-zoom {
    width: 100%;
    padding: 0.75rem;
    box-sizing: border-box;
  }

  @container (max-width: 720px) {
    .md-split {
      flex-direction: column;
    }

    .md-split__gutter {
      display: none;
    }

    .md-split__source {
      flex: 0 0 42%;
      max-width: none;
      max-height: 48%;
      min-height: 10rem;
      border-radius: 0.5rem 0.5rem 0 0;
      border-right-width: 1px;
      border-bottom-width: 0;
    }

    .md-split__preview {
      flex: 1 1 auto;
      border-radius: 0 0 0.5rem 0.5rem;
      border-left-width: 1px;
    }
  }
</style>
