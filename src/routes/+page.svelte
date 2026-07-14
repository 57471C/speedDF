<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open, ask } from "@tauri-apps/plugin-dialog";
  import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { open as openBrowser } from "@tauri-apps/plugin-shell";
  import * as pdfjsLib from "pdfjs-dist";
  import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";
  import ContextMenu from "../components/ContextMenu.svelte";
  import OcrPanel from "./OcrPanel.svelte";
  import {
    activeDoc as activeDocStore,
    executeUndoAction,
    executeRedoAction,
    rotatePageAction,
  } from "../pdfStore.svelte";

  const activeDoc = activeDocStore as any;

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
  let matchesList = $state<{ pageNumber: number; element: HTMLElement }[]>([]);

  // Maps to store original HTML of spans to restore them before new search highlights
  const originalSpansMap = new Map<HTMLElement, string>();

  function clearHighlights() {
    originalSpansMap.forEach((origHTML, element) => {
      if (element.isConnected) {
        element.innerHTML = origHTML;
      }
    });
    originalSpansMap.clear();
  }

  function closeSearch() {
    showSearchPopup = false;
    searchQuery = "";
    currentMatchIndex = -1;
    totalMatches = 0;
    matchesList = [];
    clearHighlights();
  }

  function performTextSearch() {
    clearHighlights();

    if (!searchQuery) {
      totalMatches = 0;
      currentMatchIndex = -1;
      matchesList = [];
      return;
    }

    const spans = document.querySelectorAll(".textLayer span");
    const tempMatches: { pageNumber: number; element: HTMLElement }[] = [];
    const query = searchQuery;

    const regexFlags = caseSensitive ? "g" : "gi";
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, regexFlags);

    spans.forEach((span) => {
      const text = span.textContent || "";
      if (regex.test(text)) {
        const parentPage = span.closest("[data-page-number]");
        if (parentPage) {
          const pageNum = parseInt(parentPage.getAttribute("data-page-number") || "1", 10);
          tempMatches.push({
            pageNumber: pageNum,
            element: span as HTMLElement,
          });
        }
      }
    });

    matchesList = tempMatches;
    totalMatches = matchesList.length;

    if (totalMatches > 0) {
      currentMatchIndex = 0;
      highlightAllMatches();
      scrollToMatch(0);
    } else {
      currentMatchIndex = -1;
    }
  }

  function highlightAllMatches() {
    if (!searchQuery) return;
    const query = searchQuery;
    const regexFlags = caseSensitive ? "g" : "gi";
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, regexFlags);

    matchesList.forEach((match, index) => {
      const span = match.element;
      if (!originalSpansMap.has(span)) {
        originalSpansMap.set(span, span.innerHTML);
      }

      const isCurrent = index === currentMatchIndex;
      const highlightClass = isCurrent
        ? "bg-amber-400 text-slate-950 font-bold ring-2 ring-cyan-500 rounded-sm px-0.5 z-50 relative"
        : "bg-yellow-400 text-slate-950 rounded-sm px-0.5";

      span.innerHTML = originalSpansMap.get(span)!.replace(regex, (m) => {
        return `<mark class="${highlightClass}">${m}</mark>`;
      });
    });
  }

  function goToNextMatch() {
    if (totalMatches === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
    highlightAllMatches();
    scrollToMatch(currentMatchIndex);
  }

  function goToPrevMatch() {
    if (totalMatches === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
    highlightAllMatches();
    scrollToMatch(currentMatchIndex);
  }

  function toggleCaseSensitive() {
    caseSensitive = !caseSensitive;
    performTextSearch();
  }

  function scrollToMatch(index: number) {
    if (index < 0 || index >= matchesList.length) return;
    const match = matchesList[index];
    match.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });
    // Set currentPage in global store so sidebar tracks correctly
    activeDoc.currentPage = match.pageNumber;
  }

  // Auto-Reset Bindings: Reset search when document or zoom scale changes
  $effect(() => {
    const _zoom = zoomScale;
    const _file = activeDoc.fileName;
    closeSearch();
  });

  let loadStartTime = 0;
  let renderDurationMs = $state<number | null>(null);
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

  let recentFiles = $state<RecentFile[]>([]);
  let fileStatusMap = $state<Record<string, boolean>>({});

  // Capture Page 1 from incoming bytes, convert to Base64 data URL, and update storage
  async function registerRecentFile(
    name: string,
    path: string,
    bytes: Uint8Array,
  ) {
    try {
      if (activeDoc.fileType === "tiff") {
        console.log(
          "Recent Tracker: Document type is TIFF. Registering basic file history metadata entry...",
        );
        let dataUrl = "";
        let orientation = "portrait";
        const pageData = activeDoc.tiffPages[0];
        if (pageData) {
          const blob = new Blob([pageData as any], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              orientation = img.width > img.height ? "landscape" : "portrait";
              resolve();
            };
            img.src = url;
          });
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              URL.revokeObjectURL(url);
              resolve(reader.result as string);
            };
            reader.readAsDataURL(blob);
          });
        }
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
        recentFiles = currentList;
        return;
      }
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
        recentFiles = currentList;
      }
    } catch (err) {
      console.error(
        "Failed to extract snapshot for recent files tracker:",
        err,
      );
    }
  }

  async function loadDocument(
    rawBytes: Uint8Array,
    fileName: string,
    filePath: string,
  ) {
    // 1. Instantly trigger state layers and fire the toast notification
    isZippingLoader = true;
    showNotification("FILE OPEN:");

    // 2. Force Svelte to immediately flush style/DOM updates and paint the UI
    // before the thread can be occupied by heavy canvas stream rendering
    await tick();

    // 3. Begin the high-resolution hardware benchmarking clock
    loadStartTime = performance.now();
    renderDurationMs = null;

    try {
      // Detect technical drawing file signatures by matching path extensions
      const isTiff =
        fileName.toLowerCase().endsWith(".tiff") ||
        fileName.toLowerCase().endsWith(".tif");

      if (isTiff) {
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
        activeDoc.pageOrder = Array.from(
          { length: decodedPages.length },
          (_, i) => i + 1,
        );
        activeDoc.bookmarks = [];
      } else {
        // Keep your existing standard PDF.js document load configuration completely untouched here
        activeDoc.fileType = "pdf";
        activeDoc.tiffPages = [];

        const loadingTask = pdfjsLib.getDocument({
          data: rawBytes.slice(0),
          cMapUrl: window.location.origin + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: window.location.origin + "/standard_fonts/",
          wasmUrl: window.location.origin + "/",
        });
        const pdfDocument = await loadingTask.promise;

        activeDoc.rawBytes = rawBytes;
        activeDoc.pageCount = pdfDocument.numPages;
        activeDoc.pageOrder = Array.from(
          { length: pdfDocument.numPages },
          (_, idx) => idx + 1,
        );
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.fileName = fileName;
        activeDoc.filePath = filePath;

        // Ingestion of outlines / bookmarks
        try {
          const outline = await pdfDocument.getOutline();
          if (outline && outline.length > 0) {
            const loadedBookmarks = await Promise.all(
              outline.map(async (item) => {
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
            activeDoc.bookmarks = loadedBookmarks;
          } else {
            activeDoc.bookmarks = [];
          }
        } catch (outlineErr) {
          console.error("Failed to parse document outline tree:", outlineErr);
          activeDoc.bookmarks = [];
        }

        await registerRecentFile(fileName, filePath, rawBytes);
      }

      // Calculate layout compilation completion speeds down to the millisecond
      const loadEndTime = performance.now();
      renderDurationMs = Math.round(loadEndTime - loadStartTime);
    } catch (err) {
      console.error("Document Ingestion Core Fault: ", err);
      showNotification("Unable to process document stream");
    } finally {
      isZippingLoader = false;
    }
  }

  async function promptAndLoadFile(
    filePath: string,
    fileName: string,
    unsavedMessage: string,
  ) {
    const doLoad = async () => {
      activeDoc.flushDocumentState();
      try {
        const payload = await invoke<StartupPayload>("read_file_bytes", {
          path: filePath,
        });
        if (payload && payload.bytes) {
          const typedBytes = new Uint8Array(payload.bytes);
          await loadDocument(typedBytes, fileName || payload.name, filePath);
        }
      } catch (err) {
        console.error(`Failed to load document from ${filePath}:`, err);
      }
    };

    if (activeDoc.isDirty) {
      unsavedModalMessage = unsavedMessage;
      pendingNavigationAction = () => {
        activeDoc.isDirty = false;
        setTimeout(doLoad, 50);
      };
      showUnsavedModal = true;
    } else {
      await doLoad();
    }
  }

  async function openRecentFile(name: string, path: string) {
    await promptAndLoadFile(
      path,
      name,
      "You have unsaved changes on this layout sheet. Are you sure you want to load this recent file and discard your progress?",
    );
  }

  function handleClearFromRecents(targetId: string) {
    recentFiles = recentFiles.filter((f) => f.path !== targetId);
    localStorage.setItem("speeddf_recents", JSON.stringify(recentFiles));
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
    if (activeDoc.rawBytes) return;
    const doCreate = async () => {
      activeDoc.flushDocumentState();
      try {
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        doc.addPage([595.276, 841.89]); // A4 dimensions
        const bytes = await doc.save();

        activeDoc.fileType = "pdf";
        activeDoc.rawBytes = bytes;
        activeDoc.fileName = "Untitled.pdf";
        activeDoc.filePath = null;
        activeDoc.pageCount = 1;
        activeDoc.pageOrder = [1];
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.rotations = {};
        activeDoc.bookmarks = [];
        activeDoc.isDirty = false;
        showNotification("Created New Blank A4 Document");
      } catch (e) {
        console.error("Failed to create blank document:", e);
      }
    };

    if (activeDoc.isDirty) {
      unsavedModalMessage =
        "You have unsaved changes on this layout sheet. Are you sure you want to create a new blank A4 document and discard your progress?";
      pendingNavigationAction = () => {
        activeDoc.isDirty = false;
        setTimeout(doCreate, 50);
      };
      showUnsavedModal = true;
    } else {
      await doCreate();
    }
  }

  async function openFile() {
    // 1. Update the native dialog call to allow filtering for technical drawings
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Supported Documents",
          extensions: ["pdf", "tiff", "tif"],
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

  function closeDocument() {
    // Intercept if the document has active modifications on screen
    if (activeDoc.isDirty) {
      unsavedModalMessage =
        "You have unsaved markup changes on this layout drawing. Are you sure you want to close this document and discard your progress?";
      pendingNavigationAction = () => {
        activeDoc.isDirty = false;
        activeDoc.flushDocumentState();
      };
      showUnsavedModal = true;
    } else {
      activeDoc.flushDocumentState();
    }
  }

  // Auto-track files when they are loaded into activeDoc
  $effect(() => {
    if (activeDoc.rawBytes && activeDoc.fileName && activeDoc.filePath) {
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

  function handleRightClick(e: MouseEvent) {
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;
    showMenu = true;
  }

  function closeMenu() {
    showMenu = false;
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

    // 🛡️ Capturing Phase Firewall: Drops native browser print commands instantly
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
    };
    window.addEventListener("keydown", trapBrowserPrintShortcut, {
      capture: true,
    });

    // Load recents list on app mount and audit file locations using our Rust command
    const stored = localStorage.getItem("speeddf_recents");
    if (stored) {
      try {
        recentFiles = JSON.parse(stored);
        const paths = recentFiles.map((f) => f.path);
        if (paths.length > 0) {
          invoke<Record<string, boolean>>("check_files_exist", { paths })
            .then((res) => {
              fileStatusMap = res;
            })
            .catch((err) => console.error("Recent status check failed:", err));
        }
      } catch (e) {
        console.error("Failed to parse recent files queue:", e);
      }
    }

    async function initStartupFile() {
      try {
        console.log(
          "Checking for startup single-file execution arguments handshake...",
        );
        const payload = await invoke<StartupPayload | null>(
          "check_startup_file",
        );

        if (payload && payload.bytes && payload.bytes.length > 0) {
          console.log(`Loading single-file payload launch: ${payload.name}`);
          const typedBytes = new Uint8Array(payload.bytes);
          await loadDocument(typedBytes, payload.name, payload.path);
        }
      } catch (err) {
        console.warn("Startup file handshake processing failed:", err);
      }
    }
    initStartupFile();

    // Listen for drag-drop events natively from Tauri
    appWindow.listen<{ paths: string[] }>(
      "tauri://drag-drop",
      async (event) => {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const path = paths[0];
          const parts = path.split(/[\\/]/);
          const name = parts[parts.length - 1];

          await promptAndLoadFile(
            path,
            name,
            "You have unsaved markup layers. Do you want to discard your progress and drop this new drawing sheet in?",
          );
        }
      },
    );

    window.addEventListener("keydown", (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

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
          if (isShift) {
            if (titleBarRef?.triggerSaveAs) {
              titleBarRef.triggerSaveAs();
            }
          } else {
            if (activeDoc.fileType === "tiff") {
              console.warn(
                "Keyboard Shortcut: Overwrite blocked for TIFF. Redirecting user transaction to Save As dialog...",
              );
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
    });

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

  {#if activeDoc.rawBytes}
    <div class="flex flex-1 w-full overflow-hidden relative">
      <ToolSidebar bind:zoomScale />
      
      <div class="relative flex-1 h-full min-w-0 flex flex-col">
        <Workspace {zoomScale} {isSystemPrinting} />

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
                  oninput={performTextSearch}
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
                    onclick={() => { searchQuery = ""; performTextSearch(); }}
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
                {#if totalMatches > 0}
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

      {#if renderDurationMs !== null}
        <div
          class="fixed top-11 left-14 z-10 select-none pointer-events-none font-mono text-[9px] tracking-widest text-slate-500/40 font-semibold uppercase mix-blend-screen"
        >
          Document Loaded in: <span class="text-cyan-400/30 font-bold"
            >{renderDurationMs}ms</span
          >
        </div>
      {/if}
    </div>
  {:else}
    <div
      class="flex-1 w-full flex flex-col justify-center items-center py-8 h-full min-h-[82vh] overflow-hidden bg-[#070a12] text-slate-100 p-12 select-none relative"
    >
      <div
        class="m-auto flex flex-col items-center justify-center text-center max-w-sm pointer-events-none select-none animate-fade-in"
      >
        <svg
          width="192"
          height="192"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
          style="display: block;"
          ><defs
            ><linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%"
              ><stop offset="0%" stop-color="#0f172a"></stop><stop
                offset="100%"
                stop-color="#1a2744"
              ></stop></linearGradient
            ><linearGradient id="bolt-grad" x1="0%" y1="0%" x2="100%" y2="100%"
              ><stop offset="0%" stop-color="#38bdf8"></stop><stop
                offset="100%"
                stop-color="#06b6d4"
              ></stop></linearGradient
            ><filter id="bolt-glow" x="-40%" y="-40%" width="180%" height="180%"
              ><feGaussianBlur stdDeviation="8" result="blur"
              ></feGaussianBlur><feMerge
                ><feMergeNode in="blur"></feMergeNode><feMergeNode
                  in="SourceGraphic"
                ></feMergeNode></feMerge
              ></filter
            ><filter id="glow-soft" x="-60%" y="-60%" width="220%" height="220%"
              ><feGaussianBlur stdDeviation="18" result="blur"
              ></feGaussianBlur><feMerge
                ><feMergeNode in="blur"></feMergeNode></feMerge
              ></filter
            ><clipPath id="tile-clip"
              ><rect x="0" y="0" width="512" height="512" rx="108" ry="108"
              ></rect></clipPath
            ></defs
          ><rect
            x="0"
            y="0"
            width="512"
            height="512"
            rx="108"
            ry="108"
            fill="url(#bg-grad)"
          ></rect><g opacity="0.28"
            ><line
              x1="52"
              y1="218"
              x2="128"
              y2="218"
              stroke="#06b6d4"
              stroke-width="6"
              stroke-linecap="round"
            ></line><line
              x1="38"
              y1="244"
              x2="118"
              y2="244"
              stroke="#06b6d4"
              stroke-width="5"
              stroke-linecap="round"
            ></line><line
              x1="52"
              y1="270"
              x2="108"
              y2="270"
              stroke="#06b6d4"
              stroke-width="4"
              stroke-linecap="round"
            ></line></g
          ><g transform="translate(256, 264) rotate(-4) translate(-256, -264)"
            ><polygon
              points="168,118 338,118 338,128 348,138 348,420 168,420"
              fill="#0a1628"
              opacity="0.5"
              transform="translate(8, 8)"
            ></polygon><polygon
              points="162,112 322,112 362,152 362,414 162,414"
              fill="#1e293b"
            ></polygon><polygon points="322,112 362,112 362,152" fill="#0f172a"
            ></polygon><polygon points="322,112 362,152 322,152" fill="#334155"
            ></polygon><line
              x1="190"
              y1="195"
              x2="330"
              y2="195"
              stroke="#334155"
              stroke-width="7"
              stroke-linecap="round"
            ></line><line
              x1="190"
              y1="218"
              x2="300"
              y2="218"
              stroke="#334155"
              stroke-width="7"
              stroke-linecap="round"
            ></line><line
              x1="190"
              y1="241"
              x2="315"
              y2="241"
              stroke="#334155"
              stroke-width="7"
              stroke-linecap="round"
            ></line><line
              x1="190"
              y1="315"
              x2="330"
              y2="315"
              stroke="#334155"
              stroke-width="6"
              stroke-linecap="round"
            ></line><line
              x1="190"
              y1="336"
              x2="280"
              y2="336"
              stroke="#334155"
              stroke-width="6"
              stroke-linecap="round"
            ></line><line
              x1="190"
              y1="357"
              x2="305"
              y2="357"
              stroke="#334155"
              stroke-width="6"
              stroke-linecap="round"
            ></line></g
          ><ellipse
            cx="278"
            cy="264"
            rx="68"
            ry="110"
            fill="#06b6d4"
            opacity="0.12"
            filter="url(#glow-soft)"
          ></ellipse><g filter="url(#bolt-glow)"
            ><polygon
              points="306,138 248,276 284,276 206,396 174,396 236,262 200,262 256,138"
              fill="url(#bolt-grad)"
            ></polygon></g
          ><polygon
            points="296,155 254,264 278,264 220,368 246,368 290,264 266,264 302,168"
            fill="#bae6fd"
            opacity="0.35"
          ></polygon></svg
        >

        <h1
          class="text-lg font-bold tracking-tight text-slate-100 mb-2"
          style="font-family: 'Space Grotesk', sans-serif;"
        >
          speed<span class="text-cyan-400">DF</span>
        </h1>
        <p class="text-[11px] text-slate-500 font-medium max-w-xs">
          Drop any PDF document anywhere into this window, or use the menu
          toolbar above to begin editing your documents.
        </p>
      </div>

      {#if recentFiles.length > 0}
        <div
          class="w-full border-t border-slate-900/40 pt-5 max-w-5xl animate-fade-in pointer-events-auto mt-auto"
        >
          <h2
            class="text-[9px] font-bold uppercase tracking-widest text-slate-500 pl-4 mb-3 text-left"
          >
            Recent Documents
          </h2>

          <div
            class="flex gap-2 overflow-x-auto pt-8 pb-3 pl-7 pr-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent scroll-smooth snap-x"
          >
            {#each recentFiles as file}
              {@const exists = fileStatusMap[file.path] !== false}
              {@const isLandscape = file.orientation === "landscape"}
              {@const doc = { ...file, id: file.path }}

              <div class="flex-shrink-0 relative snap-start {isLandscape ? 'w-64 h-40' : 'w-40 h-52'}">
                <div
                  onclick={() => exists && openRecentFile(file.name, file.path)}
                  onkeydown={(e) => e.key === "Enter" && exists && openRecentFile(file.name, file.path)}
                  role="button"
                  tabindex="0"
                  class="recent-card w-full h-full relative flex flex-col items-center bg-slate-950 rounded-none cursor-pointer transform scale-90 transition-all duration-200 ease-out origin-center select-none group p-0 border border-slate-900/40 will-change-transform transform-gpu subpixel-antialiased [backface-visibility:hidden] hover:scale-105 hover:-translate-y-2 hover:z-50 hover:border-transparent hover:shadow-[0_20px_40px_rgba(0,0,0,0.9)]"
                >
                  <div class="absolute -top-5 left-0 right-0 text-[10.5px] font-medium text-slate-400 group-hover:text-cyan-400 overflow-hidden whitespace-nowrap px-0.5 pointer-events-none w-full select-none">
                    {#if file.name.length > 22}
                      <div class="speeddf-marquee-track inline-flex whitespace-nowrap will-change-transform">
                        <span class="speeddf-marquee-content pr-8">{file.name}</span>
                        <span class="speeddf-marquee-content pr-8">{file.name}</span>
                      </div>
                    {:else}
                      <span class="truncate block w-full text-left">{file.name}</span>
                    {/if}
                  </div>

                  <div class="bottom-dock-tray absolute bottom-0 left-0 right-0 h-10 bg-[#0f1424] border-t border-slate-800/80 flex items-center justify-around px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-out z-40">
                    {#if exists}
                      <button
                        onclick={(e) => { e.stopPropagation(); handleCompress(doc); }}
                        class="p-1.5 text-cyan-400 hover:text-white hover:bg-cyan-500/20 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-cyan"
                        title="Compress PDF"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>
                      </button>
                    {/if}

                    <button
                      onclick={(e) => { e.stopPropagation(); handleClearFromRecents(doc.id); }}
                      class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-slate"
                      title="Remove from Recents"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>

                    {#if exists}
                      <button
                        onclick={(e) => { e.stopPropagation(); handleDeleteFromHDD(doc); }}
                        class="p-1.5 text-red-400 hover:text-white hover:bg-red-500/20 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-red"
                        title="Delete File From Computer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    {/if}
                  </div>

                  <div class="w-full h-full flex items-center justify-center bg-[#04060a] relative overflow-hidden transition-all duration-200 {!exists ? 'opacity-25 grayscale brightness-75' : ''}">
                    {#if file.thumbnail}
                      <img src={file.thumbnail} alt={file.name} class="w-full h-full object-cover rounded-none" />
                    {/if}
                    <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-30"></div>
                  </div>

                  {#if exists}
                    <div class="absolute top-2.5 left-2.5 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981] filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" title="File available on local storage disk"></div>
                  {:else}
                    <div class="absolute top-2.5 left-2.5 h-2 w-2 rounded-full bg-slate-700 filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" title="File path missing or unreadable"></div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showHelpModal}
  <div
    onclick={() => (showHelpModal = false)}
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-6 font-sans select-none"
  >
    <div
      onclick={(e) => e.stopPropagation()}
      class="bg-[#0b101c] border border-slate-800 w-full max-w-2xl max-h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-300"
    >
      <div
        class="p-4 border-b border-slate-900/60 flex items-center justify-between bg-[#0e1524]/60"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-bold uppercase tracking-widest text-slate-400"
            >speedDF Engine Configuration & Licensing</span
          >
          <span
            class="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded font-mono text-slate-400"
            >v0.9.12</span
          >
        </div>
        <button
          onclick={() => (showHelpModal = false)}
          class="text-slate-500 hover:text-white text-sm transition-colors"
          >✕</button
        >
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-6 text-xs leading-relaxed">
        <div>
          <h4
            class="text-slate-100 font-bold uppercase tracking-wide text-[11px] mb-2.5 flex items-center gap-1.5 text-emerald-400"
          >
            ⌨️ Keyboard Operations Map
          </h4>
          <div
            class="bg-slate-950/50 rounded-lg border border-slate-900 p-3 grid grid-cols-2 gap-2 font-mono text-[11px]"
          >
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >Ctrl + Z</kbd
              > <span>Undo Action Transaction</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >Ctrl + Y</kbd
              > <span>Redo Action Transaction</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >Ctrl + ←</kbd
              > <span>Counter-Clockwise Rotation</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >Ctrl + →</kbd
              > <span>Clockwise Page Rotation</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >F1</kbd
              > <span>Toggle This System Control Panel</span>
            </div>
          </div>
        </div>

        <div>
          <h4
            class="text-slate-100 font-bold uppercase tracking-wide text-[11px] mb-2.5 flex items-center gap-1.5 text-cyan-400"
          >
            🌐 Canvas Navigation
          </h4>
          <div
            class="bg-slate-950/50 rounded-lg border border-slate-900 p-3 grid grid-cols-2 gap-2 font-mono text-[11px]"
          >
            <div class="flex items-center gap-2">
              <span class="flex gap-1">
                <kbd
                  class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                  >Spacebar</kbd
                >
                <span class="text-slate-500 font-sans">+</span>
                <kbd
                  class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                  >Drag</kbd
                >
              </span>
              <span>Pan Workspace</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="flex gap-1">
                <kbd
                  class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                  >Ctrl</kbd
                >
                <span class="text-slate-500 font-sans">+</span>
                <kbd
                  class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                  >Wheel</kbd
                >
              </span>
              <span>Dynamic Zoom</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="bg-slate-800 px-1.5 py-0.5 rounded text-white border-b border-slate-600"
                >Ctrl + P</kbd
              > <span>Print Document</span>
            </div>
          </div>
        </div>

        <div>
          <h4
            class="text-slate-100 font-bold uppercase tracking-wide text-[11px] mb-2 flex items-center gap-1.5 text-blue-400"
          >
            ⚖️ End-User License Agreement (EULA)
          </h4>
          <div
            class="bg-slate-950/40 rounded-lg border border-slate-900 p-3 h-28 overflow-y-auto text-slate-400 text-[10px] space-y-2 font-mono"
          >
            <p class="font-bold text-slate-300">
              1. LICENSE GRANT & RESTRICTIONS
            </p>
            <p>
              speedDF grants you a personal, non-transferable, free utility
              license to process local documents. You may not reverse engineer,
              decompile, or distribute compiled workspace assets commercially
              without express written consent.
            </p>
            <p class="font-bold text-slate-300">2. NO WARRANTY (AS-IS)</p>
            <p>
              THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
              NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
              HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
              WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
              OUT OF OR IN CONNECTION WITH THE SOFTWARE.
            </p>
          </div>
        </div>

        <div>
          <h4
            class="text-slate-100 font-bold uppercase tracking-wide text-[11px] mb-2 flex items-center gap-1.5 text-amber-500"
          >
            📜 Open Source Compliance & Legal Notices
          </h4>
          <div
            class="bg-slate-950/40 rounded-lg border border-slate-900 p-3 text-[10px] space-y-3 font-mono text-slate-400"
          >
            <p>
              This software utilizes public open-source libraries. In compliance
              with active licensing terms, the following copyright notices must
              remain hardcoded inside binary distributions:
            </p>
            <div class="border-l-2 border-slate-800 pl-2.5 space-y-1.5">
              <p>
                • <b class="text-slate-300">pdf-lib:</b> Copyright (c) 2019 Andrew
                Chon. Distributed under the MIT License.
              </p>
              <p>
                • <b class="text-slate-300">lopdf:</b> Copyright (c) 2016-2024 lopdf
                Developers. Distributed under the MIT License.
              </p>
              <p>
                • <b class="text-slate-300">PDF.js:</b> Copyright (c) Mozilla Foundation.
                Distributed under the Apache License 2.0.
              </p>
              <p>
                • <b class="text-slate-300">Tauri Engine:</b> Copyright (c) 2019-2024
                Tauri Programme Collective. Distributed under Apache 2.0 / MIT.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        class="p-3 border-t border-slate-900/60 bg-[#0e1524]/40 flex justify-between items-center"
      >
        <button
          onclick={openCoffeeLink}
          class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-sans text-[11px] font-bold uppercase tracking-wider text-amber-400 transition-all duration-150 hover:border-amber-500/60 hover:bg-amber-500/20"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 8h1a4 4 0 1 1 0 8h-1"></path>
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>
            <line x1="6" y1="2" x2="6" y2="4"></line>
            <line x1="10" y1="2" x2="10" y2="4"></line>
            <line x1="14" y1="2" x2="14" y2="4"></line>
          </svg>
          <span>Buy me a coffee</span>
        </button>

        <button
          onclick={() => (showHelpModal = false)}
          class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-bold transition-colors shadow-md"
        >
          Acknowledge & Close
        </button>
      </div>
    </div>
  </div>
{/if}

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
  onOpen={openFile}
  onSave={() => titleBarRef?.triggerSave?.()}
  onSaveAs={() => titleBarRef?.triggerSaveAs?.()}
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
  /* Local Scoped Recent Card Styles to Bypass Build Chain Hover Bugs */
  .recent-card {
    transform: scale(0.9);
    transition: transform 200ms ease-out, border-color 200ms ease-out, box-shadow 200ms ease-out;
  }
  .recent-card:hover {
    transform: scale(1.05) translateY(-8px) !important;
    z-index: 50 !important;
    border-color: transparent !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.9) !important;
  }
  .recent-card:hover .speeddf-marquee-content {
    color: #22d3ee !important; /* cyan-400 */
    text-shadow: 0 0 8px rgba(34, 211, 238, 0.4) !important;
  }
  .recent-card:hover .speeddf-marquee-track {
    animation: speeddfMarquee 6s linear infinite;
    overflow: visible !important;
    width: max-content !important;
  }
  @keyframes speeddfMarquee {
    0% {
      transform: translateX(0%);
    }
    100% {
      transform: translateX(-50%);
    }
  }
  .bottom-dock-tray {
    opacity: 0;
    transition: opacity 150ms ease-out;
  }
  .recent-card:hover .bottom-dock-tray {
    opacity: 1 !important;
  }
  .hover-cyan:hover {
    color: #fff !important;
    background-color: rgba(6, 182, 212, 0.2) !important;
  }
  .hover-slate:hover {
    color: #fff !important;
    background-color: #1e293b !important;
  }
  .hover-red:hover {
    color: #fff !important;
    background-color: rgba(239, 68, 68, 0.2) !important;
  }

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
