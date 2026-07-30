<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import { PDFDocument } from "pdf-lib";
  import { invoke } from "@tauri-apps/api/core";
  import Sortable from "sortablejs";
  import {
    activeDoc,
    rotatePageAction,
    pushHistorySnapshot,
    updateBookmarkNameAction,
    deleteBookmarkAction,
    replyToCommentAction,
    deleteCommentAction,
    deleteReplyAction,
    updateReplyAction,
  } from "../pdfStore.svelte";
  import {
    countComments,
    formatCommentTime,
  } from "../lib/comments/comments";
  import { autoGrowTextarea } from "../lib/interaction/autoGrowTextarea";
  import {
    ensurePageThumbnail,
    refreshThumbnailsAfterPageInsert,
  } from "../lib/render/thumbnailCache";
  import { destroySharedWorkspacePdf } from "../lib/render/sharedPdfDocument";
  import {
    displayPagePosition,
    prunePageBoundToOrder,
    remapSessionAfterPageInsert,
  } from "../lib/pages/pageBoundData";

  let sidebarContainer = $state<HTMLDivElement | null>(null);
  let thumbnailElements = $state<Record<number, HTMLDivElement>>({});
  let appendFileInput = $state<HTMLInputElement | null>(null);
  let insertAfterPageNum = $state<number | null>(null);
  let isGridViewOpen = $state(false);
  let isPageMenuOpen = $state(false);
  let selectedPages = $state<number[]>([]);
  let activeSidebarTab = $state<'thumbnails' | 'bookmarks' | 'comments'>('thumbnails');

  // Images have no outline/bookmarks or comments UI — keep the tab on thumbnails
  $effect(() => {
    if (activeDoc.fileType === 'image' && activeSidebarTab !== 'thumbnails') {
      activeSidebarTab = 'thumbnails';
    }
  });

  // --- Bookmark Editing State ---
  let editingBookmarkId = $state<number | null>(null);
  let editingBookmarkName = $state<string>("");

  // --- Comments panel state ---
  let replyDrafts = $state<Record<string, string>>({});
  let openReplyId = $state<string | null>(null);
  /** Which reply is being edited: `${threadId}:${replyId}` */
  let editingReplyKey = $state<string | null>(null);
  let editReplyDraft = $state("");

  // --- Bookmark Sorting Logic ---
  // Automatically sorts bookmarks based on their actual position in the document (pageOrder)
  let sortedBookmarks = $derived([...(activeDoc.bookmarks || [])].sort((a, b) => {
    const idxA = activeDoc.pageOrder.indexOf(a.pageNum);
    const idxB = activeDoc.pageOrder.indexOf(b.pageNum);
    return idxA - idxB;
  }));

  let totalCommentCount = $derived(countComments(activeDoc.comments));

  // Always list every page, ordered by document page order then time
  let visibleComments = $derived.by(() => {
    return [...(activeDoc.comments || [])].sort((a, b) => {
      const idxA = activeDoc.pageOrder.indexOf(a.pageNum);
      const idxB = activeDoc.pageOrder.indexOf(b.pageNum);
      if (idxA !== idxB) return idxA - idxB;
      return a.createdAt - b.createdAt;
    });
  });

  /** Thread id to briefly highlight after opening comments from a page flag. */
  let focusedThreadId = $state<string | null>(null);

  // Honor page "Add comment" / flag-click requests from WorkspacePage
  $effect(() => {
    const focusPage = activeDoc.commentsFocusRequest;
    const focusThread = activeDoc.commentsFocusThreadId;
    if (focusPage != null && focusPage > 0) {
      activeSidebarTab = "comments";
      focusedThreadId = focusThread;
      // Consume the session signals so they do not re-fire
      activeDoc.commentsFocusRequest = null;
      activeDoc.commentsFocusThreadId = null;
      // Scroll the focused thread into view after paint
      if (focusThread) {
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-comment-thread="${CSS.escape(focusThread)}"]`,
          ) as HTMLElement | null;
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
        // Clear highlight after a short beat
        setTimeout(() => {
          if (focusedThreadId === focusThread) focusedThreadId = null;
        }, 2200);
      }
    }
  });

  function submitReply(threadId: string) {
    const text = replyDrafts[threadId] || "";
    const id = replyToCommentAction(threadId, text);
    if (id) {
      replyDrafts = { ...replyDrafts, [threadId]: "" };
      openReplyId = null;
    }
  }

  function startEditReply(threadId: string, replyId: string, text: string) {
    editingReplyKey = `${threadId}:${replyId}`;
    editReplyDraft = text || "";
  }

  function saveEditReply(threadId: string, replyId: string) {
    if (updateReplyAction(threadId, replyId, editReplyDraft)) {
      editingReplyKey = null;
      editReplyDraft = "";
    }
  }

  function cancelEditReply() {
    editingReplyKey = null;
    editReplyDraft = "";
  }

  // ⚡ Visibility Tracking State: Fully hides the red box until an actual scroll happens
  let hasUserScrolled = $state(false);

  // Keep the viewfinder safely hidden whenever a new document initializes
  $effect(() => {
    if (activeDoc.rawBytes) {
      hasUserScrolled = false;
    }
  });

  // Reveal the viewfinder only after crossing a true vertical scroll threshold
  $effect(() => {
    if (activeDoc.scrollTop > 5) {
      hasUserScrolled = true;
    }
  });

  let globalRedBoxTop = $state(0);
  let globalRedBoxHeight = $state(0);

  $effect(() => {
    // Svelte 5 reactivity trigger dependencies
    const _scroll = activeDoc.scrollTop;
    const _page = activeDoc.currentPage;
    const _height = activeDoc.scrollHeight;
    const _zoom = activeDoc.zoomScale;

    // Use requestAnimationFrame to prevent layout thrashing
    const rafId = requestAnimationFrame(() => {
      const scrollContainer = document.querySelector(".workspace-scroll-container");
      if (!scrollContainer) return;

      // 1. Capture the continuous visible boundaries of the viewport
      const viewTop = scrollContainer.scrollTop;
      const viewHeight = scrollContainer.clientHeight;
      const viewBottom = viewTop + viewHeight;

      // 2. Query all rendered workspace page elements in the DOM
      const workspacePages = Array.from(scrollContainer.querySelectorAll("[data-page-number]")) as HTMLElement[];
      if (workspacePages.length === 0) return;

      let redBoxTopPixel = 0;
      let redBoxBottomPixel = 0;

      // 3. Locate the page crossing the top viewport horizon
      const topPageNode = workspacePages.find(p => (p.offsetTop + p.offsetHeight) >= viewTop) || workspacePages[0];
      const topPageNum = parseInt(topPageNode.getAttribute("data-page-number") || "1", 10);
      const topThumbnail = thumbnailElements[topPageNum];

      if (topPageNode && topThumbnail) {
        const topPagePct = Math.max(0, (viewTop - topPageNode.offsetTop) / topPageNode.offsetHeight);
        redBoxTopPixel = topThumbnail.offsetTop + (topPagePct * topThumbnail.offsetHeight);
      }

      // 4. Locate the page crossing the bottom viewport horizon
      const bottomPageNode = workspacePages.find(p => (p.offsetTop + p.offsetHeight) >= viewBottom) || workspacePages[workspacePages.length - 1];
      const bottomPageNum = parseInt(bottomPageNode.getAttribute("data-page-number") || "1", 10);
      const bottomThumbnail = thumbnailElements[bottomPageNum];

      if (bottomPageNode && bottomThumbnail) {
        const bottomPagePct = Math.min(1, (viewBottom - bottomPageNode.offsetTop) / bottomPageNode.offsetHeight);
        redBoxBottomPixel = bottomThumbnail.offsetTop + (bottomPagePct * bottomThumbnail.offsetHeight);
      }

      // 5. Update the global floating state constraints
      globalRedBoxTop = redBoxTopPixel;
      globalRedBoxHeight = Math.max(24, redBoxBottomPixel - redBoxTopPixel); // Force minimum visual presence
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  });

  /**
   * Svelte action: prioritise a static JPEG when the placeholder is near the
   * sidebar viewport. A separate low-priority background job (started after
   * main paint) fills the rest of the document over time without scrolling.
   * Once `pageThumbnailOverrides[pageNum-1]` exists, the template swaps to
   * `<img>` and this action is destroyed — no re-render on zoom/scroll.
   */
  function requestStaticThumb(node: HTMLElement, pageNum: number) {
    let currentPage = pageNum;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      void ensurePageThumbnail(currentPage);
    };

    // Visible cards jump the queue ahead of the background fill.
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (cancelled) return;
          const hit = entries.some((e) => e.isIntersecting);
          if (hit) {
            run();
            // One-shot: after request, stop observing (img swap unmounts us)
            observer?.disconnect();
            observer = null;
          }
        },
        {
          // Viewport root works for both the side list and the grid overlay
          // (grid is not under sidebarContainer). Overflow clipping still
          // hides off-screen list cards from intersection.
          root: null,
          // Warm a few cards above/below the visible strip
          rootMargin: "240px 0px 240px 0px",
          threshold: 0.01,
        },
      );
      observer.observe(node);
    } else {
      // No IO support: fall back to immediate generate for this card only
      run();
    }

    return {
      update(nextPage: number) {
        currentPage = nextPage;
        // Only regenerate if still mounted as placeholder (cache miss)
        if (!observer) run();
      },
      destroy() {
        cancelled = true;
        observer?.disconnect();
        observer = null;
      },
    };
  }

  $effect(() => {
    const activePage = activeDoc.currentPage;
    const targetCard = thumbnailElements[activePage];
    if (targetCard && !(activeDoc as any).isClickScrolling) {
      targetCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  function jumpToTargetPage(pageNum: number) {
    (activeDoc as any).isClickScrolling = true;
    activeDoc.currentPage = pageNum;
  }

  /**
   * After page delete: drop page-bound session data for removed pages
   * (bookmarks, comments, hyperlinks, form fields + orphaned form values).
   * Reorder does not need this — page identities stay the same.
   */
  function prunePageBoundSessionToPageOrder() {
    const pruned = prunePageBoundToOrder(
      activeDoc.pageOrder,
      activeDoc.bookmarks,
      activeDoc.comments,
      activeDoc.hyperlinks,
      activeDoc.formFields,
      activeDoc.formValues,
    );
    activeDoc.bookmarks = pruned.bookmarks;
    activeDoc.comments = pruned.comments;
    activeDoc.hyperlinks = pruned.hyperlinks;
    activeDoc.formFields = pruned.formFields;
    activeDoc.formValues = pruned.formValues as typeof activeDoc.formValues;
  }

  /**
   * After merge/blank insert rewrites bytes as sequential pages 1..N,
   * remap session page-bound data the same way thumbnails are remapped
   * (bookmarks, comments, shapes, rotations, hyperlinks, form fields).
   */
  function applySessionRemapAfterInsert(
    prePagesOrder: number[],
    extraPageCount: number,
    postPagesOrder: number[],
  ) {
    const remapped = remapSessionAfterPageInsert({
      prePagesOrder,
      extraPageCount,
      postPagesOrder,
      bookmarks: activeDoc.bookmarks,
      comments: activeDoc.comments,
      shapes: activeDoc.shapes,
      rotations: activeDoc.rotations,
      currentPage: activeDoc.currentPage,
      hyperlinks: activeDoc.hyperlinks,
      formFields: activeDoc.formFields,
      formValues: activeDoc.formValues,
    });
    activeDoc.bookmarks = remapped.bookmarks;
    activeDoc.comments = remapped.comments;
    activeDoc.shapes = remapped.shapes;
    activeDoc.rotations = remapped.rotations;
    activeDoc.currentPage = remapped.currentPage;
    activeDoc.hyperlinks = remapped.hyperlinks;
    activeDoc.formFields = remapped.formFields;
    // formValues stay name-keyed; pass-through keeps filled values with remapped fields
    activeDoc.formValues = remapped.formValues as typeof activeDoc.formValues;
    activeDoc.selectedShape = null;
    activeDoc.selectedShapes = [];
  }

  function dropTargetPageElement(e: MouseEvent, pageNum: number) {
    e.stopPropagation();
    if (activeDoc.pageOrder.length <= 1) {
      alert(
        "Cannot drop pages past a single root document sheet canvas layer bound.",
      );
      return;
    }
    pushHistorySnapshot();
    activeDoc.pageOrder = activeDoc.pageOrder.filter((n) => n !== pageNum);
    if (activeDoc.currentPage === pageNum) {
      activeDoc.currentPage =
        activeDoc.pageOrder[Math.max(0, activeDoc.pageOrder.length - 1)] || 1;
    }
    prunePageBoundSessionToPageOrder();
    activeDoc.selectedShape = null;
    activeDoc.selectedShapes = [];
  }

  async function handleInsertFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (
      !input.files ||
      input.files.length === 0 ||
      !activeDoc.rawBytes ||
      insertAfterPageNum === null
    )
      return;
    const file = input.files[0];

    try {
      pushHistorySnapshot();
      const arrayBuffer = await file.arrayBuffer();
      const appendBytes = new Uint8Array(arrayBuffer);
      const cleanMainBytes = new Uint8Array(
        $state.snapshot(activeDoc.rawBytes),
      );

      // High-speed direct binary transfer over Tauri IPC bridge
      const unprotectedMainRes = await invoke<ArrayBuffer | Uint8Array>("unprotect_pdf", {
        bytes: cleanMainBytes,
      });
      const unprotectedAppendRes = await invoke<ArrayBuffer | Uint8Array>("unprotect_pdf", {
        bytes: appendBytes,
      });

      // Wrap directly into a view without JSON array re-parsing loops
      const mainDoc = await PDFDocument.load(new Uint8Array(unprotectedMainRes));
      const extraDoc = await PDFDocument.load(new Uint8Array(unprotectedAppendRes));
      const mergedDoc = await PDFDocument.create();

      const targetIndex = activeDoc.pageOrder.indexOf(insertAfterPageNum);
      const prePagesOrder = activeDoc.pageOrder.slice(0, targetIndex + 1);
      const postPagesOrder = activeDoc.pageOrder.slice(targetIndex + 1);

      const prePages = await mergedDoc.copyPages(
        mainDoc,
        prePagesOrder.map((n) => n - 1),
      );
      for (const p of prePages || []) mergedDoc.addPage(p);

      const extraPageCount = extraDoc.getPageCount();
      const extraPages = await mergedDoc.copyPages(
        extraDoc,
        Array.from({ length: extraPageCount }, (_, i) => i),
      );
      for (const p of extraPages || []) mergedDoc.addPage(p);

      const postPages = await mergedDoc.copyPages(
        mainDoc,
        postPagesOrder.map((n) => n - 1),
      );
      for (const p of postPages || []) mergedDoc.addPage(p);

      const newRawBytes = await mergedDoc.save();
      // Use pdf-lib page count — do NOT open a temporary pdf.js getDocument here.
      // Destroying that temp task races the global worker and aborts the shared
      // document that sidebar thumbs need for generatePageThumbnailDataUrl.
      const numPages = mergedDoc.getPageCount();

      // Drop the old shared PDF before rebinding bytes so paints use the merge.
      // NOTE: destroy → clearPdfRenderQueue sets lowPriorityAllowed=false;
      // refreshThumbnailsAfterPageInsert re-enables it and force-paints new pages.
      await destroySharedWorkspacePdf({ destroyWorker: false });
      activeDoc.rawBytes = newRawBytes;
      activeDoc.pageCount = numPages;
      // Bookmarks/comments/shapes travel with content through the rewrite
      applySessionRemapAfterInsert(prePagesOrder, extraPageCount, postPagesOrder);
      activeDoc.pageOrder = Array.from(
        { length: numPages },
        (_, idx) => idx + 1,
      );
      // Remap surviving thumbs + await force-generate for every inserted page
      // (page + menu Add/Merge and grid batch-insert all use this path)
      await refreshThumbnailsAfterPageInsert(
        prePagesOrder,
        extraPageCount,
        postPagesOrder,
        newRawBytes,
      );

      input.value = "";
      insertAfterPageNum = null;
    } catch (err) {
      console.error("Document insertion fault details:", err);
      alert("Failed to parse or insert the selected PDF document.");
    }
  }

  function toggleGridView() {
    const opening = !isGridViewOpen;
    isGridViewOpen = opening;
    if (opening) {
      selectedPages = [activeDoc.currentPage];
    }
    // Static JPEG cache is shared between sidebar and grid — no repaint needed.
  }

  function closeGridView() {
    if (!isGridViewOpen) return;
    isGridViewOpen = false;
  }

  function handleGridSelect(e: MouseEvent, pageNum: number) {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl) {
      if (selectedPages.includes(pageNum)) {
        selectedPages = selectedPages.filter(p => p !== pageNum);
      } else {
        selectedPages = [...selectedPages, pageNum];
      }
    } else {
      selectedPages = [pageNum];
    }
    activeDoc.currentPage = pageNum;
  }

  function batchRotate(direction: "counter" | "clockwise") {
    if (selectedPages.length === 0) return;
    for (const pageNum of selectedPages || []) {
      rotatePageAction(pageNum, direction);
    }
  }

  function batchDelete() {
    if (selectedPages.length === 0) return;
    if (activeDoc.pageOrder.length <= selectedPages.length) {
      alert("Cannot delete all pages. The document must contain at least one layer bound.");
      return;
    }
    pushHistorySnapshot();
    activeDoc.pageOrder = activeDoc.pageOrder.filter(p => !selectedPages.includes(p));
    if (!activeDoc.pageOrder.includes(activeDoc.currentPage)) {
      activeDoc.currentPage = activeDoc.pageOrder[0] || 1;
    }
    prunePageBoundSessionToPageOrder();
    selectedPages = [activeDoc.currentPage];
    activeDoc.selectedShape = null;
    activeDoc.selectedShapes = [];
  }

  function triggerBatchInsert() {
    if (selectedPages.length === 0) {
      insertAfterPageNum = activeDoc.pageOrder[activeDoc.pageOrder.length - 1] || 1;
    } else {
      insertAfterPageNum = Math.max(...selectedPages);
    }
    appendFileInput?.click();
  }

  function handleMergeAction() {
    insertAfterPageNum = activeDoc.currentPage || activeDoc.pageOrder[activeDoc.pageOrder.length - 1] || 1;
    appendFileInput?.click();
  }

  async function handleInsertBlankPage() {
    if (!activeDoc.rawBytes) return;
    try {
      pushHistorySnapshot();
      
      const cleanMainBytes = new Uint8Array($state.snapshot(activeDoc.rawBytes));
      
      const unprotectedMainRes = await invoke<ArrayBuffer | Uint8Array>("unprotect_pdf", {
        bytes: cleanMainBytes,
      });

      const mainDoc = await PDFDocument.load(new Uint8Array(unprotectedMainRes));
      const mergedDoc = await PDFDocument.create();

      const afterPageNum = activeDoc.currentPage || activeDoc.pageOrder[activeDoc.pageOrder.length - 1] || 1;
      const targetIndex = activeDoc.pageOrder.indexOf(afterPageNum);
      const prePagesOrder = activeDoc.pageOrder.slice(0, targetIndex + 1);
      const postPagesOrder = activeDoc.pageOrder.slice(targetIndex + 1);

      const prePages = await mergedDoc.copyPages(
        mainDoc,
        prePagesOrder.map((n) => n - 1),
      );
      for (const p of prePages || []) mergedDoc.addPage(p);

      mergedDoc.addPage([595.276, 841.89]); // A4 Page

      const postPages = await mergedDoc.copyPages(
        mainDoc,
        postPagesOrder.map((n) => n - 1),
      );
      for (const p of postPages || []) mergedDoc.addPage(p);

      const newRawBytes = await mergedDoc.save();
      // pdf-lib count only — avoid temp pdf.js getDocument (worker race on destroy)
      const numPages = mergedDoc.getPageCount();

      await destroySharedWorkspacePdf({ destroyWorker: false });
      activeDoc.rawBytes = newRawBytes;
      activeDoc.pageCount = numPages;
      // Bookmarks/comments/shapes travel with content through the rewrite
      applySessionRemapAfterInsert(prePagesOrder, 1, postPagesOrder);
      activeDoc.pageOrder = Array.from(
        { length: numPages },
        (_, idx) => idx + 1,
      );
      await refreshThumbnailsAfterPageInsert(
        prePagesOrder,
        1,
        postPagesOrder,
        newRawBytes,
      );
    } catch (err) {
      console.error("Blank page insertion failure:", err);
      alert("Failed to insert blank page.");
    }
  }

  function handleGridSortEnd(oldIndex: number | undefined, newIndex: number | undefined) {
    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;

    pushHistorySnapshot();
    
    const draggedPage = activeDoc.pageOrder[oldIndex];
    let newOrder = [...(activeDoc.pageOrder || [])];

    if (selectedPages.includes(draggedPage) && selectedPages.length > 1) {
      // Preserve relative document order of the multi-selected block
      // (not click-selection order) so bookmarks/comments stay with pages.
      const moving = (activeDoc.pageOrder || []).filter((p) =>
        selectedPages.includes(p),
      );
      const referencePage = activeDoc.pageOrder[newIndex];
      newOrder = newOrder.filter((p) => !selectedPages.includes(p));
      let insertAt = newOrder.indexOf(referencePage);
      if (oldIndex < newIndex) {
        insertAt += 1;
      }
      if (insertAt < 0) insertAt = newOrder.length;
      newOrder.splice(insertAt, 0, ...moving);
    } else {
      const [movedPage] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, movedPage);
    }
    
    // Reorder only changes pageOrder; page identities (and thus bookmarks /
    // comments keyed by pageNum) travel with their pages automatically.
    activeDoc.pageOrder = newOrder;
  }

  function setupSortableGrid(node: HTMLElement) {
    const sortableInstance = Sortable.create(node, {
      animation: 200,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackClass: "sortable-fallback",
      ghostClass: "opacity-10",
      chosenClass: "border-cyan-500/40",
      dragClass: "cursor-grabbing",
      onEnd: (evt) => {
        handleGridSortEnd(evt.oldIndex, evt.newIndex);
      }
    });

    return {
      destroy() {
        sortableInstance.destroy();
      }
    };
  }

  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (event: MouseEvent) => {
      if (node && !node.contains(event.target as Node) && !event.defaultPrevented) {
        callback();
      }
    };

    document.addEventListener("click", handleClick, true);

    return {
      destroy() {
        document.removeEventListener("click", handleClick, true);
      }
    };
  }
</script>

<div
  class="{activeSidebarTab === 'thumbnails' ? 'w-36' : 'w-56'} h-full border-l flex flex-col relative select-none z-40 transition-all duration-200 ease-in-out"
  style="background: var(--sdf-bg-app); border-color: var(--sdf-border-subtle);"
>
  <div class="flex flex-col border-b w-full" style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-chrome) 40%, transparent);">
    <div class="grid grid-cols-4 items-center px-2 py-1.5" style="border-bottom: 1px solid var(--sdf-border-subtle); color: var(--sdf-text-secondary);">
      
      <button 
        onclick={() => activeSidebarTab = 'thumbnails'}
        class="flex justify-center p-1.5 rounded transition-all"
        style={activeSidebarTab === 'thumbnails' ? 'color: var(--sdf-accent); background: var(--sdf-hover-bg);' : 'color: var(--sdf-text-muted);'}
        title="Thumbnails View">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3h6v18H3z" />
          <path d="M14 3h7" />
          <path d="M14 8h7" />
          <path d="M14 13h7" />
        </svg>
      </button>

      {#if activeDoc.fileType !== 'image'}
        <button 
          onclick={toggleGridView}
          class="flex justify-center p-1.5 rounded transition-all"
          style={isGridViewOpen ? 'color: #fbbf24; background: var(--sdf-hover-bg);' : 'color: var(--sdf-text-muted);'}
          title="Expand Workspace Grid View">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="4" height="4" rx="0.5" />
            <rect x="11" y="3" width="4" height="4" rx="0.5" />
            <rect x="19" y="3" width="4" height="4" rx="0.5" />
            <rect x="3" y="11" width="4" height="4" rx="0.5" />
            <rect x="11" y="11" width="4" height="4" rx="0.5" />
            <rect x="19" y="11" width="4" height="4" rx="0.5" />
            <rect x="3" y="19" width="4" height="4" rx="0.5" />
            <rect x="11" y="19" width="4" height="4" rx="0.5" />
            <rect x="19" y="19" width="4" height="4" rx="0.5" />
          </svg>
        </button>
      {/if}

      {#if activeDoc.fileType !== 'image'}
        <button 
          onclick={() => activeSidebarTab = 'bookmarks'}
          class="flex justify-center p-1.5 rounded transition-all"
          style={activeSidebarTab === 'bookmarks' ? 'color: var(--sdf-accent); background: var(--sdf-hover-bg);' : 'color: var(--sdf-text-muted);'}
          title="Document Bookmarks">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        <button 
          onclick={() => activeSidebarTab = 'comments'}
          class="flex justify-center p-1.5 rounded transition-all"
          style={activeSidebarTab === 'comments' ? 'color: var(--sdf-accent); background: var(--sdf-hover-bg);' : 'color: var(--sdf-text-muted);'}
          title="Annotation Comments">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      {/if}
    </div>

    <div class="flex items-center justify-center py-1" style="background: var(--sdf-bg-surface);">
      <span class="text-[9px] font-bold uppercase tracking-widest font-sans" style="color: var(--sdf-text-muted);">
        {#if activeSidebarTab === 'thumbnails'}
          Pages ({activeDoc.pageOrder.length})
        {:else if activeSidebarTab === 'bookmarks'}
          Bookmarks ({sortedBookmarks.length})
        {:else}
          Comments ({totalCommentCount})
        {/if}
      </span>
    </div>
  </div>

{#if activeSidebarTab === 'thumbnails'}
  <div
    bind:this={sidebarContainer}
    data-sidebar-thumb-scroll
    class="flex-1 overflow-y-auto overflow-x-hidden p-3 relative"
    style="color-scheme: dark;"
  >
    <div class="relative w-full flex flex-col gap-3">
      <!-- Multi-doc switching is handled by DocumentTabs (top bar). Keep sidebar focused on pages. -->

      {#if hasUserScrolled && activeDoc.pageOrder.length > 0 && activeDoc.scrollHeight > 0}
        <div 
          class="absolute left-2 right-2 pointer-events-none border-2 border-red-500 bg-red-500/10 rounded z-30 shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-none"
          style="transform: translateY({globalRedBoxTop}px); height: {globalRedBoxHeight}px; top: 0;"
        ></div>
      {/if}

      {#each activeDoc.pageOrder || [] as pageNum, index (pageNum)}
        <div
          bind:this={thumbnailElements[pageNum]}
          data-sidebar-page={pageNum}
          onclick={() => jumpToTargetPage(pageNum)}
          class="group flex flex-col items-center border rounded-lg p-2 transition-all cursor-pointer select-none {isPageMenuOpen && insertAfterPageNum === pageNum ? 'relative z-[60] isolate' : 'relative z-10'}"
          style="background: {activeDoc.currentPage === pageNum ? 'var(--sdf-bg-elevated)' : 'var(--sdf-bg-surface)'}; border-color: {activeDoc.currentPage === pageNum ? 'var(--sdf-border)' : 'var(--sdf-border-subtle)'};"
        >
          <span
            class="absolute top-1.5 left-2 text-[9px] font-bold tracking-wider z-10"
            style="color: var(--sdf-text-muted);"
          >
            #{index + 1}
          </span>

          {#if activeDoc.fileType === 'image'}
            <div class="w-full aspect-[3/4] bg-slate-950 border border-cyan-500/30 rounded flex items-center justify-center overflow-hidden p-1 p-2">
              <!-- Prefer post-save flattened override (annotations baked in); fall back to live imageUrl -->
              {#key activeDoc.thumbnailVersion}
                <img
                  src={(activeDoc.pageThumbnailOverrides || {})[0] || activeDoc.imageUrl}
                  alt="Image Thumbnail"
                  class="w-full h-full object-cover rounded-sm opacity-80"
                />
              {/key}
            </div>
          {:else}
            {@const cachedThumb = (activeDoc.pageThumbnailOverrides || {})[pageNum - 1]}
            <div
              class="w-[84px] min-h-[60px] bg-white/5 rounded border border-slate-900/40 overflow-hidden flex items-center justify-center mt-3 shadow-inner relative thumbnail-footprint"
            >
              {#if cachedThumb}
                <img
                  src={cachedThumb}
                  alt="Page {pageNum}"
                  class="block h-auto max-w-full bg-white"
                  draggable="false"
                />
              {:else}
                <div
                  use:requestStaticThumb={pageNum}
                  class="w-full min-h-[60px] flex items-center justify-center text-[9px] font-mono text-slate-500 select-none"
                >
                  p.{pageNum}
                </div>
              {/if}
            </div>
          {/if}

          <div
            class="flex items-center justify-center gap-1 mt-2.5 w-full transition-opacity
            {isPageMenuOpen && insertAfterPageNum === pageNum ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}"
          >
            <button
              onclick={(e) => {
                e.stopPropagation();
                rotatePageAction(pageNum, "counter");
              }}
              class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Rotate Left"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                /><path d="M3 3v5h5" />
              </svg>
            </button>

            <div class="relative z-[60] isolate font-sans text-left">
              <button
                disabled={activeDoc.fileType === 'image'}
                onclick={(e) => {
                  e.stopPropagation();
                  insertAfterPageNum = pageNum;
                  isPageMenuOpen = !isPageMenuOpen;
                }}
                class="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors {activeDoc.fileType === 'image' ? 'opacity-30 pointer-events-none' : ''}"
                title={activeDoc.fileType === 'image' ? "Structural merging and page injection require a PDF layout document." : "Page Options"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line><line
                    x1="5"
                    y1="12"
                    x2="19"
                    y2="12"
                  ></line>
                </svg>
              </button>

              {#if isPageMenuOpen && insertAfterPageNum === pageNum && activeDoc.fileType !== 'image'}
                <div 
                  class="absolute bottom-full left-0 mb-2 rounded flex flex-col gap-0.5 min-w-[125px] shadow-2xl p-1.5 pointer-events-auto"
                  style="z-index: 99999 !important; background-color: var(--sdf-overlay-bg) !important; border: 1px solid var(--sdf-overlay-border) !important; opacity: 1 !important; color: var(--sdf-text-primary);"
                  use:clickOutside={() => isPageMenuOpen = false}
                >
                  <button
                    class="w-full text-left px-2 py-1 rounded text-[10px] font-medium transition-all"
                    style="color: var(--sdf-text-secondary);"
                    onclick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      isPageMenuOpen = false;
                      handleMergeAction(); 
                    }}
                  >
                    Add/Merge...
                  </button>
                  
                  <button
                    class="w-full text-left px-2 py-1 rounded text-[10px] font-medium transition-all"
                    style="color: var(--sdf-text-secondary);"
                    onclick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      isPageMenuOpen = false;
                      handleInsertBlankPage(); 
                    }}
                  >
                    Insert Blank
                  </button>
                </div>
              {/if}
            </div>

            {#if activeDoc.fileType !== 'image'}
              <button
                type="button"
                disabled={activeDoc.pageOrder.length <= 1}
                class="p-1 rounded transition-all 
                  {activeDoc.pageOrder.length <= 1 
                    ? 'opacity-20 cursor-not-allowed pointer-events-none text-slate-600' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-red-400'}"
                onclick={(e) => {
                  e.stopPropagation();
                  if (activeDoc.pageOrder.length <= 1) return;
                  dropTargetPageElement(e, pageNum);
                }}
                title={activeDoc.pageOrder.length <= 1 ? "Cannot delete the sole sheet of a document" : "Delete Page"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 6h18" /><path
                    d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                  /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            {/if}

            <button
              onclick={(e) => {
                e.stopPropagation();
                rotatePageAction(pageNum, "clockwise");
              }}
              class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Rotate Right"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
                /><path d="M21 3v5h-5" />
              </svg>
            </button>
          </div>
        </div>
      {/each}

      <input
        type="file"
        accept=".pdf"
        bind:this={appendFileInput}
        onchange={handleInsertFile}
        class="hidden"
      />
    </div>
  </div>
{:else}
  {#if activeSidebarTab === 'bookmarks'}
    <div class="flex flex-col gap-2 p-2 overflow-y-auto w-full h-[calc(100vh-80px)]">
      {#if sortedBookmarks.length === 0}
        <div class="text-center text-[10px] mt-12 px-4 leading-relaxed" style="color: var(--sdf-text-muted);">
          No bookmarked elements staged. Hover near the top right of document pages to register quick reference flags.
        </div>
      {:else}
        {#each sortedBookmarks as b (b.pageNum)}
          <div class="flex items-center justify-between p-2.5 rounded-lg transition-all group w-full" style="background: var(--sdf-bg-surface); border: 1px solid var(--sdf-border-subtle);">
            {#if editingBookmarkId === b.pageNum}
              <div class="flex items-center gap-1.5 w-full">
                <input 
                  type="text"
                  bind:value={editingBookmarkName}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      updateBookmarkNameAction(b.pageNum, editingBookmarkName);
                      editingBookmarkId = null;
                    } else if (e.key === 'Escape') {
                      editingBookmarkId = null;
                    }
                  }}
                  class="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-cyan-500 flex-1 min-w-0 font-sans"
                  style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
                  autofocus
                />
                <button 
                  onclick={() => {
                    updateBookmarkNameAction(b.pageNum, editingBookmarkName);
                    editingBookmarkId = null;
                  }}
                  class="text-emerald-400 p-0.5 rounded">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            {:else}
              <button 
                onclick={() => jumpToTargetPage(b.pageNum)}
                class="flex-1 text-left min-w-0 font-sans transition-colors">
                <span class="text-[10px] font-semibold block truncate pr-1" style="color: {b.name ? 'var(--sdf-text-primary)' : 'var(--sdf-text-muted)'};">
                  {b.name || 'Untitled bookmark...'}
                </span>
              </button>

              <div class="flex items-center justify-end pl-1 shrink-0">
                <span class="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest group-hover:hidden" style="background: var(--sdf-bg-chrome); color: var(--sdf-text-muted);">
                  p. {displayPagePosition(activeDoc.pageOrder, b.pageNum) || b.pageNum}
                </span>

                <div class="hidden group-hover:flex items-center gap-1">
                  <button 
                    onclick={(e) => { 
                      e.stopPropagation(); 
                      editingBookmarkId = b.pageNum; 
                      editingBookmarkName = b.name; 
                    }}
                    class="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-900 transition-colors"
                    title="Rename Bookmark">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <button 
                    onclick={(e) => { 
                      e.stopPropagation(); 
                      deleteBookmarkAction(b.pageNum); 
                    }}
                    class="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-900 transition-colors"
                    title="Remove Bookmark">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Comments panel: all pages, document-wide list -->
    <div class="flex flex-col gap-2 p-2 overflow-y-auto w-full h-[calc(100vh-80px)]">
      {#if visibleComments.length === 0}
        <div class="text-center text-[10px] mt-12 px-3 leading-relaxed" style="color: var(--sdf-text-muted);">
          No comments in this document yet. Use the comment bubble on a page, or right-click the page and choose Add Comment Here.
        </div>
      {:else}
        {#each visibleComments as thread (thread.id)}
          <div
            data-comment-thread={thread.id}
            class="rounded-lg border transition-all overflow-hidden
              {focusedThreadId === thread.id
                ? 'border-amber-400/70 ring-1 ring-amber-400/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                : ''}"
            style="background: var(--sdf-bg-surface); border-color: {focusedThreadId === thread.id ? '#fbbf24' : 'var(--sdf-border-subtle)'};"
          >
            <div class="p-2.5">
              <div class="flex items-start justify-between gap-1 mb-1">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span
                      class="text-[10px] font-semibold truncate"
                      style="color: var(--sdf-text-primary);"
                      title={thread.authorFullName || thread.author}
                    >{thread.author}</span>
                    <span class="text-[8px] font-mono" style="color: var(--sdf-text-faint);">{formatCommentTime(thread.createdAt)}</span>
                    {#if typeof thread.x === "number" && typeof thread.y === "number"}
                      <span
                        class="text-[9px] text-amber-400/90"
                        title="On-page flag"
                        aria-hidden="true"
                      >⚑</span>
                    {/if}
                    <button
                      onclick={() => jumpToTargetPage(thread.pageNum)}
                      class="text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider"
                      style="background: var(--sdf-bg-chrome); color: var(--sdf-accent);"
                      title="Go to page"
                    >
                      p.{displayPagePosition(activeDoc.pageOrder, thread.pageNum) || thread.pageNum}
                    </button>
                  </div>
                </div>
                <button
                  onclick={() => deleteCommentAction(thread.id)}
                  class="p-0.5 rounded hover:text-red-400 shrink-0"
                  style="color: var(--sdf-text-faint);"
                  title="Delete thread"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
              <p class="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-sans" style="color: var(--sdf-text-secondary);">{thread.text}</p>

              <div class="mt-1.5 flex items-center gap-2">
                <button
                  onclick={() => {
                    openReplyId = openReplyId === thread.id ? null : thread.id;
                  }}
                  class="text-[9px] font-bold uppercase tracking-wide text-slate-500 hover:text-cyan-400 transition-colors"
                >
                  Reply{(thread.replies?.length || 0) > 0 ? ` (${thread.replies.length})` : ""}
                </button>
              </div>
            </div>

            {#if (thread.replies || []).length > 0}
              <div class="px-2.5 py-1.5 space-y-2" style="border-top: 1px solid var(--sdf-border-subtle); background: var(--sdf-bg-elevated);">
                {#each thread.replies || [] as reply (reply.id)}
                  {@const replyEditKey = `${thread.id}:${reply.id}`}
                  <div class="pl-2" style="border-left: 2px solid var(--sdf-border);">
                    <div class="flex items-start justify-between gap-1">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span
                          class="text-[9px] font-semibold truncate"
                          style="color: var(--sdf-text-secondary);"
                          title={reply.authorFullName || reply.author}
                        >{reply.author}</span>
                        <span class="text-[8px] font-mono" style="color: var(--sdf-text-faint);">{formatCommentTime(reply.createdAt)}</span>
                      </div>
                      <div class="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onclick={() => startEditReply(thread.id, reply.id, reply.text)}
                          class="p-0.5 rounded hover:text-amber-400"
                          style="color: var(--sdf-text-faint);"
                          title="Edit reply"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        </button>
                        <button
                          type="button"
                          onclick={() => deleteReplyAction(thread.id, reply.id)}
                          class="p-0.5 rounded hover:text-red-400"
                          style="color: var(--sdf-text-faint);"
                          title="Delete reply"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                    {#if editingReplyKey === replyEditKey}
                      <div class="flex flex-col gap-1 mt-0.5">
                        <textarea
                          use:autoGrowTextarea={{ minRows: 2, maxRows: 8 }}
                          bind:value={editReplyDraft}
                          rows="2"
                          onkeydown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              saveEditReply(thread.id, reply.id);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEditReply();
                            }
                          }}
                          class="w-full rounded px-2 py-1 text-[10px] focus:outline-none focus:border-amber-500/50 font-sans resize-none overflow-hidden"
                          style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
                        ></textarea>
                        <div class="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onclick={cancelEditReply}
                            class="px-1.5 py-0.5 text-[9px] font-bold uppercase"
                            style="color: var(--sdf-text-muted);"
                          >Cancel</button>
                          <button
                            type="button"
                            onclick={() => saveEditReply(thread.id, reply.id)}
                            disabled={!editReplyDraft.trim()}
                            class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase
                              {editReplyDraft.trim()
                                ? 'bg-amber-600/25 text-amber-300 border border-amber-500/40'
                                : 'cursor-not-allowed'}"
                            style={editReplyDraft.trim() ? '' : 'color: var(--sdf-text-faint);'}
                          >Save</button>
                        </div>
                      </div>
                    {:else}
                      <p class="text-[10px] leading-relaxed whitespace-pre-wrap break-words mt-0.5 font-sans" style="color: var(--sdf-text-secondary);">{reply.text}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if openReplyId === thread.id}
              <div class="p-2 flex flex-col gap-1.5" style="border-top: 1px solid var(--sdf-border-subtle); background: var(--sdf-bg-elevated);">
                <textarea
                  value={replyDrafts[thread.id] || ""}
                  oninput={(e) => {
                    replyDrafts = {
                      ...replyDrafts,
                      [thread.id]: (e.currentTarget as HTMLTextAreaElement).value,
                    };
                  }}
                  rows="2"
                  placeholder="Write a reply…"
                  onkeydown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      submitReply(thread.id);
                    } else if (e.key === "Escape") {
                      openReplyId = null;
                    }
                  }}
                  class="w-full rounded px-2 py-1 text-[10px] placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-500/50 font-sans"
                  style="background: var(--sdf-overlay-input-bg); border: 1px solid var(--sdf-overlay-input-border); color: var(--sdf-text-primary);"
                ></textarea>
                <div class="flex justify-end gap-1.5">
                  <button
                    onclick={() => (openReplyId = null)}
                    class="px-2 py-0.5 text-[9px] font-bold uppercase"
                    style="color: var(--sdf-text-muted);"
                  >
                    Cancel
                  </button>
                  <button
                    onclick={() => submitReply(thread.id)}
                    disabled={!(replyDrafts[thread.id] || "").trim()}
                    class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide
                      {(replyDrafts[thread.id] || "").trim()
                        ? 'bg-cyan-600/25 text-cyan-300 border border-cyan-500/40'
                        : 'cursor-not-allowed'}"
                    style={(replyDrafts[thread.id] || "").trim() ? '' : 'color: var(--sdf-text-faint);'}
                  >
                    Post reply
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/if}
</div>

{#if isGridViewOpen}
  <div transition:fade={{ duration: 180 }} class="fixed inset-0 z-[50] flex flex-col select-none font-sans" style="background: var(--sdf-canvas-bg); color: var(--sdf-text-primary);">
    <div class="p-4 border-b grid grid-cols-3 items-center shadow-lg w-full" style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border-subtle);">
      <div class="flex items-center gap-3 justify-start">
        <span class="text-xs font-bold uppercase tracking-widest" style="color: var(--sdf-text-secondary);">Grid Organizer</span>
        <span class="text-[10px] px-2 py-0.5 rounded-md font-mono font-bold" style="background: var(--sdf-bg-surface); color: var(--sdf-accent); border: 1px solid var(--sdf-border-subtle);">Selected: {selectedPages.length}</span>
      </div>
      
      <div class="flex items-center gap-2 justify-center">
        <button onclick={() => batchRotate("counter")} class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors" style="background: var(--sdf-bg-surface); color: var(--sdf-text-secondary); border: 1px solid var(--sdf-border-subtle);">Rotate Left</button>
        <button onclick={() => batchRotate("clockwise")} class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors" style="background: var(--sdf-bg-surface); color: var(--sdf-text-secondary); border: 1px solid var(--sdf-border-subtle);">Rotate Right</button>
        <button onclick={triggerBatchInsert} class="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold transition-colors">Insert PDF</button>
        <button onclick={batchDelete} class="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition-colors">Delete Selected</button>
      </div>
      
      <div class="flex items-center justify-end">
        <button onclick={closeGridView} class="px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-md" style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border: 1px solid var(--sdf-border);">Done</button>
      </div>
    </div>
    
    <div class="flex-1 overflow-y-auto p-8" style="background: var(--sdf-canvas-bg);" data-sidebar-thumb-scroll>
    <div 
      use:setupSortableGrid
      class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6"
    >
      {#each activeDoc.pageOrder || [] as pageNum, index (pageNum)}
        <div 
          data-sidebar-page={pageNum}
          onclick={(e) => handleGridSelect(e, pageNum)}
          class="group relative flex flex-col items-center border rounded-xl p-4 transition-all cursor-grab active:cursor-grabbing select-none"
          style="background: {selectedPages.includes(pageNum) ? 'rgba(245, 158, 11, 0.12)' : 'var(--sdf-bg-surface)'}; border-color: {selectedPages.includes(pageNum) ? '#f59e0b' : 'var(--sdf-border-subtle)'};"
        >
            <span class="absolute top-3 left-4 text-[10px] font-mono font-bold pointer-events-none" style="color: {selectedPages.includes(pageNum) ? '#f59e0b' : 'var(--sdf-text-muted)'};">#{index + 1}</span>
            
            {#if selectedPages.includes(pageNum)}
              <span class="absolute top-3 right-4 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-black text-black pointer-events-none">✓</span>
            {/if}
            
            <div class="w-[100px] min-h-[80px] bg-white/5 rounded-lg border overflow-hidden flex items-center justify-center mt-4 shadow-inner relative pointer-events-none" style="border-color: var(--sdf-border-subtle);">
              {#if (activeDoc.pageThumbnailOverrides || {})[pageNum - 1]}
                <img
                  src={(activeDoc.pageThumbnailOverrides || {})[pageNum - 1]}
                  alt="Page {pageNum}"
                  class="block h-auto max-w-full bg-white"
                  draggable="false"
                />
              {:else}
                <div
                  use:requestStaticThumb={pageNum}
                  class="w-full min-h-[80px] flex items-center justify-center text-[9px] font-mono select-none"
                  style="color: var(--sdf-text-muted);"
                >
                  p.{pageNum}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Styles the emulated floating card preview to track the cursor seamlessly over the modal panel layer */
  :global(.sortable-fallback) {
    position: fixed !important;
    z-index: 9999 !important;
    width: 146px !important;
    height: 172px !important;
    opacity: 0.85 !important;
    pointer-events: none !important;
    background-color: var(--sdf-bg-surface) !important;
    border: 2px solid #38bdf8 !important; /* Glowing cyan tracking graphic border */
    border-radius: 0.75rem !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7) !important;
    transform: scale(1.04) !important;
    overflow: hidden !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
  }
</style>
