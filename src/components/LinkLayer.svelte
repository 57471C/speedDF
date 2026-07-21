<script lang="ts">
  /**
   * Overlay for PDF URI Link annotations: underline/hover chrome + safe open.
   * Interactive only with the Select tool so drawing tools are not stolen.
   */
  import { ask } from "@tauri-apps/plugin-dialog";
  import { open as openBrowser } from "@tauri-apps/plugin-shell";
  import { activeDoc } from "../pdfStore.svelte";
  import {
    isSafeHyperlinkUrl,
    linksForPage,
    type HyperlinkDef,
  } from "../lib/links/hyperlinks";

  let { pageNumber } = $props<{ pageNumber: number }>();

  let pageLinks = $derived(linksForPage(activeDoc.hyperlinks, pageNumber));

  /** Clickable only on Select — drawing tools keep full page hit-testing. */
  let interactive = $derived(activeDoc.activeTool === "select");

  /** Guard concurrent confirms (double-click / multi-tab). */
  let opening = $state(false);

  function stopBubble(e: Event) {
    e.stopPropagation();
  }

  async function onLinkActivate(link: HyperlinkDef, e: MouseEvent) {
    stopBubble(e);
    e.preventDefault();
    if (!interactive || opening) return;

    // Re-validate at click time (never trust stored string blindly)
    if (!isSafeHyperlinkUrl(link.url)) {
      console.warn("Blocked unsafe hyperlink:", link.url);
      return;
    }

    const url = link.url.trim();
    const docIdAtClick = activeDoc.activeDocumentId;
    opening = true;
    try {
      const confirmed = await ask(
        `Open this link in your default browser?\n\n${url}`,
        {
          title: "Open hyperlink",
          kind: "info",
          okLabel: "Open",
          cancelLabel: "Cancel",
        },
      );
      // Multi-document: ignore if user switched tabs during the dialog
      if (docIdAtClick && activeDoc.activeDocumentId !== docIdAtClick) {
        return;
      }
      if (!confirmed) return;
      if (!isSafeHyperlinkUrl(url)) return;
      await openBrowser(url);
    } catch (err) {
      console.error("Failed to open hyperlink:", err);
    } finally {
      opening = false;
    }
  }
</script>

{#if pageLinks.length > 0}
  <div
    class="absolute inset-0 z-[36] overflow-hidden rounded-sm pointer-events-none"
    aria-hidden={!interactive}
  >
    {#each pageLinks as link (link.id)}
      <a
        href={link.url}
        class="pdf-hyperlink absolute box-border
          {interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}"
        style="left: {link.x}%; top: {link.y}%; width: {link.width}%; height: {link.height}%;"
        title={link.url}
        aria-label="Link: {link.url}"
        tabindex={interactive ? 0 : -1}
        onmousedown={stopBubble}
        onpointerdown={stopBubble}
        onclick={(e) => onLinkActivate(link, e)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onLinkActivate(link, e as unknown as MouseEvent);
          }
        }}
      ></a>
    {/each}
  </div>
{/if}

<style>
  .pdf-hyperlink {
    border-bottom: 1.5px solid rgba(37, 99, 235, 0.55);
    background: transparent;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .pdf-hyperlink:hover {
    background: rgba(37, 99, 235, 0.1);
    border-bottom-color: rgba(37, 99, 235, 0.95);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.25);
  }

  .pdf-hyperlink:focus-visible {
    outline: 2px solid rgba(34, 211, 238, 0.85);
    outline-offset: 1px;
  }
</style>
