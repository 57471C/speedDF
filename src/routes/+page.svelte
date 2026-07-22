<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open, ask } from "@tauri-apps/plugin-dialog";
  import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { open as openBrowser } from "@tauri-apps/plugin-shell";
  import * as pdfjsLib from "pdfjs-dist";
  import { PDFDocument } from "pdf-lib";
  import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";
  import ContextMenu from "../components/ContextMenu.svelte";
  import OcrPanel from "./OcrPanel.svelte";
  import HelpModal from "../components/HelpModal.svelte";
  import RecentDashboard from "../components/RecentDashboard.svelte";
  import {
    activeDoc as activeDocStore,
    beginCommentPinDraft,
    executeUndoAction,
    executeRedoAction,
    rotatePageAction,
    initializeNewDocument,
    switchActiveDocument,
    documentKey,
    cleanupWorkspace,
    closeDocumentWorkspace,
    closeAllDocumentWorkspaces,
  } from "../pdfStore.svelte";
  import { decodeCommentsFromKeywords } from "../lib/comments/comments";
  import { extractFormFields } from "../lib/forms/formFields";
  import { extractHyperlinksFromDocument } from "../lib/links/hyperlinks";
  import { resetMainViewReady } from "../lib/render/mainViewGate";
  import { setLowPriorityAllowed } from "../lib/render/pdfRenderQueue";
  import { getSharedWorkspacePdf } from "../lib/render/sharedPdfDocument";
  import {
    hydrateThumbnailsFromDisk,
    removeDocumentThumbnailCaches,
    scheduleOrphanThumbnailCleanup,
    setThumbnailContentKeyFromBytes,
  } from "../lib/render/thumbnailCache";
  import DocumentTabs from "../components/DocumentTabs.svelte";

  const activeDoc = activeDocStore as any;

  const TIFF_EXTENSIONS = ["tiff", "tif"];
  const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp"];

  function determineFileType(fileName: string): "pdf" | "tiff" | "image" {
    const ext = fileName.toLowerCase().split('.').pop() || "";
    if (TIFF_EXTENSIONS.includes(ext)) return "tiff";
    if (IMAGE_EXTENSIONS.includes(ext)) return "image";
    return "pdf";
  }

  let zoomScale = $state(120);
  let showHelpModal = $state(false);
  let showUnsavedModal = $state(false);
  let showOcrDrawer = $state(false);
  let unsavedModalMessage = $state("");
  let pendingNavigationAction = $state<(() => void) | null>(null);
  let titleBarRef = $state<any>(null);
  let isSystemPrinting = $state(false);
  let isPreparingPrint = $state(false);
  let isPrintingProcess = $state(false);

  // 🍞 Lightweight Svelte 5 Reactive Toast State Machine
  let toastMessage = $state("");
  let showToast = $state(false);
  let toastTimeoutId: any = null;

  let showUpdateToast = $state(false);
  let availableUpdate = $state.raw<any>(null);
  let downloadOnClose = $state(false);
  // Deferred update lifecycle: pre-staged binary reference after silent background download
  let pendingUpdateRef = $state.raw<any>(null);
  let isUpdateReadyToInstall = $state(false);
  let isApplyingDeferredUpdate = $state(false);
  let isDownloadingUpdate = $state(false);
  let updateDownloadProgress = $state(0);

  // Find/Search Content Popup State
  let showSearchPopup = $state(false);
  let searchQuery = $state("");
  let caseSensitive = $state(false);
  let currentMatchIndex = $state(-1);
  let totalMatches = $state(0);
  /** Full-document matches (not limited to currently painted text layers). */
  let matchesList = $state<
    { pageNumber: number; occurrenceOnPage: number; element?: HTMLElement | null }[]
  >([]);
  let isSearchRunning = $state(false);
  let searchGeneration = 0;

  // Maps to store original HTML of spans to restore them before new search highlights
  const originalSpansMap = new Map<HTMLElement, string>();

  function clearHighlights() {
    originalSpansMap.forEach((origText, element) => {
      if (element.isConnected) {
        element.textContent = origText;
      }
    });
    originalSpansMap.clear();
  }

  function closeSearch() {
    searchGeneration += 1;
    showSearchPopup = false;
    searchQuery = "";
    currentMatchIndex = -1;
    totalMatches = 0;
    matchesList = [];
    isSearchRunning = false;
    clearHighlights();
  }

  function buildSearchRegex(query: string): RegExp {
    const regexFlags = caseSensitive ? "g" : "gi";
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`(${escapedQuery})`, regexFlags);
  }

  /**
   * Scan every page in the document via pdf.js text content (not only visible
   * text-layer DOM nodes). Images have no text layer — returns empty.
   */
  async function performTextSearch() {
    clearHighlights();
    const gen = ++searchGeneration;

    if (!searchQuery) {
      totalMatches = 0;
      currentMatchIndex = -1;
      matchesList = [];
      return;
    }

    // Non-PDF documents: no extractable text stream — leave empty (annotations not indexed)
    if (activeDoc.fileType === "image" || activeDoc.fileType === "tiff" || !activeDoc.rawBytes) {
      totalMatches = 0;
      currentMatchIndex = -1;
      matchesList = [];
      return;
    }

    isSearchRunning = true;
    const query = searchQuery;
    const tempMatches: {
      pageNumber: number;
      occurrenceOnPage: number;
      element?: HTMLElement | null;
    }[] = [];

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: activeDoc.rawBytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/",
      });
      const pdfDocument = await loadingTask.promise;
      if (gen !== searchGeneration) return;

      const pageOrder: number[] =
        (activeDoc.pageOrder?.length ?? 0) > 0
          ? [...(activeDoc.pageOrder || [])]
          : Array.from({ length: pdfDocument.numPages }, (_, i) => i + 1);

      for (const pageNumber of pageOrder || []) {
        if (gen !== searchGeneration) return;
        if (pageNumber < 1 || pageNumber > pdfDocument.numPages) continue;

        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        // Join items with spaces so multi-span words still match reasonably.
        // Guard items: some PDFs/engines yield undefined items (JSC throws on bare map/for-of).
        const pageText = (textContent.items || [])
          .map((item: any) => (item && typeof item.str === "string" ? item.str : ""))
          .join(" ");

        const regex = buildSearchRegex(query);
        let occurrenceOnPage = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(pageText)) !== null) {
          tempMatches.push({
            pageNumber,
            occurrenceOnPage,
            element: null,
          });
          occurrenceOnPage += 1;
          // Guard against zero-length matches advancing forever
          if (m[0].length === 0) {
            regex.lastIndex += 1;
          }
        }
      }

      try {
        await loadingTask.destroy();
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("Full-document text search failed:", err);
    }

    if (gen !== searchGeneration) return;

    matchesList = tempMatches;
    totalMatches = matchesList.length;
    isSearchRunning = false;

    if (totalMatches > 0) {
      currentMatchIndex = 0;
      await scrollToMatch(0);
    } else {
      currentMatchIndex = -1;
    }
  }

  function escapeHtml(str: string): string {
    return str.replace(/[&<>"']/g, (match) => {
      const escapeMap: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return escapeMap[match] || match;
    });
  }

  /**
   * Highlight query hits inside a page's painted text layer (DOM).
   * Full-document index is source of truth; this only paints the active page.
   */
  function highlightMatchesOnPage(pageNumber: number) {
    if (!searchQuery) return;
    const pageRoot = document.querySelector(
      `[data-page-number="${pageNumber}"]`,
    ) as HTMLElement | null;
    if (!pageRoot) return;

    const regex = buildSearchRegex(searchQuery);
    const spans = pageRoot.querySelectorAll(".textLayer span");
    const pageMatchIndices = matchesList
      .map((m, i) => (m.pageNumber === pageNumber ? i : -1))
      .filter((i) => i >= 0);

    // Mark every span that contains the query; mark current match distinctly
    let spanHitOrder = 0;
    spans.forEach((span) => {
      const el = span as HTMLElement;
      const text = el.textContent || "";
      // Fresh regex without /g for test to avoid lastIndex side-effects
      const testRe = new RegExp(
        searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
        caseSensitive ? "" : "i",
      );
      if (!testRe.test(text)) return;

      if (!originalSpansMap.has(el)) {
        originalSpansMap.set(el, el.textContent || "");
      }

      // Determine if this span is the "current" global match for this page
      // by order of hit spans on the page vs occurrenceOnPage of currentMatchIndex
      const isCurrent =
        currentMatchIndex >= 0 &&
        matchesList[currentMatchIndex]?.pageNumber === pageNumber &&
        matchesList[currentMatchIndex]?.occurrenceOnPage === spanHitOrder;

      const highlightClass = isCurrent
        ? "bg-amber-400 text-slate-950 font-bold ring-2 ring-cyan-500 rounded-sm px-0.5 z-50 relative"
        : "bg-yellow-400 text-slate-950 rounded-sm px-0.5";

      const paintRe = buildSearchRegex(searchQuery);
      const originalText = originalSpansMap.get(el)!;
      const parts = originalText.split(paintRe);
      let newHTML = "";
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          newHTML += escapeHtml(parts[i]);
        } else {
          newHTML += `<mark class="${highlightClass}">${escapeHtml(parts[i])}</mark>`;
        }
      }
      el.innerHTML = newHTML;

      // Bind first matching span element for scroll centering
      if (pageMatchIndices.length > 0) {
        const globalIdx = pageMatchIndices[Math.min(spanHitOrder, pageMatchIndices.length - 1)];
        if (globalIdx != null && matchesList[globalIdx] && !matchesList[globalIdx].element) {
          matchesList[globalIdx] = { ...matchesList[globalIdx], element: el };
        }
      }
      spanHitOrder += 1;
    });

    void regex;
  }

  function goToNextMatch() {
    if (totalMatches === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
    void scrollToMatch(currentMatchIndex);
  }

  function goToPrevMatch() {
    if (totalMatches === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
    void scrollToMatch(currentMatchIndex);
  }

  function toggleCaseSensitive() {
    caseSensitive = !caseSensitive;
    void performTextSearch();
  }

  async function scrollToMatch(index: number) {
    if (index < 0 || index >= matchesList.length) return;
    const match = matchesList[index];

    // Navigate store + force page paint via scroll
    (activeDoc as any).isClickScrolling = true;
    activeDoc.currentPage = match.pageNumber;

    // Wait for page container (and ideally text layer) to exist
    let pageEl: HTMLElement | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      pageEl = document.querySelector(
        `[data-page-number="${match.pageNumber}"]`,
      ) as HTMLElement | null;
      if (pageEl?.querySelector(".textLayer span")) break;
      if (pageEl && attempt > 8) break; // page shell exists; text may still be painting
      await new Promise((r) => setTimeout(r, 50));
    }

    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Give text layer a moment to finish painting, then highlight
    await new Promise((r) => setTimeout(r, 120));
    clearHighlights();
    highlightMatchesOnPage(match.pageNumber);

    const bound = matchesList[index]?.element;
    if (bound?.isConnected) {
      bound.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }

    setTimeout(() => {
      (activeDoc as any).isClickScrolling = false;
    }, 400);
  }

  // Auto-Reset Bindings: Reset search when document or zoom scale changes
  $effect(() => {
    const _zoom = zoomScale;
    const _file = activeDoc.fileName;
    closeSearch();
  });

  let loadStartTime = 0;
  /** Perceived open latency for the most recently loaded document (burn-in overlay). */
  let renderDurationMs = $state<number | null>(null);
  /** Which tab the latency value belongs to (path or fileName). */
  let renderDurationDocId = $state<string | null>(null);
  let isZippingLoader = $state(false);

  function showNotification(message: string) {
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastMessage = message;
    showToast = true;

    // Automatically dim and clear the toast banner after 3 seconds of screen time
    toastTimeoutId = setTimeout(() => {
      showToast = false;
    }, 3000);
  }

  function toggleOcrDrawer() {
    showOcrDrawer = !showOcrDrawer;
  }

  function openCoffeeLink() {
    openBrowser("https://buymeacoffee.com/speeddf");
  }

  interface RecentFile {
    name: string;
    path: string;
    timestamp: number;
    thumbnail: string;
    orientation?: string;
  }

  let recentFiles = $derived(activeDoc.recents);
  let fileStatusMap = $state<Record<string, boolean>>({});

  // Capture Page 1 from incoming bytes, convert to Base64 data URL, and update storage
  async function registerRecentFile(
    name: string,
    path: string,
    bytesOrThumbnail: Uint8Array | string,
    fileType?: string,
  ) {
    try {
      if (fileType === 'image' && typeof bytesOrThumbnail === 'string') {
        let currentList: RecentFile[] = [];
        const stored = localStorage.getItem("speeddf_recents");
        if (stored) currentList = JSON.parse(stored);

        currentList = currentList.filter((f) => f.path !== path);
        currentList.unshift({
          name,
          path,
          timestamp: Date.now(),
          thumbnail: bytesOrThumbnail,
          orientation: 'portrait',
        });
        if (currentList.length > 10) currentList = currentList.slice(0, 10);

        localStorage.setItem("speeddf_recents", JSON.stringify(currentList));
        activeDoc.recents = currentList;
        return;
      }

      if (activeDoc.fileType === "tiff" || activeDoc.fileType === "image") {
        console.log(
          `Recent Tracker: Document type is ${activeDoc.fileType.toUpperCase()}. Registering basic file history metadata entry...`,
        );
        let dataUrl = "";
        let orientation = "portrait";

        // Prefer a pre-rendered data-URL thumbnail when provided
        if (typeof bytesOrThumbnail === "string" && bytesOrThumbnail.startsWith("data:")) {
          dataUrl = bytesOrThumbnail;
        }

        // TIFF: use first decoded page PNG
        const pageData = activeDoc.tiffPages[0];
        if (!dataUrl && pageData) {
          const blob = new Blob([pageData as any], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              orientation = img.width > img.height ? "landscape" : "portrait";
              resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
          });
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              URL.revokeObjectURL(url);
              resolve((reader.result as string) || "");
            };
            reader.onerror = () => {
              URL.revokeObjectURL(url);
              resolve("");
            };
            reader.readAsDataURL(blob);
          });
        }

        // IMAGE (JPG/PNG/…): decode raw file bytes into a small JPEG data URL
        if (!dataUrl && activeDoc.fileType === "image") {
          const bytes =
            bytesOrThumbnail instanceof Uint8Array
              ? bytesOrThumbnail
              : activeDoc.rawBytes;
          if (bytes && bytes.length > 0) {
            const ext = (name.split(".").pop() || "png").toLowerCase();
            const mime =
              ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "webp"
                  ? "image/webp"
                  : `image/${ext}`;
            const blob = new Blob([bytes as BlobPart], { type: mime });
            const url = URL.createObjectURL(blob);
            dataUrl = await new Promise<string>((resolve) => {
              const img = new Image();
              img.onload = () => {
                orientation = img.width > img.height ? "landscape" : "portrait";
                const canvas = document.createElement("canvas");
                const targetW = 140;
                const scale = targetW / Math.max(1, img.width);
                canvas.width = targetW;
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL("image/jpeg", 0.6));
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve("");
              };
              img.src = url;
            });
          }
        }

        // Last resort: live object URL is not persistable in localStorage as-is —
        // leave dataUrl empty only if decode failed (sidebar still uses imageUrl).
        let currentList: RecentFile[] = [];
        const stored = localStorage.getItem("speeddf_recents");
        if (stored) currentList = JSON.parse(stored);

        currentList = currentList.filter((f) => f.path !== path);
        currentList.unshift({
          name,
          path,
          timestamp: Date.now(),
          thumbnail: dataUrl,
          orientation,
        });
        if (currentList.length > 10) currentList = currentList.slice(0, 10);

        localStorage.setItem("speeddf_recents", JSON.stringify(currentList));
        activeDoc.recents = currentList;
        return;
      }
      const bytes = bytesOrThumbnail as Uint8Array;
      const loadingTask = pdfjsLib.getDocument({
        data: bytes.slice(0),
        cMapUrl: window.location.origin + "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: window.location.origin + "/standard_fonts/",
        wasmUrl: window.location.origin + "/",
      });
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(1);

      // Render a small scaled offscreen canvas to extract clean base64 data
      const viewport = page.getViewport({ scale: 0.3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        await page.render({ canvasContext: ctx, viewport } as any).promise;
        const dataUrl = canvas.toDataURL("image/png");

        let currentList: RecentFile[] = [];
        const stored = localStorage.getItem("speeddf_recents");
        if (stored) currentList = JSON.parse(stored);

        // Remove duplicate path strings if they already exist
        currentList = currentList.filter((f) => f.path !== path);

        const isLandscape = viewport.width > viewport.height;
        // Prepend the new document item to the front of the tracking queue
        currentList.unshift({
          name,
          path,
          timestamp: Date.now(),
          thumbnail: dataUrl,
          orientation: isLandscape ? "landscape" : "portrait",
        });

        // Cap array length at 10 items total
        if (currentList.length > 10) currentList = currentList.slice(0, 10);

        localStorage.setItem("speeddf_recents", JSON.stringify(currentList));
        activeDoc.recents = currentList;
      }
    } catch (err) {
      console.error(
        "Failed to extract snapshot for recent files tracker:",
        err,
      );
    }
  }

  /**
   * Caches high-level document layout dimensions to localStorage for instant
   * skeleton hydration on subsequent opens from the Recent Documents dashboard.
   */
  function cacheDocumentLayoutMetadata(
    filePath: string,
    totalPages: number,
    pageDimensions: { width: number; height: number }[],
  ) {
    try {
      const layoutMeta = {
        timestamp: Date.now(),
        totalPages,
        pageDimensions,
      };
      localStorage.setItem(
        `speeddf_meta_${btoa(filePath)}`,
        JSON.stringify(layoutMeta),
      );
    } catch (err) {
      console.warn("Failed to write structural layout cache:", err);
    }
  }

  /** Read layout skeleton written on a previous open (same path). */
  function readDocumentLayoutMetadata(filePath: string): {
    totalPages: number;
    pageDimensions: { width: number; height: number }[];
  } | null {
    try {
      const raw = localStorage.getItem(`speeddf_meta_${btoa(filePath)}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed?.totalPages > 0 &&
        Array.isArray(parsed.pageDimensions) &&
        parsed.pageDimensions.length > 0
      ) {
        return {
          totalPages: parsed.totalPages,
          pageDimensions: parsed.pageDimensions,
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function loadDocument(
    rawBytes: Uint8Array,
    fileName: string,
    filePath: string,
    externalStartTime?: number,
  ) {
    const existing = activeDoc.openDocuments.find(
      (d: any) => (filePath && d.filePath === filePath) || d.fileName === fileName
    );
    // Already fully loaded — just switch tabs
    if (existing?.rawBytes) {
      switchActiveDocument(documentKey(existing));
      return;
    }

    // Skeleton / new entry: ensure a workspace slot exists, then fill it
    if (!existing) {
      initializeNewDocument(fileName, filePath);
    } else {
      switchActiveDocument(documentKey(existing));
    }

    // Use the true click boundary timestamp if provided, otherwise fallback to runtime execution time
    const telemetryChannel = externalStartTime ? 'Recent_Dashboard_Warm' : 'Standard_Load';

    // 1. Instantly trigger state layers and fire the toast notification
    isZippingLoader = true;
    showNotification("FILE OPEN:");

    // 2. Force Svelte to immediately flush style/DOM updates and paint the UI
    // before the thread can be occupied by heavy canvas stream rendering
    await tick();

    // 3. Begin the high-resolution hardware benchmarking clock
    loadStartTime = externalStartTime ?? performance.now();
    renderDurationMs = null;
    renderDurationDocId = null;

    try {
      const fileCategory = determineFileType(fileName);

      if (fileCategory === "tiff") {
        // Direct binary handoff over the IPC bridge to your high-performance Rust extraction crate
        const decodedPages = await invoke<number[][] | Uint8Array[]>(
          "parse_tiff_document",
          {
            path: filePath,
          },
        );

        activeDoc.fileType = "tiff";
        activeDoc.rawBytes = rawBytes;
        activeDoc.fileName = fileName;
        activeDoc.filePath = filePath;
        activeDoc.pageCount = decodedPages.length;
        activeDoc.tiffPages = decodedPages.map((page) => new Uint8Array(page));
        // Clear thumb cache BEFORE pageOrder so sidebar does not generate then wipe.
        activeDoc.pageThumbnailOverrides = {};
        activeDoc.pageOrder = Array.from(
          { length: decodedPages.length },
          (_, i) => i + 1,
        );
        activeDoc.currentPage = 1;
        // Fresh multi-page load: empty shapes map (per-page keys are filled lazily).
        // Iteration sites must still use (shapes[page] || []) for unannotated pages.
        activeDoc.shapes = {};
        activeDoc.rotations = {};
        activeDoc.bookmarks = [];
        activeDoc.comments = [];
        activeDoc.formFields = [];
        activeDoc.formValues = {};
        activeDoc.hyperlinks = [];
      } else if (fileCategory === "image") {
        // Setup the clean single-page layout structure for standard graphics
        activeDoc.fileType = "image";
        activeDoc.tiffPages = [];
        activeDoc.rawBytes = rawBytes;
        activeDoc.fileName = fileName;
        activeDoc.filePath = filePath;
        activeDoc.pageCount = 1;
        activeDoc.pageOrder = [1];
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.bookmarks = [];
        activeDoc.comments = [];
        activeDoc.formFields = [];
        activeDoc.formValues = {};
        activeDoc.hyperlinks = [];
        activeDoc.imageRotation = 0;
        // Clear any stale per-doc override so sidebar uses live imageUrl until paint
        activeDoc.pageThumbnailOverrides = {};

        const ext = fileName.toLowerCase().split('.').pop() || "png";
        const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
        const blob = new Blob([rawBytes as any], { type: mimeType });

        // Revoke previous object URL if re-loading into same slot
        if (activeDoc.imageUrl) {
          try {
            URL.revokeObjectURL(activeDoc.imageUrl);
          } catch {
            /* ignore */
          }
        }
        activeDoc.imageUrl = URL.createObjectURL(blob);
        // Force sidebar/recents consumers to re-read imageUrl immediately
        activeDoc.thumbnailVersion = (activeDoc.thumbnailVersion || 0) + 1;

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const targetWidth = 140;
          const scaleFactor = targetWidth / Math.max(1, img.width);
          canvas.width = targetWidth;
          canvas.height = Math.max(1, Math.round(img.height * scaleFactor));

          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Thumbnail = canvas.toDataURL('image/jpeg', 0.6);

          // Seed per-doc sidebar override so thumb is visible before save
          activeDoc.pageThumbnailOverrides = { 0: base64Thumbnail };
          activeDoc.thumbnailVersion = (activeDoc.thumbnailVersion || 0) + 1;

          registerRecentFile(fileName, filePath, base64Thumbnail, 'image');
        };
        img.onerror = () => {
          console.warn("Image thumbnail decode failed; sidebar will use live imageUrl");
        };
        img.src = activeDoc.imageUrl;

        // Skip PDF.js rendering entirely and log it out
        console.log(`Image Ingestion Setup: Initialized image frame for ${fileName}`);
      } else {
        // ── Fast open path for PDFs ─────────────────────────────────────
        // Warm open (subsequent): layout meta + IDB thumbs → shell + sidebar
        // instantly; shared pdf.js parse runs in parallel for main paint.
        activeDoc.fileType = "pdf";
        activeDoc.tiffPages = [];
        activeDoc.rawBytes = rawBytes;
        activeDoc.shapes = {};
        activeDoc.rotations = {};
        activeDoc.fileName = fileName;
        activeDoc.filePath = filePath;
        activeDoc.bookmarks = [];
        activeDoc.comments = [];
        activeDoc.formFields = [];
        activeDoc.formValues = {};
        activeDoc.hyperlinks = [];
        activeDoc.pageThumbnailOverrides = {};
        setThumbnailContentKeyFromBytes(rawBytes);
        resetMainViewReady();
        setLowPriorityAllowed(false);

        // Prefer previous open's layout for page shells (no pdf.js wait)
        const layoutMeta = readDocumentLayoutMetadata(filePath);
        if (layoutMeta) {
          activeDoc.pageCount = layoutMeta.totalPages;
          activeDoc.pageOrder = Array.from(
            { length: layoutMeta.totalPages },
            (_, i) => i + 1,
          );
          activeDoc.currentPage = 1;
          const doc = activeDoc.openDocuments.find(
            (d: any) => d.workspaceId === activeDoc.activeDocumentId,
          );
          if (doc) doc.cachedDimensions = layoutMeta.pageDimensions;
        }

        // Kick shared parse + IDB thumb hydrate in parallel
        const pdfPromise = getSharedWorkspacePdf(rawBytes);
        const hydratePromise = hydrateThumbnailsFromDisk(filePath, rawBytes).catch(
          (hydrateErr) => {
            console.warn("Thumbnail disk hydrate skipped:", hydrateErr);
            return false;
          },
        );

        // First open (no layout cache): need page count before shells exist
        if (!layoutMeta) {
          const pdfDocument = await pdfPromise;
          const numPages = pdfDocument?.numPages ?? 1;
          activeDoc.pageCount = numPages;
          activeDoc.pageOrder = Array.from(
            { length: numPages },
            (_, idx) => idx + 1,
          );
          activeDoc.currentPage = 1;
          if (pdfDocument) {
            try {
              const p1 = await pdfDocument.getPage(1);
              const vp = p1.getViewport({ scale: 1 });
              const doc = activeDoc.openDocuments.find(
                (d: any) => d.workspaceId === activeDoc.activeDocumentId,
              );
              if (doc) {
                doc.cachedDimensions = Array.from({ length: numPages }, () => ({
                  width: vp.width,
                  height: vp.height,
                }));
              }
            } catch {
              /* WorkspacePage will measure */
            }
          }
        }

        // Apply disk thumbs as soon as ready (may resolve before or after shell)
        void hydratePromise.then((ok) => {
          if (ok) {
            activeDoc.thumbnailVersion =
              (activeDoc.thumbnailVersion || 0) + 1;
          }
        });

        // Unblock UI — main paint uses shared doc; thumbs show from IDB if warm
        const loadEndTime = performance.now();
        renderDurationMs = Math.round(loadEndTime - loadStartTime);
        renderDurationDocId =
          activeDoc.activeDocumentId || filePath || fileName;
        console.log(
          `⏱️ [${telemetryChannel}] Open-to-shell latency: ${(loadEndTime - loadStartTime).toFixed(2)}ms (layoutCache=${!!layoutMeta})`,
        );
        isZippingLoader = false;

        // Background metadata after first paint path is free
        void (async () => {
          const pdfDocument = await pdfPromise;
          if (!pdfDocument) return;

          // Align page count if layout cache was stale
          if (pdfDocument.numPages !== activeDoc.pageCount) {
            activeDoc.pageCount = pdfDocument.numPages;
            activeDoc.pageOrder = Array.from(
              { length: pdfDocument.numPages },
              (_, idx) => idx + 1,
            );
          }

          try {
            const outline = await pdfDocument.getOutline();
            if (outline && outline.length > 0) {
              const loadedBookmarks = [];
              const BATCH_SIZE = 50;
              for (let i = 0; i < outline.length; i += BATCH_SIZE) {
                const batch = outline.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                  batch.map(async (item: any) => {
                    let pageNum = 1;
                    if (item.dest) {
                      let destObj: any = item.dest;
                      if (typeof destObj === "string") {
                        destObj = await pdfDocument.getDestination(destObj);
                      }
                      if (Array.isArray(destObj) && destObj[0]) {
                        const pageIndex = await pdfDocument.getPageIndex(
                          destObj[0],
                        );
                        pageNum = pageIndex + 1;
                      }
                    }
                    return { pageNum, name: item.title || "" };
                  }),
                );
                loadedBookmarks.push(...batchResults);
              }
              activeDoc.bookmarks = loadedBookmarks;
            }
          } catch (outlineErr) {
            console.error("Failed to parse document outline tree:", outlineErr);
          }

          try {
            const meta = await pdfDocument.getMetadata();
            const keywords =
              (meta?.info as { Keywords?: string } | undefined)?.Keywords ??
              (meta?.info as { keywords?: string } | undefined)?.keywords ??
              "";
            const loaded = decodeCommentsFromKeywords(keywords);
            activeDoc.comments = loaded ?? [];
          } catch (commentsErr) {
            console.warn(
              "Failed to load document comments metadata:",
              commentsErr,
            );
          }

          try {
            const extracted = await extractFormFields(rawBytes);
            activeDoc.formFields = extracted.fields;
            activeDoc.formValues = extracted.values;
          } catch (formErr) {
            console.warn("Form field detection skipped:", formErr);
          }

          try {
            activeDoc.hyperlinks =
              await extractHyperlinksFromDocument(pdfDocument);
          } catch (linkErr) {
            console.warn("Hyperlink detection skipped:", linkErr);
          }

          try {
            await registerRecentFile(fileName, filePath, rawBytes);
          } catch {
            /* ignore */
          }

          // Refresh full layout cache in the background (warms next open)
          try {
            const dimPromises = Array.from(
              { length: pdfDocument.numPages },
              (_, i) =>
                pdfDocument.getPage(i + 1).then((p: any) => {
                  const vp = p.getViewport({ scale: 1 });
                  return { width: vp.width, height: vp.height };
                }),
            );
            const pageDims = await Promise.all(dimPromises);
            cacheDocumentLayoutMetadata(
              filePath,
              pdfDocument.numPages,
              pageDims,
            );
            const doc = activeDoc.openDocuments.find(
              (d: any) => d.workspaceId === activeDoc.activeDocumentId,
            );
            if (doc) doc.cachedDimensions = pageDims;
          } catch (cacheErr) {
            console.warn("Layout cache extraction failed:", cacheErr);
          }
        })();

        return;
      }

      // Calculate layout compilation completion speeds down to the millisecond
      const loadEndTime = performance.now();
      renderDurationMs = Math.round(loadEndTime - loadStartTime);
      // Prefer stable workspace id so Save As / path rebind does not hide burn-in
      renderDurationDocId =
        activeDoc.activeDocumentId || filePath || fileName;
      console.log(`⏱️ [${telemetryChannel}] Open-to-Render perceived latency: ${(loadEndTime - loadStartTime).toFixed(2)}ms`);
    } catch (err) {
      console.error("Document Ingestion Core Fault: ", err);
      showNotification("Unable to process document stream");
      renderDurationMs = null;
      renderDurationDocId = null;
    } finally {
      isZippingLoader = false;
    }
  }

  async function promptAndLoadFile(
    filePath: string,
    fileName: string,
    _unsavedMessage: string,
    clickStartTime?: number,
  ) {
    // Multi-document: open alongside existing docs (do not flush/close current).
    // Dirty confirmation only applies to close/replace flows, not open-another.
    try {
      const payload = await invoke<StartupPayload>("read_file_bytes", {
        path: filePath,
      });
      if (payload && payload.bytes) {
        const typedBytes = new Uint8Array(payload.bytes);
        await loadDocument(
          typedBytes,
          fileName || payload.name,
          filePath,
          clickStartTime,
        );
      }
    } catch (err) {
      console.error(`Failed to load document from ${filePath}:`, err);
    }
  }

  async function openRecentFile(name: string, path: string) {
    // Snapshot the exact user interaction boundary for true perceived-latency telemetry
    const exactClickTime = performance.now();

    // Instant skeleton hydration: seed placeholder page containers from cached dimensions
    // so the workspace renders structural bones in <5ms before IPC bytes arrive
    try {
      const cacheKey = `speeddf_meta_${btoa(path)}`;
      const cachedMetaRaw = localStorage.getItem(cacheKey);
      if (cachedMetaRaw) {
        const cachedMeta = JSON.parse(cachedMetaRaw);
        if (cachedMeta.totalPages && cachedMeta.pageDimensions) {
          const doc = initializeNewDocument(name, path);
          doc.fileType = "pdf";
          doc.pageCount = cachedMeta.totalPages;
          doc.pageOrder = Array.from({ length: cachedMeta.totalPages }, (_, i) => i + 1);
          doc.cachedDimensions = cachedMeta.pageDimensions;
          // rawBytes stays null — WorkspacePage will render empty skeleton containers
          // at the exact cached dimensions until the real bytes arrive and overwrite
        }
      }
    } catch (err) {
      console.warn("Skeleton hydration cache miss:", err);
    }

    await promptAndLoadFile(
      path,
      name,
      "You have unsaved changes on this layout sheet. Are you sure you want to load this recent file and discard your progress?",
      exactClickTime,
    );
  }

  function handleClearFromRecents(targetId: string) {
    activeDoc.recents = activeDoc.recents.filter((f: any) => f.path !== targetId);
    localStorage.setItem("speeddf_recents", JSON.stringify(activeDoc.recents));
    // Drop IDB page thumbs + layout meta for this path (non-blocking)
    void removeDocumentThumbnailCaches(targetId);
    showNotification("Removed document from recents list");
  }

  async function handleDeleteFromHDD(file: any) {
    try {
      // 1. Throw a standard native OS warning modal check
      const confirmScrub = await ask(
        `Are you absolutely sure you want to permanently delete "${file.name}" from your computer?\n\nThis will remove the actual file from your hard drive and cannot be undone.`,
        { title: 'Permanently Delete File', kind: 'warning' }
      );

      if (!confirmScrub) return;

      // 2. Eradicate the file binary from disk storage using the new native command
      await invoke("delete_file_from_disk", { filePath: file.path });

      // 3. Chain into your existing working clear method to scrub the UI card asset
      //    (also clears thumbnail / layout caches via handleClearFromRecents)
      handleClearFromRecents(file.path);

      showNotification(`Deleted file permanently: ${file.name}`);
    } catch (err) {
      console.error('Failed to execute hard drive deletion loop:', err);
      showNotification("Failed to delete file from disk");
    }
  }

  async function handleCompress(file: any) {
    try {
      showNotification(`Compressing PDF: ${file.name}`);
      // Invoke the custom Rust pipeline command, passing the absolute file target path
      const outputMessage = await invoke<string>('compress_pdf_pipeline', { filePath: file.path });
      console.log(outputMessage);

      showNotification("PDF compressed successfully");
    } catch (err) {
      console.error('PDF optimization engine compression failure:', err);
      showNotification("Compression failed");
    }
  }

  async function createBlankDocument() {
    let name = "Untitled.pdf";
    let count = 1;
    while (activeDoc.openDocuments.some((d: any) => d.fileName === name)) {
      name = `Untitled (${count++}).pdf`;
    }

    initializeNewDocument(name, null);

    try {
      const doc = await PDFDocument.create();
      doc.addPage([595.276, 841.89]); // A4 dimensions
      const bytes = await doc.save();

      activeDoc.fileType = "pdf";
      activeDoc.rawBytes = bytes;
      activeDoc.fileName = name;
      activeDoc.filePath = null;
      activeDoc.pageCount = 1;
      activeDoc.pageOrder = [1];
      activeDoc.currentPage = 1;
      activeDoc.shapes = {};
      activeDoc.rotations = {};
      activeDoc.bookmarks = [];
      activeDoc.comments = [];
      activeDoc.formFields = [];
      activeDoc.formValues = {};
      activeDoc.hyperlinks = [];
      activeDoc.isDirty = false;
      showNotification("Created New Blank A4 Document");
    } catch (e) {
      console.error("Failed to create blank document:", e);
    }
  }

  async function openFile() {
    // 1. Update the native dialog call to allow filtering for technical drawings
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Supported Documents",
          extensions: ["pdf", "tiff", "tif", "png", "jpg", "jpeg", "gif", "bmp"],
        },
      ],
    });

    if (!selected) return;

    // 2. When reading the file name and processing path coordinates:
    const filePath =
      typeof selected === "string" ? selected : (selected as any).path;
    const fileName = filePath.split(/[/\\]/).pop() || "Document";

    await promptAndLoadFile(
      filePath,
      fileName,
      "You have unsaved changes on this document layout. Are you sure you want to open a new file and discard your progress?",
    );
  }

  async function closeDocumentById(docId: string) {
    const doc = activeDoc.openDocuments.find(
      (d: any) =>
        d.workspaceId === docId ||
        d.filePath === docId ||
        d.fileName === docId,
    );
    if (!doc) return;
    const id = documentKey(doc);

    if (doc.isDirty) {
      unsavedModalMessage =
        "You have unsaved markup changes on this layout drawing. Are you sure you want to close this document and discard your progress?";
      pendingNavigationAction = () => {
        doc.isDirty = false;
        void cleanupWorkspace(id).then(() => closeSearch());
      };
      showUnsavedModal = true;
      return;
    }

    // Await full reclaim so rapid open/close cycles do not stack pdf.js heaps
    await cleanupWorkspace(id);
    closeSearch();
  }

  function closeDocument() {
    const id = activeDoc.activeDocumentId;
    if (!id) {
      activeDoc.flushDocumentState();
      return;
    }
    void closeDocumentById(id);
  }

  async function closeAllDocuments() {
    const docs = [...activeDoc.openDocuments];
    if (docs.length === 0) return;

    // Close clean tabs immediately; only prompt for remaining dirty ones
    const dirtyDocs = docs.filter((d: any) => d.isDirty);
    const cleanDocs = docs.filter((d: any) => !d.isDirty);

    for (const d of cleanDocs) {
      await cleanupWorkspace(documentKey(d));
    }

    if (dirtyDocs.length === 0) {
      closeSearch();
      return;
    }

    unsavedModalMessage =
      dirtyDocs.length === 1
        ? "You have unsaved markup changes on one remaining tab. Close it and discard progress?"
        : `You have unsaved changes on ${dirtyDocs.length} remaining tabs. Close them and discard progress?`;
    pendingNavigationAction = () => {
      // Only dirty tabs should still be open
      void closeAllDocumentWorkspaces().then(() => closeSearch());
    };
    showUnsavedModal = true;
  }

  // Auto-track files when they are loaded into activeDoc
  $effect(() => {
    if (activeDoc.rawBytes && activeDoc.fileName && activeDoc.filePath) {
      // Images/TIFF register their own thumbnails (data URL) in the load path —
      // calling registerRecentFile with raw bytes here produces empty JPG thumbs.
      if (activeDoc.fileType === "image" || activeDoc.fileType === "tiff") {
        return;
      }
      const stored = localStorage.getItem("speeddf_recents");
      let currentList: RecentFile[] = [];
      if (stored) {
        try {
          currentList = JSON.parse(stored);
        } catch (e) {}
      }
      const alreadyFirst =
        currentList[0] && currentList[0].path === activeDoc.filePath;
      if (!alreadyFirst) {
        registerRecentFile(
          activeDoc.fileName,
          activeDoc.filePath,
          activeDoc.rawBytes,
        );
      }
    }
  });

  let showMenu = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  /** Page under the cursor when the context menu opened (for "Add Comment Here"). */
  let contextCommentTarget = $state<{
    pageNum: number;
    x: number;
    y: number;
  } | null>(null);

  function handleRightClick(e: MouseEvent) {
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;
    showMenu = true;

    // Resolve page + % coords when right-click lands on a document page
    contextCommentTarget = null;
    if (!activeDoc.rawBytes || activeDoc.fileType === "image") return;
    const pageEl = (e.target as HTMLElement | null)?.closest?.(
      "[data-page-number]",
    ) as HTMLElement | null;
    if (!pageEl) return;
    const pageNum = parseInt(pageEl.getAttribute("data-page-number") || "", 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    const rect = pageEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    contextCommentTarget = { pageNum, x, y };
  }

  function closeMenu() {
    showMenu = false;
  }

  function handleAddCommentHere() {
    const target = contextCommentTarget;
    showMenu = false;
    contextCommentTarget = null;
    if (!target) return;
    // Place a pin draft + open compose popout (same UX as workspace comment bubble)
    beginCommentPinDraft(target.pageNum, target.x, target.y);
  }

  const appWindow = getCurrentWindow();

  const minimizeApp = () => appWindow.minimize();
  const maximizeApp = () => appWindow.toggleMaximize();
  const closeApp = () => appWindow.close();

  interface StartupPayload {
    bytes: number[];
    name: string;
    path: string;
  }

  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      window.location.origin + "/pdf.worker.min.mjs";
    (pdfjsLib.GlobalWorkerOptions as any).wasmUrl =
      window.location.origin + "/";
  }

  // 🛑 WARPING CODE SHIELD: DO NOT REFACTOR THIS TO NATIVE RUST OR REMOVE THE IFRAME LAYER.
  // WebView2/Tauri holds an exclusive file lock on the user profile directory. Spawning
  // background browser processes causes Chromium Exit Code 21 rendering window crashes (black boxes).
  // The hidden iframe pipeline isolates the canvas print tree safely inside webview memory.
  async function triggerHeadlessPrintSpool() {
    if (!activeDoc || isPrintingProcess) return;

    isPrintingProcess = true;
    showNotification("Preparing Document for Printing");

    if (activeDoc.fileType === 'image') {
      let printWindow = document.getElementById('print-iframe') as HTMLIFrameElement;
      if (!printWindow) {
        printWindow = document.createElement('iframe');
        printWindow.id = 'print-iframe';
        printWindow.style.position = 'fixed';
        printWindow.style.right = '0';
        printWindow.style.bottom = '0';
        printWindow.style.width = '0';
        printWindow.style.height = '0';
        printWindow.style.border = '0';
        document.body.appendChild(printWindow);
      }

      const doc = printWindow.contentDocument || printWindow.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`
          <html>
            <head>
              <style>
                @page { size: auto; margin: 0mm; }
                body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: white; }
                img { max-width: 100%; max-height: 100vh; object-fit: contain; page-break-inside: avoid; }
              </style>
            </head>
            <body>
              <img src="${activeDoc.imageUrl}" />
            </body>
          </html>
        `);
        doc.close();

        printWindow.contentWindow?.focus();
        const frameImg = doc.querySelector('img');
        if (frameImg) {
          frameImg.onload = () => {
            printWindow.contentWindow?.print();
            isPrintingProcess = false;
            showNotification("Document Sent to Printer Queue");
          };
          frameImg.onerror = () => {
            isPrintingProcess = false;
            showNotification("Unable to Initialize Print Request");
          };
        } else {
          printWindow.contentWindow?.print();
          isPrintingProcess = false;
          showNotification("Document Sent to Printer Queue");
        }
      } else {
        isPrintingProcess = false;
      }
      return;
    }

    try {
      const compiledPdfBytes = await (
        activeDoc as any
      ).compileAndFlattenDocumentBytes();
      if (!compiledPdfBytes)
        throw new Error("Compilation returned empty byte payload.");

      const blob = new Blob([compiledPdfBytes], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.top = "-10000px";
      iframe.style.left = "-10000px";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      iframe.src = blobUrl;

      document.body.appendChild(iframe);

      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            showNotification("Document Sent to Printer Queue");
          } catch (frameErr) {
            console.error("Frame print execution error: ", frameErr);
            showNotification("Unable to Initialize Print Request");
          }

          setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
            URL.revokeObjectURL(blobUrl);
          }, 30000);
        }, 500);
      };
    } catch (err) {
      console.error("Print Engine Failure: ", err);
      showNotification("Unable to Initialize Print Request");
    } finally {
      isPrintingProcess = false;
    }
  }

  onMount(() => {
    (activeDoc as any).compileAndFlattenDocumentBytes = () =>
      titleBarRef.getAnnotatedPdfBytes();

    // Silent background check for production optimization patches
    async function checkForApplicationUpdates() {
      try {
        const update = await check();
        if (update && update.available) {
          // Check if the manifest has a critical override (e.g. forced or critical flag)
          const isCritical = (update as any).rawJson?.critical || (update as any).rawJson?.forced;
          if (isCritical) {
            showNotification(`Critical patch v${update.version} available`);
            await update.downloadAndInstall();
            showNotification("Restarting to apply updates...");
            await relaunch();
          } else {
            availableUpdate = update;
            showUpdateToast = true;
          }
        }
      } catch (updateErr) {
        // Silently swallow network tracking errors when running in offline workstation settings
        console.error("Background update loop status: ", updateErr);
      }
    }

    checkForApplicationUpdates();

    // 🛡️ Capturing Phase Firewall: Drops native browser print / refresh commands instantly
    const trapBrowserPrintShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();

        // Short-circuit safely to prevent a backend runtime crash if no file is open
        if (!activeDoc || !activeDoc.pageOrder || activeDoc.pageOrder.length === 0) {
          return;
        }

        // Trigger headless print routines only if document is active
        triggerHeadlessPrintSpool();
        return;
      }

      // Block F5 / Shift+F5 (and Ctrl/Cmd+R) so the webview never hard-refreshes mid-edit
      if (
        e.key === "F5" ||
        e.code === "F5" ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    };
    window.addEventListener("keydown", trapBrowserPrintShortcut, {
      capture: true,
    });

    // Load recents list on app mount and audit file locations using our Rust command
    const stored = localStorage.getItem("speeddf_recents");
    if (stored) {
      try {
        activeDoc.recents = JSON.parse(stored);
        const paths = activeDoc.recents.map((f: any) => f.path).filter(Boolean);
        if (paths.length > 0) {
          invoke<Record<string, boolean>>("check_files_exist", { paths })
            .then((res) => {
              fileStatusMap = res;
            })
            .catch((err) => console.error("Recent status check failed:", err));
        }
        // Drop IDB thumbs for files no longer in recents (idle, non-blocking)
        scheduleOrphanThumbnailCleanup(paths);
      } catch (e) {
        console.error("Failed to parse recent files queue:", e);
      }
    } else {
      // Empty recents — still prune any leftover IDB thumb rows
      scheduleOrphanThumbnailCleanup([]);
    }

    // Primary path for double-click / "Open with": Rust loads the file during
    // setup and emits `startup-file-loaded`. Do not rely on invoke('check_startup_file')
    // — that IPC path can be blocked by CSP on cold start.
    // Second-instance opens (while app already running) emit `open-file-request`
    // via the single-instance plugin — always open as a new tab (or focus existing).
    let startupFileHandled = false;
    let destroyStartupFileListener: (() => void) | null = null;
    let destroyOpenFileListener: (() => void) | null = null;

    async function handleStartupFilePayload(payload: StartupPayload | null) {
      if (startupFileHandled) return;
      if (payload && payload.bytes && payload.bytes.length > 0) {
        startupFileHandled = true;
        console.log(`Loading single-file payload launch: ${payload.name}`);
        try {
          const typedBytes = new Uint8Array(payload.bytes);
          await loadDocument(typedBytes, payload.name, payload.path);
        } catch (err) {
          // Allow a later retry emit from Rust if load failed before readiness.
          startupFileHandled = false;
          console.warn("Startup file load failed:", err);
        }
      }
    }

    async function handleOpenFileRequest(payload: StartupPayload | null) {
      if (!payload?.bytes?.length) return;
      try {
        const typedBytes = new Uint8Array(payload.bytes);
        await loadDocument(typedBytes, payload.name, payload.path);
      } catch (err) {
        console.warn("Open-file request (second instance) failed:", err);
      }
    }

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        Promise.all([
          listen<StartupPayload>("startup-file-loaded", (event) => {
            void handleStartupFilePayload(event.payload);
          }),
          listen<StartupPayload>("open-file-request", (event) => {
            void handleOpenFileRequest(event.payload);
          }),
        ]),
      )
      .then((unlistenFns) => {
        destroyStartupFileListener = unlistenFns[0];
        destroyOpenFileListener = unlistenFns[1];
      })
      .catch((err) =>
        console.warn("Startup/open-file event listener registration failed:", err),
      );

    // Capture system Close Button actions cleanly via browser-native confirmation prompts
    const unlistenCloseRequest = appWindow.onCloseRequested(async (event) => {
      // Priority 1 — Unsaved data guard. Must always fire first to prevent data loss.
      if (activeDoc.isDirty) {
        event.preventDefault(); // 🛡️ STOP EXITING SYNCHRONOUSLY IMMEDIATELY
        unsavedModalMessage =
          "Warning: You have unsaved markups on this engineering layout drawing. Are you sure you want to exit speedDF and discard your modifications?";
        pendingNavigationAction = () => {
          activeDoc.isDirty = false;
          // Re-trigger native close: onCloseRequested fires again on a clean document,
          // flowing naturally into the installer gate below if an update is staged.
          appWindow.close();
        };
        showUnsavedModal = true;
        return; // Halt — do not proceed to installer or exit until user resolves prompt
      }

      // Priority 2 — Installer gate. Only reached when document is completely clean.
      if (isUpdateReadyToInstall && pendingUpdateRef) {
        // Circuit breaker: atomically consume the state before any async work
        // to prevent re-entrant loops if appWindow.close() re-fires this handler.
        isUpdateReadyToInstall = false;
        const updateRef = pendingUpdateRef;
        pendingUpdateRef = null;

        isApplyingDeferredUpdate = true;
        event.preventDefault();

        try {
          await updateRef.install();
          await appWindow.close();
        } catch (installErr) {
          console.error("Deferred update install failed on close:", installErr);
          isApplyingDeferredUpdate = false;
        }
        return;
      }
    });

    return () => {
      window.removeEventListener("keydown", trapBrowserPrintShortcut, {
        capture: true,
      });
      unlistenCloseRequest.then((f) => f());
      if (destroyStartupFileListener) destroyStartupFileListener();
      if (destroyOpenFileListener) destroyOpenFileListener();
    };
  });

  function sanitizeFileName(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    const name = parts[parts.length - 1] || "";
    return name.replace(/[\x00-\x1F\x7F-\x9F<>&"']/g, "");
  }

  $effect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Block edit shortcuts while save/flatten is running
      if (activeDoc.isSaving) {
        const key = e.key.toLowerCase();
        if (
          key === "z" ||
          key === "y" ||
          key === "delete" ||
          key === "backspace" ||
          (isCtrl && (key === "arrowleft" || key === "arrowright"))
        ) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (isCtrl && key === "s") {
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();

        // Short-circuit safely if workspace is empty
        if (!activeDoc || !activeDoc.pageOrder || activeDoc.pageOrder.length === 0) {
          return;
        }

        // Custom search activation logic runs only if document is present
        showSearchPopup = true;
        tick().then(() => {
          const input = document.getElementById("search-input");
          if (input) {
            (input as HTMLInputElement).focus();
            (input as HTMLInputElement).select();
          }
        });
        return;
      }

      if (e.key === "Escape" && showSearchPopup) {
        e.preventDefault();
        closeSearch();
        return;
      }

      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const isShift = e.shiftKey;

      if (isCtrl) {
        const key = e.key.toLowerCase();
        if (key === "n") {
          e.preventDefault();
          if (!activeDoc.rawBytes) {
            createBlankDocument();
          }
        } else if (key === "o") {
          e.preventDefault();
          openFile();
        } else if (key === "s") {
          e.preventDefault();
          if (activeDoc.isSaving) return;
          if (isShift) {
            if (titleBarRef?.triggerSaveAs) {
              titleBarRef.triggerSaveAs();
            }
          } else {
            if (activeDoc.fileType === "tiff") {
              if (titleBarRef?.triggerSaveAs) {
                titleBarRef.triggerSaveAs();
              }
            } else {
              if (titleBarRef?.triggerSave) {
                titleBarRef.triggerSave();
              }
            }
          }
        } else {
          if (activeDoc.isSaving) return;
          switch (key) {
            case "z":
              e.preventDefault();
              executeUndoAction();
              break;
            case "y":
              e.preventDefault();
              executeRedoAction();
              break;
            case "arrowleft":
              e.preventDefault();
              if (activeDoc.currentPage) {
                rotatePageAction(activeDoc.currentPage, "counter");
              }
              break;
            case "arrowright":
              e.preventDefault();
              if (activeDoc.currentPage) {
                rotatePageAction(activeDoc.currentPage, "clockwise");
              }
              break;
          }
        }
      } else {
        if (e.key === "F1") {
          e.preventDefault();
          showHelpModal = !showHelpModal;
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);

    let destroyDragDropListener: (() => void) | null = null;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('tauri://drag-drop', (event: any) => {
        const path = event.payload.paths[0] || '';
        const cleanName = sanitizeFileName(path);
        if (path) {
          promptAndLoadFile(
            path,
            cleanName,
            "You have unsaved markup layers. Do you want to discard your progress and drop this new drawing sheet in?",
          );
        }
      }).then((unlistenFn) => {
        destroyDragDropListener = unlistenFn;
      });
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
      if (destroyDragDropListener) destroyDragDropListener();
    };
  });
</script>

<svelte:window onclick={closeMenu} onkeydown={closeMenu} />

<div
  oncontextmenu={handleRightClick}
  class="flex flex-col h-screen w-screen overflow-hidden select-none bg-[#070a12] text-slate-100 font-sans antialiased"
>
  {#if isApplyingDeferredUpdate}
    <div class="fixed inset-0 z-[9999] bg-[#070a12]/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
      <div class="w-10 h-10 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
      <p class="text-sm font-semibold text-slate-300 tracking-wide uppercase">Installing update&hellip;</p>
    </div>
  {/if}
  <TitleBar
    bind:this={titleBarRef}
    onMinimize={minimizeApp}
    onMaximize={maximizeApp}
    onClose={closeApp}
    onToggleHelp={() => (showHelpModal = !showHelpModal)}
    onPrint={triggerHeadlessPrintSpool}
    onOpenFile={openFile}
    onCloseDocument={closeDocument}
    onSaveSuccess={(msg: string) =>
      showNotification(msg || "Changes Written Safely to Disk")}
    onToggleOcr={toggleOcrDrawer}
    onNew={createBlankDocument}
    onSave={() => titleBarRef?.triggerSave?.()}
    onSaveAs={() => titleBarRef?.triggerSaveAs?.()}
    onUndo={executeUndoAction}
    onRedo={executeRedoAction}
  />

  {#if activeDoc.rawBytes || activeDoc.openDocuments.length > 0}
    <div class="flex flex-1 w-full overflow-hidden relative">
      <ToolSidebar bind:zoomScale />
      
      <div class="relative flex-1 h-full min-h-0 min-w-0 flex flex-col">
        <DocumentTabs
          onRequestClose={closeDocumentById}
          onRequestCloseAll={closeAllDocuments}
          recentFiles={recentFiles}
          {fileStatusMap}
          onOpenRecent={openRecentFile}
        />
        {#if activeDoc.rawBytes}
          {#key activeDoc.activeDocumentId}
            <div class="flex-1 min-h-0 flex flex-col relative">
              <Workspace
                {zoomScale}
                {isSystemPrinting}
                onShowNotification={showNotification}
                openDurationMs={activeDoc.activeDocumentId === renderDurationDocId
                  ? renderDurationMs
                  : null}
              />
            </div>
          {/key}
        {:else}
          <div class="flex-1 flex items-center justify-center text-slate-600 text-xs">
            Loading document…
          </div>
        {/if}

        {#if showSearchPopup}
          <!-- Floating search popup UI panel -->
          <div class="absolute top-4 right-6 z-50 animate-fade-in pointer-events-auto">
            <div class="bg-[#0B0B0F]/95 border border-slate-800/80 shadow-[0_12px_40px_rgba(0,0,0,0.6)] rounded-xl p-3 flex items-center gap-2.5 backdrop-blur-md text-white select-none">
              <!-- Input Area -->
              <div class="relative flex items-center bg-slate-950 rounded-lg border border-slate-800 px-2.5 py-1.5 focus-within:border-cyan-500/80 transition-colors w-60">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-slate-500 mr-2">
                  <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  id="search-input"
                  type="text"
                  bind:value={searchQuery}
                  oninput={() => { void performTextSearch(); }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey) {
                        goToPrevMatch();
                      } else {
                        goToNextMatch();
                      }
                    }
                  }}
                  placeholder="Find in document..."
                  class="bg-transparent text-slate-100 placeholder-slate-500 text-xs outline-none w-full font-medium border-none p-0 focus:ring-0 focus:outline-none"
                />
                {#if searchQuery}
                  <button
                    onclick={() => { searchQuery = ""; void performTextSearch(); }}
                    class="text-slate-500 hover:text-slate-300 ml-1.5 p-0.5 rounded-full hover:bg-slate-800 transition-colors cursor-pointer border-none bg-transparent"
                    title="Clear text"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                {/if}
              </div>

              <!-- Case Toggle (Aa) -->
              <button
                onclick={toggleCaseSensitive}
                class="h-8 px-2.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer flex items-center justify-center bg-transparent
                  {caseSensitive 
                    ? 'bg-cyan-950/40 border-cyan-500/80 text-cyan-400' 
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'}"
                title="Match Case"
              >
                Aa
              </button>

              <!-- Match Counter Indicator -->
              <div class="text-[11px] font-mono text-slate-400 min-w-[50px] text-center select-none font-semibold border-l border-r border-slate-800 px-2 h-5 flex items-center justify-center">
                {#if isSearchRunning}
                  …
                {:else if totalMatches > 0}
                  {currentMatchIndex + 1}/{totalMatches}
                {:else if searchQuery && totalMatches === 0}
                  0/0
                {:else}
                  —
                {/if}
              </div>

              <!-- Chevrons Navigation -->
              <div class="flex items-center gap-1">
                <button
                  onclick={goToPrevMatch}
                  disabled={totalMatches === 0}
                  class="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                  title="Previous Match (Shift+Enter)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button
                  onclick={goToNextMatch}
                  disabled={totalMatches === 0}
                  class="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                  title="Next Match (Enter)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>

              <!-- Close Button -->
              <button
                onclick={closeSearch}
                class="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-900/50 transition-all cursor-pointer"
                title="Close Search (Esc)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
        {/if}
      </div>

      <PageSidebar />

      {#if showOcrDrawer}
        <OcrPanel onClose={() => (showOcrDrawer = false)} />
      {/if}

      <!-- Blocks tools + workspace + sidebar while the active document is saving -->
      {#if activeDoc.isSaving}
        <div
          class="absolute inset-0 z-[4000] bg-[#070a12]/55 backdrop-blur-[2px] flex items-center justify-center select-none cursor-wait"
          role="status"
          aria-live="polite"
          aria-busy="true"
          onmousedown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onkeydown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div
            class="flex flex-col items-center gap-3 px-6 py-5 rounded-xl bg-[#0b101c]/95 border border-cyan-500/25 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
          >
            <div
              class="w-9 h-9 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin"
            ></div>
            <p class="text-[11px] font-bold uppercase tracking-widest text-cyan-300">
              Saving…
            </p>
            <p class="text-[10px] text-slate-500 font-medium max-w-[200px] text-center leading-relaxed">
              Compiling annotations. Editing is paused until the file is written.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <RecentDashboard
      {recentFiles}
      {fileStatusMap}
      openDocumentPaths={activeDoc.openDocuments
        .map((d: { filePath?: string | null }) => d.filePath || "")
        .filter(Boolean)}
      {openRecentFile}
      {handleCompress}
      {handleClearFromRecents}
      {handleDeleteFromHDD}
    />
  {/if}
</div>

<HelpModal bind:show={showHelpModal} {openCoffeeLink} />

{#if showUnsavedModal}
  <div
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[1000] flex items-center justify-center p-6 font-sans select-none"
  >
    <div
      class="bg-[#0b101c] border border-red-500/30 w-full max-w-md rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-300 animate-fade-in animate-duration-150"
    >
      <div
        class="p-4 border-b border-slate-900/60 flex items-center gap-2 bg-[#120b0e]"
      >
        <span class="text-xs font-bold uppercase tracking-widest text-red-400"
          >⚠️ Unsaved Layout Modifications</span
        >
      </div>
      <div
        class="p-5 text-xs text-slate-300 leading-relaxed font-sans font-medium"
      >
        {unsavedModalMessage}
      </div>
      <div
        class="p-3 border-t border-slate-900/60 bg-[#0e1524]/40 flex justify-end gap-2.5"
      >
        <button
          onclick={() => {
            showUnsavedModal = false;
            pendingNavigationAction = null;
          }}
          class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={() => {
            showUnsavedModal = false;
            if (pendingNavigationAction) pendingNavigationAction();
          }}
          class="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[11px] font-bold transition-colors shadow-lg shadow-red-950/40"
        >
          Discard & Continue
        </button>
      </div>
    </div>
  </div>
{/if}

<ContextMenu
  bind:show={showMenu}
  x={menuX}
  y={menuY}
  showAddComment={!!contextCommentTarget}
  onOpen={openFile}
  onSave={() => titleBarRef?.triggerSave?.()}
  onSaveAs={() => titleBarRef?.triggerSaveAs?.()}
  onAddComment={handleAddCommentHere}
/>

{#if showToast}
  <div
    class="fixed top-16 left-16 z-[5000] pointer-events-none speeddf-toast-animate"
  >
    <div
      class="bg-[#0e1629]/95 border border-cyan-500/30 shadow-[0_4px_20px_rgba(6,182,212,0.15)] rounded-xl px-4 py-3 flex flex-col gap-1.5 backdrop-blur-md max-w-sm relative overflow-hidden"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-6 w-6 shrink-0 bg-cyan-500/10 rounded-lg items-center justify-center text-cyan-400 font-bold text-sm"
        >
          ✓
        </div>
        <div class="flex flex-col">
          <p class="text-[12px] font-semibold text-slate-100 tracking-wide">
            {toastMessage}
          </p>
          <p class="text-[10px] text-slate-400 font-medium mt-0.5">
            Local document processed
          </p>
        </div>
      </div>

      {#if isZippingLoader}
        <div
          class="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-cyan-500 to-emerald-400 speeddf-zip-bar"
        ></div>
      {/if}
    </div>
  </div>
{/if}

{#if showUpdateToast && availableUpdate}
  <div
    class="fixed bottom-6 right-6 z-[5000] speeddf-toast-animate"
  >
    <div
      class="bg-slate-900 border border-slate-800 shadow-[0_8px_32px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col gap-3 backdrop-blur-md max-w-sm relative overflow-hidden"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex h-8 w-8 shrink-0 bg-cyan-500/10 rounded-lg items-center justify-center text-cyan-400 font-bold text-sm animate-pulse"
        >
          ⚡
        </div>
        <div class="flex flex-col">
          <p class="text-[12px] font-bold text-slate-100 uppercase tracking-wider">
            Update Available
          </p>
          <p class="text-[10px] text-slate-400 font-medium mt-1 leading-normal">
            Optimization patch v{availableUpdate.version} is ready for installation.
          </p>
        </div>
      </div>

      <div class="flex gap-2 justify-end mt-1">
        <button
          onclick={() => {
            showUpdateToast = false;
          }}
          class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border border-slate-700/50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          onclick={async () => {
            const up = availableUpdate;
            showUpdateToast = false;
            showNotification("Applying update and relaunching...");
            try {
              await up.downloadAndInstall();
              await relaunch();
            } catch (err) {
              console.error("Update failed:", err);
              showNotification("Update failed");
            }
          }}
          class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 shadow-lg shadow-cyan-950/40 cursor-pointer"
        >
          Now
        </button>
        <button
          onclick={async () => {
            const up = availableUpdate;
            showUpdateToast = false;
            downloadOnClose = true;
            // Silently pre-download the update binary immediately so the close handler
            // only needs to run install() — no download wait at shutdown time.
            try {
              showNotification("Downloading update in background...");
              isDownloadingUpdate = true;
              let contentLength = 0;
              let downloaded = 0;

              await up.download((event: DownloadEvent) => {
                if (event.event === "Started") {
                  contentLength = event.data.contentLength || 0;
                  downloaded = 0;
                  updateDownloadProgress = 0;
                } else if (event.event === "Progress") {
                  downloaded += event.data.chunkLength;
                  if (contentLength > 0) {
                    updateDownloadProgress = Math.round((downloaded / contentLength) * 100);
                  }
                } else if (event.event === "Finished") {
                  updateDownloadProgress = 100;
                }
              });

              isDownloadingUpdate = false;
              pendingUpdateRef = up;
              isUpdateReadyToInstall = true;
              showNotification("Update ready — will install when you close.");
            } catch (dlErr) {
              console.error("Background update pre-download failed:", dlErr);
              isDownloadingUpdate = false;
              // Fallback: keep availableUpdate set so close handler can still attempt downloadAndInstall
              pendingUpdateRef = null;
              isUpdateReadyToInstall = false;
            }
          }}
          class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 shadow-lg shadow-emerald-950/40 cursor-pointer"
        >
          When I close
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isDownloadingUpdate}
  <div
    class="fixed bottom-6 right-6 z-[5000] speeddf-toast-animate"
  >
    <div
      class="bg-slate-900 border border-slate-800 shadow-[0_8px_32px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col gap-3 backdrop-blur-md w-64 relative overflow-hidden"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex h-8 w-8 shrink-0 bg-cyan-500/10 rounded-lg items-center justify-center text-cyan-400 font-bold text-sm animate-pulse"
        >
          ⬇️
        </div>
        <div class="flex flex-col w-full">
          <p class="text-[12px] font-bold text-slate-100 uppercase tracking-wider">
            Downloading Update
          </p>
          <div class="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-cyan-500 transition-all duration-300 ease-out"
              style="width: {updateDownloadProgress}%"
            ></div>
          </div>
          <p class="text-[10px] text-slate-400 font-medium mt-1.5 text-right">
            {updateDownloadProgress}%
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Drop-down physics for premium window system feedback */
  .speeddf-toast-animate {
    animation: speeddfToastDrop 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes speeddfToastDrop {
    0% {
      transform: translateY(-1.5rem);
      opacity: 0;
    }
    100% {
      transform: translateY(0);
      opacity: 1;
    }
  }

  /* Zipping physics engine simulation for high-speed file buffers */
  .speeddf-zip-bar {
    width: 0%;
    animation: speeddfZipAction 0.45s cubic-bezier(0.075, 0.82, 0.165, 1)
      forwards;
  }

  @keyframes speeddfZipAction {
    0% {
      width: 0%;
    }
    100% {
      width: 100%;
    }
  }

</style>
