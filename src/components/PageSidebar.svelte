<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import * as pdfjsLib from "pdfjs-dist";
  import { PDFDocument } from "pdf-lib";
  import { invoke } from "@tauri-apps/api/core";
  import Sortable from "sortablejs";
  import {
    activeDoc,
    rotatePageAction,
    pushHistorySnapshot,
    updateBookmarkNameAction,
    deleteBookmarkAction,
  } from "../pdfStore.svelte";

  let sidebarContainer = $state<HTMLDivElement | null>(null);
  let thumbnailElements = $state<Record<number, HTMLDivElement>>({});
  let appendFileInput = $state<HTMLInputElement | null>(null);
  let insertAfterPageNum = $state<number | null>(null);
  let isGridViewOpen = $state(false);
  let selectedPages = $state<number[]>([]);
  let activeSidebarTab = $state<'thumbnails' | 'bookmarks' | 'comments'>('thumbnails');

  let cachedRawBytes: Uint8Array | null = null;
  let sharedPdfjsDocPromise: Promise<any> | null = null;

  // --- Bookmark Editing State ---
  let editingBookmarkId = $state<number | null>(null);
  let editingBookmarkName = $state<string>("");

  // --- Bookmark Sorting Logic ---
  // Automatically sorts bookmarks based on their actual position in the document (pageOrder)
  let sortedBookmarks = $derived([...(activeDoc.bookmarks || [])].sort((a, b) => {
    const idxA = activeDoc.pageOrder.indexOf(a.pageNum);
    const idxB = activeDoc.pageOrder.indexOf(b.pageNum);
    return idxA - idxB;
  }));

  function getSharedPdfjsDoc() {
    if (activeDoc.fileType === "tiff" || activeDoc.fileType === "image" || !activeDoc.rawBytes) return null;
    
    // If the byte array reference changes, re-initialize the single master parsing handle
    if (activeDoc.rawBytes !== cachedRawBytes) {
      cachedRawBytes = activeDoc.rawBytes;
      console.log("PageSidebar: New document bytes detected. Instantiating single master worker channel...");
      
      const loadingTask = pdfjsLib.getDocument({
        data: activeDoc.rawBytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/"
      });
      sharedPdfjsDocPromise = loadingTask.promise;
    }
    
    return sharedPdfjsDocPromise;
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

  function renderThumbnail(
    node: HTMLCanvasElement,
    { pageNum, rotation }: { pageNum: number; rotation: number },
  ) {
    if (activeDoc.fileType === "tiff") {
      const pageData = activeDoc.tiffPages[pageNum - 1];
      const rotation = activeDoc.rotations[pageNum] ?? 0;
      
      if (pageData) {
        const blob = new Blob([pageData as any], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          // Swap visual frame dimensions dynamically if rotated on its side (90° or 270°)
          if (rotation === 90 || rotation === 270) {
            node.width = img.height;
            node.height = img.width;
          } else {
            node.width = img.width;
            node.height = img.height;
          }

          const ctx = node.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, node.width, node.height);
            ctx.save();
            
            // Translate coordinate space origin to the physical center of the updated canvas layout
            ctx.translate(node.width / 2, node.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            
            // Draw the blueprint anchored neatly over the center coordinate pivot
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            ctx.restore();
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
      return;
    }

    let isRendering = false;

    async function executeRender(pNum: number, rot: number) {
      if (!activeDoc.rawBytes || isRendering) return;
      isRendering = true;

      try {
        const docPromise = getSharedPdfjsDoc();
        if (!docPromise) return;

        // Await the shared master document instead of creating a new loadingTask
        const pdfDocument = await docPromise;
        const page = await pdfDocument.getPage(pNum);

        const targetWidth = 84;
        const unrotatedViewport = page.getViewport({ scale: 1 });
        const currentRotation = (page.rotate + rot) % 360;

        const isVerticalFactor = currentRotation % 180 === 0;
        const renderWidth = isVerticalFactor
          ? unrotatedViewport.width
          : unrotatedViewport.height;
        const calculatedScale = targetWidth / renderWidth;

        const viewport = page.getViewport({
          scale: calculatedScale,
          rotation: currentRotation,
        });

        node.height = viewport.height;
        node.width = viewport.width;

        await page.render({ canvasContext: node.getContext('2d')!, viewport: viewport }).promise;
      } catch (err) {
        console.error(`Thumbnail render failed for page ${pNum}:`, err);
      } finally {
        isRendering = false;
      }
    }

    executeRender(pageNum, rotation);
    return {
      update(newParams: { pageNum: number; rotation: number }) {
        executeRender(newParams.pageNum, newParams.rotation);
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

  function dropTargetPageElement(e: MouseEvent, pageNum: number) {
    e.stopPropagation();
    if (activeDoc.pageOrder.length <= 1) {
      alert(
        "Cannot drop pages past a single root document sheet canvas layer bound.",
      );
      return;
    }
    activeDoc.pageOrder = activeDoc.pageOrder.filter((n) => n !== pageNum);
    if (activeDoc.currentPage === pageNum) {
      const remainingIndex = activeDoc.pageOrder.indexOf(pageNum);
      activeDoc.currentPage =
        activeDoc.pageOrder[Math.max(0, remainingIndex - 1)];
    }
    activeDoc.selectedShape = null;
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
      for (const p of prePages) mergedDoc.addPage(p);

      const extraPageCount = extraDoc.getPageCount();
      const extraPages = await mergedDoc.copyPages(
        extraDoc,
        Array.from({ length: extraPageCount }, (_, i) => i),
      );
      for (const p of extraPages) mergedDoc.addPage(p);

      const postPages = await mergedDoc.copyPages(
        mainDoc,
        postPagesOrder.map((n) => n - 1),
      );
      for (const p of postPages) mergedDoc.addPage(p);

      const newRawBytes = await mergedDoc.save();

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(newRawBytes),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/"
      });
      const pdfDocument = await loadingTask.promise;

      activeDoc.rawBytes = newRawBytes;
      activeDoc.pageCount = pdfDocument.numPages;
      activeDoc.pageOrder = Array.from(
        { length: pdfDocument.numPages },
        (_, idx) => idx + 1,
      );

      input.value = "";
      insertAfterPageNum = null;
    } catch (err) {
      console.error("Document insertion fault details:", err);
      alert("Failed to parse or insert the selected PDF document.");
    }
  }

  function toggleGridView() {
    isGridViewOpen = !isGridViewOpen;
    if (isGridViewOpen) {
      selectedPages = [activeDoc.currentPage];
    }
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
    for (const pageNum of selectedPages) {
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
    selectedPages = [activeDoc.currentPage];
    activeDoc.selectedShape = null;
  }

  function triggerBatchInsert() {
    if (selectedPages.length === 0) {
      insertAfterPageNum = activeDoc.pageOrder[activeDoc.pageOrder.length - 1] || 1;
    } else {
      insertAfterPageNum = Math.max(...selectedPages);
    }
    appendFileInput?.click();
  }

  function handleGridSortEnd(oldIndex: number | undefined, newIndex: number | undefined) {
    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;

    pushHistorySnapshot();
    
    const draggedPage = activeDoc.pageOrder[oldIndex];
    let newOrder = [...activeDoc.pageOrder];

    if (selectedPages.includes(draggedPage) && selectedPages.length > 1) {
      const referencePage = activeDoc.pageOrder[newIndex];
      newOrder = newOrder.filter(p => !selectedPages.includes(p));
      let insertAt = newOrder.indexOf(referencePage);
      if (oldIndex < newIndex) {
        insertAt += 1;
      }
      newOrder.splice(insertAt, 0, ...selectedPages);
    } else {
      const [movedPage] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, movedPage);
    }
    
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
</script>

<div
  class="{activeSidebarTab === 'thumbnails' ? 'w-36' : 'w-56'} h-full bg-[#090d16] border-l border-slate-900 flex flex-col relative select-none z-40 transition-all duration-200 ease-in-out"
>
  <div class="flex flex-col border-b border-slate-900/50 bg-[#0b101c]/40 w-full">
    <div class="grid grid-cols-4 items-center border-b border-slate-900/20 px-2 py-1.5 text-slate-400">
      
      <button 
        onclick={() => activeSidebarTab = 'thumbnails'}
        class="flex justify-center p-1.5 rounded transition-all hover:text-white {activeSidebarTab === 'thumbnails' ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500'}"
        title="Thumbnails View">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3h6v18H3z" />
          <path d="M14 3h7" />
          <path d="M14 8h7" />
          <path d="M14 13h7" />
        </svg>
      </button>

      <button 
        onclick={toggleGridView}
        class="flex justify-center p-1.5 rounded transition-all hover:text-white {isGridViewOpen ? 'text-amber-400 bg-slate-800/50' : 'text-slate-500'}"
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

      <button 
        onclick={() => activeSidebarTab = 'bookmarks'}
        class="flex justify-center p-1.5 rounded transition-all hover:text-white {activeSidebarTab === 'bookmarks' ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500'}"
        title="Document Bookmarks">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      <button 
        onclick={() => activeSidebarTab = 'comments'}
        class="flex justify-center p-1.5 rounded transition-all hover:text-white {activeSidebarTab === 'comments' ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500'}"
        title="Annotation Comments">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    </div>

    <div class="flex items-center justify-center py-1 bg-[#070a12]/30">
      <span class="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-sans">
        {#if activeSidebarTab === 'thumbnails'}
          Pages ({activeDoc.pageOrder.length})
        {:else if activeSidebarTab === 'bookmarks'}
          Bookmarks ({sortedBookmarks.length})
        {:else}
          Comments (0)
        {/if}
      </span>
    </div>
  </div>

{#if activeSidebarTab === 'thumbnails'}
  <div
    bind:this={sidebarContainer}
    class="flex-1 overflow-y-auto overflow-x-hidden p-3 relative"
    style="color-scheme: dark;"
  >
    <div class="relative w-full flex flex-col gap-3">
      {#if hasUserScrolled && activeDoc.pageOrder.length > 0 && activeDoc.scrollHeight > 0}
        <div 
          class="absolute left-2 right-2 pointer-events-none border-2 border-red-500 bg-red-500/10 rounded z-30 shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-none"
          style="transform: translateY({globalRedBoxTop}px); height: {globalRedBoxHeight}px; top: 0;"
        ></div>
      {/if}

      {#each activeDoc.pageOrder as pageNum, index (pageNum)}
        <div
          bind:this={thumbnailElements[pageNum]}
          onclick={() => jumpToTargetPage(pageNum)}
          class="group relative flex flex-col items-center bg-[#111827]/40 border rounded-lg p-2 transition-all cursor-pointer select-none z-20
          {activeDoc.currentPage === pageNum
            ? 'border-slate-600 bg-[#161b22]'
            : 'border-slate-800 hover:border-slate-700'}"
        >
          <span
            class="absolute top-1.5 left-2 text-[9px] font-bold text-slate-500 tracking-wider z-10"
          >
            #{index + 1}
          </span>

          {#if activeDoc.fileType === 'image'}
            <div class="w-full aspect-[3/4] bg-slate-950 border border-cyan-500/30 rounded flex items-center justify-center overflow-hidden p-1 p-2">
              <img 
                src={activeDoc.imageUrl} 
                alt="Image Thumbnail" 
                class="w-full h-full object-cover rounded-sm opacity-80"
              />
            </div>
          {:else}
            <div
              class="w-[84px] min-h-[60px] bg-white/5 rounded border border-slate-900/40 overflow-hidden flex items-center justify-center mt-3 shadow-inner relative thumbnail-footprint"
            >
              <canvas
                use:renderThumbnail={{
                  pageNum,
                  rotation: activeDoc.rotations[pageNum] ?? 0,
                }}
                class="block h-auto max-w-full bg-white filter tracking-tight"
              ></canvas>
            </div>
          {/if}

          <div
            class="flex items-center justify-center gap-1 mt-2.5 w-full opacity-40 group-hover:opacity-100 transition-opacity"
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

            <button
              onclick={(e) => {
                e.stopPropagation();
                insertAfterPageNum = pageNum;
                appendFileInput?.click();
              }}
              class="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              title="Insert PDF After This Page"
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

            <button
              onclick={(e) => dropTargetPageElement(e, pageNum)}
              class="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition-colors"
              title="Delete Page"
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
        <div class="text-center text-[10px] text-slate-600 mt-12 px-4 leading-relaxed">
          No bookmarked elements staged. Hover near the top right of document pages to register quick reference flags.
        </div>
      {:else}
        {#each sortedBookmarks as b (b.pageNum)}
          <div class="flex items-center justify-between p-2.5 rounded-lg border border-slate-900/50 bg-[#0e1321]/40 hover:bg-slate-800/30 hover:border-slate-700/30 transition-all group w-full">
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
                  class="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500 flex-1 min-w-0 font-sans"
                  autofocus
                />
                <button 
                  onclick={() => {
                    updateBookmarkNameAction(b.pageNum, editingBookmarkName);
                    editingBookmarkId = null;
                  }}
                  class="text-emerald-400 p-0.5 rounded hover:bg-slate-900">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            {:else}
              <button 
                onclick={() => jumpToTargetPage(b.pageNum)}
                class="flex-1 text-left min-w-0 font-sans group-hover:text-cyan-400 transition-colors">
                <span class="text-[10px] font-semibold block truncate pr-1 {b.name ? 'text-slate-200' : 'text-slate-500 italic'}">
                  {b.name || 'Untitled bookmark...'}
                </span>
              </button>

              <div class="flex items-center justify-end pl-1 shrink-0">
                <span class="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-500 uppercase tracking-widest group-hover:hidden">
                  p. {b.pageNum}
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
    <div class="flex flex-col items-center justify-center p-6 text-center text-slate-500 h-40">
      <span class="text-[10px] font-medium tracking-wide uppercase">Panel View Pending</span>
      <p class="text-[9px] text-slate-600 mt-1 max-w-[100px] leading-normal">Feature integration staged on subbranch.</p>
    </div>
  {/if}
{/if}
</div>

{#if isGridViewOpen}
  <div transition:fade={{ duration: 180 }} class="fixed inset-0 bg-[#070a12] z-[50] flex flex-col select-none font-sans text-slate-100">
    <div class="p-4 bg-[#0b101c] border-b border-slate-900 grid grid-cols-3 items-center shadow-lg w-full">
      <div class="flex items-center gap-3 justify-start">
        <span class="text-xs font-bold uppercase tracking-widest text-slate-400">Grid Organizer</span>
        <span class="text-[10px] px-2 py-0.5 bg-slate-800 rounded-md text-cyan-400 font-mono font-bold border border-slate-700/50">Selected: {selectedPages.length}</span>
      </div>
      
      <div class="flex items-center gap-2 justify-center">
        <button onclick={() => batchRotate("counter")} class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold transition-colors">Rotate Left</button>
        <button onclick={() => batchRotate("clockwise")} class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold transition-colors">Rotate Right</button>
        <button onclick={triggerBatchInsert} class="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold transition-colors">Insert PDF</button>
        <button onclick={batchDelete} class="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition-colors">Delete Selected</button>
      </div>
      
      <div class="flex items-center justify-end">
        <button onclick={() => isGridViewOpen = false} class="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors shadow-md">Done</button>
      </div>
    </div>
    
    <div class="flex-1 overflow-y-auto p-8 bg-[#070a12]">
    <div 
      use:setupSortableGrid
      class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6"
    >
      {#each activeDoc.pageOrder as pageNum, index (pageNum)}
        <div 
          onclick={(e) => handleGridSelect(e, pageNum)}
          class="group relative flex flex-col items-center border rounded-xl p-4 transition-all cursor-grab active:cursor-grabbing select-none bg-[#0e131f]
          {selectedPages.includes(pageNum) ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.1)] bg-[#1a160f]' : 'border-slate-800 hover:border-slate-700'}"
        >
            <span class="absolute top-3 left-4 text-[10px] font-mono font-bold pointer-events-none {selectedPages.includes(pageNum) ? 'text-amber-400' : 'text-slate-500'}">#{index + 1}</span>
            
            {#if selectedPages.includes(pageNum)}
              <span class="absolute top-3 right-4 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-black text-black pointer-events-none">✓</span>
            {/if}
            
            <div class="w-[100px] min-h-[80px] bg-white/5 rounded-lg border border-slate-900/60 overflow-hidden flex items-center justify-center mt-4 shadow-inner relative pointer-events-none">
              <canvas
                use:renderThumbnail={{
                  pageNum,
                  rotation: activeDoc.rotations[pageNum] ?? 0,
                }}
                class="block h-auto max-w-full bg-white filter tracking-tight transition-transform"
              ></canvas>
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
    background-color: #0e131f !important;
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
