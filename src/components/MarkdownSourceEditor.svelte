<script lang="ts">
  /**
   * Plain-text markdown source editor (v1: no WYSIWYG / vim / IDE chrome).
   * Writes the canonical DocumentWorkspace.markdownSource and marks dirty.
   * highlight.js paints a scroll-synced overlay behind the textarea.
   */
  import { activeDoc, setMarkdownSourceAction } from "../pdfStore.svelte";
  import {
    EDITOR_HIGHLIGHT_DEBOUNCE_MS,
    highlightMarkdownSource,
  } from "../lib/markdown/highlight";

  let {
    textareaEl = $bindable(null),
    onType,
  }: {
    textareaEl?: HTMLTextAreaElement | null;
    /** Fired on each user keystroke so split-view scroll sync can guard the caret. */
    onType?: () => void;
  } = $props();

  let highlightEl = $state<HTMLPreElement | null>(null);
  let highlightCodeEl = $state<HTMLElement | null>(null);
  let paintedOnce = $state(false);

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    onType?.();
    setMarkdownSourceAction(el.value);
    syncOverlayScroll();
  }

  function syncOverlayScroll() {
    const ta = textareaEl;
    const pre = highlightEl;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function paintHighlight(src: string) {
    if (!highlightCodeEl) return;
    highlightCodeEl.innerHTML = src ? highlightMarkdownSource(src) : "";
    syncOverlayScroll();
  }

  // Uncontrolled while focused: a bound `value={store}` rewrite on every
  // keystroke resets textarea scroll/caret, which then syncs the preview to top.
  $effect(() => {
    const src = activeDoc.markdownSource ?? "";
    const el = textareaEl;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== src) el.value = src;
  });

  $effect(() => {
    const src = activeDoc.markdownSource ?? "";
    const host = highlightCodeEl;
    if (!host) return;
    if (!paintedOnce) {
      paintedOnce = true;
      paintHighlight(src);
      return;
    }
    const timer = window.setTimeout(() => {
      paintHighlight(src);
    }, EDITOR_HIGHLIGHT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  });
</script>

<div class="md-source-wrap">
  <pre
    bind:this={highlightEl}
    class="md-source-highlight"
    aria-hidden="true"
  ><code bind:this={highlightCodeEl} class="md-source-highlight__code"></code></pre>
  <textarea
    bind:this={textareaEl}
    class="md-source-editor"
    oninput={handleInput}
    onscroll={syncOverlayScroll}
    disabled={activeDoc.isSaving}
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
    wrap="soft"
    aria-label="Markdown source"
    placeholder="Write markdown…"
  ></textarea>
</div>

<style>
  .md-source-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--sdf-bg-input, #0f172a);
  }

  .md-source-highlight,
  .md-source-editor {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 1rem 1.1rem 1.5rem;
    border: none;
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.55;
    tab-size: 2;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-wrap: break-word;
    overflow: auto;
  }

  .md-source-highlight {
    pointer-events: none;
    color: var(--sdf-text-primary, #e2e8f0);
    background: transparent;
    scrollbar-width: none;
  }

  .md-source-highlight::-webkit-scrollbar {
    display: none;
  }

  .md-source-highlight__code {
    display: block;
    font: inherit;
    padding: 0;
    margin: 0;
    background: transparent;
    color: inherit;
    white-space: inherit;
    overflow-wrap: inherit;
  }

  .md-source-editor {
    z-index: 1;
    resize: none;
    outline: none;
    background: transparent;
    color: transparent;
    caret-color: var(--sdf-text-primary, #e2e8f0);
    -webkit-text-fill-color: transparent;
  }

  .md-source-editor:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .md-source-editor:focus {
    outline: none;
  }

  .md-source-editor::placeholder {
    color: var(--sdf-text-muted, #64748b);
    -webkit-text-fill-color: var(--sdf-text-muted, #64748b);
  }

  .md-source-editor::selection {
    background: var(--sdf-accent-bg, rgba(8, 145, 178, 0.2));
    color: transparent;
  }
</style>
