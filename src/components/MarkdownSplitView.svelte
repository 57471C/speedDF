<script lang="ts">
  /**
   * Markdown source-left / live-preview-right (narrow: source above preview).
   * Editor writes markdownSource immediately; preview re-parses after a debounce.
   */
  import { tick } from "svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import MarkdownSourceEditor from "./MarkdownSourceEditor.svelte";
  import { activeDoc } from "../pdfStore.svelte";
  import { MARKDOWN_PREVIEW_DEBOUNCE_MS } from "../lib/markdown/source";
  import {
    createMarkdownScrollSync,
    restoreScrollTop,
  } from "../lib/markdown/scrollSync";

  let { zoomScale = 150 }: { zoomScale?: number } = $props();

  let previewSource = $state("");
  let lastWorkspaceId = $state<string | null>(null);
  let editorEl = $state<HTMLTextAreaElement | null>(null);
  let previewScrollEl = $state<HTMLDivElement | null>(null);
  let wasSplit = $state(false);
  let scrollSync: ReturnType<typeof createMarkdownScrollSync> | null = null;

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

  // Two-way relative scroll sync. Lock + rAF live in createMarkdownScrollSync.
  $effect(() => {
    const editor = editorEl;
    const preview = previewScrollEl;
    if (!editor || !preview) return;

    const sync = createMarkdownScrollSync({
      getEditor: () => editor,
      getPreview: () => preview,
    });
    scrollSync = sync;

    const onEditorScroll = () => sync.onEditorScroll();
    const onPreviewScroll = () => sync.onPreviewScroll();
    editor.addEventListener("scroll", onEditorScroll, { passive: true });
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });

    return () => {
      editor.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
      sync.dispose();
      if (scrollSync === sync) scrollSync = null;
    };
  });
</script>

<div class="md-split" data-markdown-split>
  <section class="md-split__pane md-split__source">
    <header class="md-split__label">Source</header>
    <div class="md-split__body">
      <MarkdownSourceEditor bind:textareaEl={editorEl} onType={handleType} />
    </div>
  </section>
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
    flex: 1 1 50%;
    min-width: 0;
    min-height: 0;
    background: var(--sdf-bg-elevated, #0f172a);
    border: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.15));
    overflow: hidden;
  }

  .md-split__source {
    border-radius: 0.5rem 0 0 0.5rem;
    border-right-width: 0;
  }

  .md-split__preview {
    border-radius: 0 0.5rem 0.5rem 0;
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

    .md-split__source {
      flex: 0 0 42%;
      max-height: 48%;
      min-height: 10rem;
      border-radius: 0.5rem 0.5rem 0 0;
      border-right-width: 1px;
      border-bottom-width: 0;
    }

    .md-split__preview {
      flex: 1 1 auto;
      border-radius: 0 0 0.5rem 0.5rem;
    }
  }
</style>
