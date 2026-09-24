<script lang="ts">
  /**
   * Read-only continuous markdown projection.
   * Prop `source` is the canonical UTF-8 markdown string from the open document.
   * View only: parse → sanitize → in-place innerHTML. Never mutates source.
   * Sanitized HTML is patched on a stable host (`{@html}`), never a `{#key}`
   * remount, so the preview scroller survives each keystroke.
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

  // Preserve scroll position when safeHtml updates and causes a remount.
  let savedScrollTop = 0;

  $effect.pre(() => {
    // Read safeHtml to trigger this before DOM updates
    const _ = safeHtml;
    if (!htmlHost) return;
    const scroller = htmlHost.closest(
      "[data-markdown-preview-scroll]",
    ) as HTMLElement | null;
    if (scroller) {
      savedScrollTop = scroller.scrollTop;
    }
  });

  $effect(() => {
    // Read safeHtml to trigger this after DOM updates
    const _ = safeHtml;
    if (!htmlHost) return;
    const scroller = htmlHost.closest(
      "[data-markdown-preview-scroll]",
    ) as HTMLElement | null;
    if (scroller) {
      scroller.scrollTop = savedScrollTop;
    }
  });

  $effect(() => {
    const html = safeHtml;
    const src = source ?? "";
    const el = rootEl;
    const fileType = activeDoc.fileType;
    const filePath = activeDoc.filePath;
    const wsId = activeDoc.activeDocumentId;

    if (fileType !== "markdown" || !el) return;

    const key = `${filePath || wsId || ""}::${src.length}::${html.slice(0, 96)}`;
    if (key === lastCaptureKey) return;

    let cancelled = false;

    void (async () => {
      try {
        await tick();
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        await new Promise((r) => setTimeout(r, 80));
        if (cancelled || !rootEl) return;
        if (activeDoc.fileType !== "markdown") return;
        if (
          (activeDoc.filePath || activeDoc.activeDocumentId) !==
          (filePath || wsId)
        )
          return;

        const dataUrl = await captureMarkdownViewThumbnail(rootEl);
        if (cancelled || !dataUrl) return;
        if (activeDoc.fileType !== "markdown") return;
        applyLiveThumbnail(dataUrl, activeDoc.filePath, 0);
        lastCaptureKey = key;
      } catch (err) {
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
  <div bind:this={htmlHost} class="markdown-view__html" data-markdown-html>{@html safeHtml || EMPTY_PREVIEW_HTML}</div>
</article>

<style>
  .markdown-view {
    --md-measure: 78ch;
    width: min(calc(var(--md-measure) + 5rem), 100%);
    max-width: 100%;
    margin: 1.25rem auto 2rem;
    padding: 2.5rem 2.5rem 3.25rem;
    background: var(--sdf-bg-chrome);
    color: var(--sdf-text-primary);
    border: 1px solid var(--sdf-border);
    border-radius: 0.5rem;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 1rem;
    line-height: 1.7;
    word-wrap: break-word;
    overflow-wrap: break-word;
    text-align: left;
    user-select: text;
    -webkit-user-select: text;
  }

  .markdown-view__html {
    max-width: var(--md-measure);
    margin-inline: auto;
  }

  /* Split preview column: fill the paper pane, same measure, no nested dark card. */
  .markdown-view--pane {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 1.75rem 1.75rem 2.75rem;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .markdown-view :global(.markdown-view__empty) {
    margin: 0;
    color: var(--sdf-text-muted);
    font-style: italic;
  }

  .markdown-view :global(h1),
  .markdown-view :global(h2),
  .markdown-view :global(h3),
  .markdown-view :global(h4),
  .markdown-view :global(h5),
  .markdown-view :global(h6) {
    line-height: 1.22;
    font-weight: 700;
    color: var(--sdf-text-primary);
    letter-spacing: -0.02em;
  }
  .markdown-view :global(h1) {
    font-size: 2.05rem;
    margin: 0 0 0.55em;
    padding-bottom: 0.4em;
    border-bottom: 1px solid var(--sdf-border);
  }
  .markdown-view :global(h2) {
    font-size: 1.5rem;
    margin: 1.85em 0 0.5em;
    padding-bottom: 0.28em;
    border-bottom: 1px solid var(--sdf-border-subtle);
  }
  .markdown-view :global(h3) {
    font-size: 1.22rem;
    font-weight: 600;
    margin: 1.55em 0 0.4em;
    letter-spacing: -0.015em;
  }
  .markdown-view :global(h4) {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 1.35em 0 0.35em;
    letter-spacing: -0.01em;
  }
  .markdown-view :global(h5) {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 1.25em 0 0.3em;
    color: var(--sdf-text-secondary);
  }
  .markdown-view :global(h6) {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 1.25em 0 0.3em;
    color: var(--sdf-text-muted);
  }

  .markdown-view :global(p) { margin: 0.9em 0; }
  .markdown-view :global(ul),
  .markdown-view :global(ol) {
    margin: 0.75em 0 1em;
    padding-left: 1.5em;
    list-style-position: outside;
  }
  .markdown-view :global(ul) { list-style-type: disc; }
  .markdown-view :global(ol) { list-style-type: decimal; }
  .markdown-view :global(li) {
    margin: 0.35em 0;
    display: list-item;
  }
  .markdown-view :global(li > p) { margin: 0.3em 0; }
  .markdown-view :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: -1.15em;
  }

  .markdown-view :global(input[type="checkbox"]) {
    appearance: none;
    -webkit-appearance: none;
    width: 0.95em;
    height: 0.95em;
    margin: 0 0.45em 0 0;
    vertical-align: -0.15em;
    border: 1.5px solid var(--sdf-border);
    border-radius: 3px;
    background: var(--sdf-bg-input);
  }
  .markdown-view :global(input[type="checkbox"]:checked) {
    border-color: var(--sdf-accent);
    background-color: var(--sdf-accent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' d='M2.5 6.2 5 8.7 9.5 3.5'/%3E%3C/svg%3E");
    background-size: 100% 100%;
  }

  .markdown-view :global(mark) {
    background: color-mix(in srgb, var(--sdf-hl-number) 35%, transparent);
    color: inherit;
    padding: 0 0.12em;
    border-radius: 2px;
  }

  .markdown-view :global(blockquote) {
    margin: 1.15em 0;
    padding: 0.45em 0.9em 0.45em 1em;
    border-left: 3px solid var(--sdf-accent);
    color: var(--sdf-text-secondary);
    background: color-mix(in srgb, var(--sdf-accent) 8%, transparent);
    border-radius: 0 0.25rem 0.25rem 0;
  }
  .markdown-view :global(blockquote p) { margin: 0.4em 0; }

  .markdown-view :global(a) {
    color: var(--sdf-accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown-view :global(a:hover) { opacity: 0.85; }

  .markdown-view :global(hr) {
    border: none;
    border-top: 1px solid var(--sdf-border);
    margin: 1.75em 0;
  }

  .markdown-view :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.35rem;
    margin: 1em 0;
  }

  .markdown-view :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 1.15em 0;
    font-size: 0.92em;
  }
  .markdown-view :global(th),
  .markdown-view :global(td) {
    border: 1px solid var(--sdf-border);
    padding: 0.45em 0.75em;
    text-align: left;
  }
  .markdown-view :global(th) {
    background: var(--sdf-hover-bg);
    font-weight: 600;
  }
  .markdown-view :global(tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--sdf-hover-bg) 55%, transparent);
  }

  .markdown-view :global(code) {
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.88em;
    background: var(--sdf-bg-input);
    color: var(--sdf-text-primary);
    padding: 0.12em 0.38em;
    border-radius: 0.25rem;
    border: 1px solid var(--sdf-border-subtle);
  }

  .markdown-view :global(pre) {
    margin: 1.15em 0;
    padding: 0.95em 1.1em;
    background: var(--sdf-bg-input);
    border: 1px solid var(--sdf-border);
    border-radius: 0.4rem;
    overflow-x: auto;
    line-height: 1.55;
  }
  .markdown-view :global(pre code) {
    background: transparent;
    padding: 0;
    border: none;
    color: var(--sdf-text-primary);
    font-size: 0.86em;
  }
  .markdown-view :global(pre code.hljs) {
    display: block;
  }
  .markdown-view :global(pre[data-lang]) {
    position: relative;
    padding-top: 1.85rem;
  }
  .markdown-view :global(pre[data-lang]::before) {
    content: attr(data-lang);
    position: absolute;
    top: 0.4rem;
    right: 0.7rem;
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sdf-text-muted);
    pointer-events: none;
    user-select: none;
  }
  .markdown-view :global(.hljs-keyword) { color: var(--sdf-hl-keyword); }
  .markdown-view :global(.hljs-string) { color: var(--sdf-hl-string); }
  .markdown-view :global(.hljs-comment) { color: var(--sdf-hl-comment); font-style: italic; }
  .markdown-view :global(.hljs-number) { color: var(--sdf-hl-number); }
  .markdown-view :global(.hljs-title) { color: var(--sdf-hl-title); }

  .markdown-view :global(strong) { font-weight: 700; }
  .markdown-view :global(em) { font-style: italic; }
  .markdown-view :global(del) { text-decoration: line-through; opacity: 0.8; }

  .markdown-view__html :global(> :first-child) { margin-top: 0; }
  .markdown-view__html :global(> :last-child) { margin-bottom: 0; }

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
