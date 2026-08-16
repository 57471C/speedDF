<script lang="ts">
  /**
   * Read-only continuous markdown projection.
   * Prop `source` is the canonical UTF-8 markdown string from the open document.
   * View only: parse → sanitize → in-place innerHTML. Never mutates source.
   * Does not use `{@html}` / `{#if}` so the preview scroller is not remounted.
   *
   * After sanitized HTML paints, captures the top of this root for Recent /
   * sidebar thumbs via applyLiveThumbnail (same store path as image opens).
   */
  import { tick } from "svelte";
  import { parseMarkdownToHtml } from "../lib/markdown/parse";
  import { sanitizeHtml } from "../lib/markdown/sanitize";
  import { captureMarkdownViewThumbnail } from "../lib/markdown/thumbnail";
  import { activeDoc, applyLiveThumbnail } from "../pdfStore.svelte";

  let {
    source = "",
    variant = "document",
  }: {
    source: string;
    /** `pane` fills a split preview column; `document` is the standalone card. */
    variant?: "document" | "pane";
  } = $props();

  const safeHtml = $derived(sanitizeHtml(parseMarkdownToHtml(source ?? "")));

  let rootEl = $state<HTMLElement | null>(null);
  /** Stable host — patched in place so the preview scroller is never remounted. */
  let htmlHost = $state<HTMLElement | null>(null);
  /** Dedupe captures for the same path + source fingerprint. */
  let lastCaptureKey = $state("");

  const EMPTY_PREVIEW_HTML =
    '<p class="markdown-view__empty">Empty document</p>';

  // Single innerHTML write (no {#if}/{@html} remount). Restore the nearest
  // split-preview scroller so a mid-document edit does not snap to top.
  $effect(() => {
    const html = safeHtml;
    const host = htmlHost;
    if (!host) return;
    const scroller = host.closest(
      "[data-markdown-preview-scroll]",
    ) as HTMLElement | null;
    const savedTop = scroller?.scrollTop ?? 0;
    host.innerHTML = html || EMPTY_PREVIEW_HTML;
    if (scroller) scroller.scrollTop = savedTop;
  });

  $effect(() => {
    const html = safeHtml;
    const src = source ?? "";
    const el = rootEl;
    const fileType = activeDoc.fileType;
    const filePath = activeDoc.filePath;
    const wsId = activeDoc.activeDocumentId;

    if (fileType !== "markdown" || !el) return;

    // Fingerprint: path + length + short content hash so empty→filled re-captures
    const key = `${filePath || wsId || ""}::${src.length}::${html.slice(0, 96)}`;
    if (key === lastCaptureKey) return;

    let cancelled = false;

    void (async () => {
      try {
        // Wait for {@html} to land + layout paint before capture
        await tick();
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        // Brief settle so fonts start; image wait lives inside capture helper
        await new Promise((r) => setTimeout(r, 80));
        if (cancelled || !rootEl) return;
        if (activeDoc.fileType !== "markdown") return;
        if (
          (activeDoc.filePath || activeDoc.activeDocumentId) !==
          (filePath || wsId)
        )
          return;

        // Simple html2canvas of this root → applyLiveThumbnail (same path as image opens)
        const dataUrl = await captureMarkdownViewThumbnail(rootEl);
        if (cancelled || !dataUrl) return;
        if (activeDoc.fileType !== "markdown") return;
        applyLiveThumbnail(dataUrl, activeDoc.filePath, 0);
        lastCaptureKey = key;
      } catch (err) {
        // Failure → leave empty / icon fallback; do not block open
        console.warn("Markdown thumb capture schedule failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<article
  bind:this={rootEl}
  class="markdown-view"
  class:markdown-view--pane={variant === "pane"}
  data-markdown-content
  aria-label="Markdown document"
>
  <div bind:this={htmlHost} class="markdown-view__html" data-markdown-html></div>
</article>

<style>
  .markdown-view {
    /* Continuous document — not A4 page boxes */
    width: min(48rem, 100%);
    max-width: 100%;
    margin: 0 auto;
    padding: 2rem 2.25rem 3rem;
    background: var(--sdf-bg-elevated, #0f172a);
    color: var(--sdf-text-primary, #e2e8f0);
    border: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.15));
    border-radius: 0.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 0.95rem;
    line-height: 1.65;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    text-align: left;
    user-select: text;
    -webkit-user-select: text;
  }

  .markdown-view--pane {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: 1.25rem 1.35rem 2rem;
    box-shadow: none;
  }

  .markdown-view :global(.markdown-view__empty) {
    margin: 0;
    color: var(--sdf-text-muted, #64748b);
    font-style: italic;
  }

  /* ── Typography (scoped via :global so {@html} content is styled) ── */
  .markdown-view :global(h1),
  .markdown-view :global(h2),
  .markdown-view :global(h3),
  .markdown-view :global(h4),
  .markdown-view :global(h5),
  .markdown-view :global(h6) {
    line-height: 1.3;
    font-weight: 700;
    color: var(--sdf-text-primary, #f1f5f9);
    margin: 1.25em 0 0.5em;
  }
  .markdown-view :global(h1) {
    font-size: 1.75rem;
    padding-bottom: 0.35em;
    border-bottom: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.2));
  }
  .markdown-view :global(h2) {
    font-size: 1.4rem;
    padding-bottom: 0.25em;
    border-bottom: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.12));
  }
  .markdown-view :global(h3) { font-size: 1.2rem; font-weight: 600; }
  .markdown-view :global(h4) { font-size: 1.05rem; font-weight: 600; }
  .markdown-view :global(h5),
  .markdown-view :global(h6) { font-size: 0.95rem; font-weight: 600; color: var(--sdf-text-secondary, #cbd5e1); }

  .markdown-view :global(p) { margin: 0.65em 0; }
  .markdown-view :global(ul),
  .markdown-view :global(ol) { margin: 0.6em 0; padding-left: 1.5em; }
  .markdown-view :global(li) { margin: 0.25em 0; }
  .markdown-view :global(li > p) { margin: 0.25em 0; }

  .markdown-view :global(blockquote) {
    margin: 0.85em 0;
    padding: 0.35em 0 0.35em 1em;
    border-left: 3px solid var(--sdf-accent, #22d3ee);
    color: var(--sdf-text-secondary, #94a3b8);
    /* Solid rgba — avoid color-mix (html2canvas cannot parse it for thumbs) */
    background: rgba(34, 211, 238, 0.06);
    border-radius: 0 0.25rem 0.25rem 0;
  }
  .markdown-view :global(blockquote p) { margin: 0.35em 0; }

  .markdown-view :global(a) {
    color: var(--sdf-accent-text, #22d3ee);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown-view :global(a:hover) { opacity: 0.9; }

  .markdown-view :global(hr) {
    border: none;
    border-top: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.25));
    margin: 1.5em 0;
  }

  .markdown-view :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.35rem;
    margin: 0.75em 0;
  }

  .markdown-view :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.85em 0;
    font-size: 0.9em;
  }
  .markdown-view :global(th),
  .markdown-view :global(td) {
    border: 1px solid var(--sdf-border, rgba(148, 163, 184, 0.3));
    padding: 0.4em 0.7em;
    text-align: left;
  }
  .markdown-view :global(th) {
    background: var(--sdf-hover-bg, rgba(148, 163, 184, 0.1));
    font-weight: 600;
  }
  .markdown-view :global(tr:nth-child(even) td) {
    /* Solid rgba — avoid color-mix (html2canvas cannot parse it for thumbs) */
    background: rgba(30, 41, 59, 0.5);
  }

  .markdown-view :global(code) {
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.88em;
    background: var(--sdf-bg-surface, #1e293b);
    color: var(--sdf-accent-text, #a5f3fc);
    padding: 0.12em 0.4em;
    border-radius: 0.25rem;
  }

  .markdown-view :global(pre) {
    margin: 0.85em 0;
    padding: 0.9em 1.1em;
    background: var(--sdf-bg-surface, #0b1220);
    border: 1px solid var(--sdf-border-subtle, rgba(148, 163, 184, 0.15));
    border-radius: 0.4rem;
    overflow-x: auto;
    line-height: 1.5;
  }
  .markdown-view :global(pre code) {
    background: transparent;
    padding: 0;
    color: var(--sdf-text-primary, #e2e8f0);
    font-size: 0.85em;
  }
  .markdown-view :global(pre code.hljs) {
    display: block;
  }

  .markdown-view :global(strong) { font-weight: 700; }
  .markdown-view :global(em) { font-style: italic; }
  .markdown-view :global(del) { text-decoration: line-through; opacity: 0.8; }

  /* First heading: less top margin so the card padding is balanced */
  .markdown-view__html :global(> :first-child) { margin-top: 0; }

  /* Print: continuous flow on A4; chrome hide is handled by print iframe / @media below */
  @media print {
    @page {
      size: A4;
      margin: 18mm;
    }
    .markdown-view {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #111 !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }
    .markdown-view :global(h1),
    .markdown-view :global(h2),
    .markdown-view :global(h3),
    .markdown-view :global(h4),
    .markdown-view :global(h5),
    .markdown-view :global(h6) {
      color: #111 !important;
      border-color: #cbd5e1 !important;
    }
    .markdown-view :global(a) { color: #0369a1 !important; }
    .markdown-view :global(blockquote) {
      color: #334155 !important;
      background: transparent !important;
      border-left-color: #94a3b8 !important;
    }
    .markdown-view :global(code),
    .markdown-view :global(pre) {
      background: #f1f5f9 !important;
      color: #111 !important;
      border-color: #e2e8f0 !important;
    }
    .markdown-view :global(th),
    .markdown-view :global(td) {
      border-color: #cbd5e1 !important;
    }
    .markdown-view :global(th) { background: #f8fafc !important; }
  }
</style>
