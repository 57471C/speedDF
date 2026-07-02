<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open } from "@tauri-apps/plugin-dialog";
  import * as pdfjsLib from "pdfjs-dist";
  import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";
  import ContextMenu from "../components/ContextMenu.svelte";
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
      unsavedModalMessage = "You have unsaved markup changes on this layout drawing. Are you sure you want to close this document and discard your progress?";
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
      const compiledPdfBytes = await (activeDoc as any).compileAndFlattenDocumentBytes();
      if (!compiledPdfBytes) throw new Error("Compilation returned empty byte payload.");

      const blob = new Blob([compiledPdfBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-10000px';
      iframe.style.left = '-10000px';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
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
    (activeDoc as any).compileAndFlattenDocumentBytes = () => titleBarRef.getAnnotatedPdfBytes();

    // 🛡️ Capturing Phase Firewall: Drops native browser print commands instantly
    const trapBrowserPrintShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        triggerHeadlessPrintSpool();
      }
    };
    window.addEventListener('keydown', trapBrowserPrintShortcut, { capture: true });

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
        const payload = await invoke<StartupPayload | null>("check_startup_file");

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
    appWindow.listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
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
    });

    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isCtrl) {
        const key = e.key.toLowerCase();
        if (key === "o") {
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
    const unlistenCloseRequest = appWindow.onCloseRequested((event) => {
      if (activeDoc.isDirty) {
        event.preventDefault(); // 🛡️ STOP EXITING SYNCHRONOUSLY IMMEDIATELY
        unsavedModalMessage = "Warning: You have unsaved markups on this engineering layout drawing. Are you sure you want to exit speedDF and discard your modifications?";
        pendingNavigationAction = () => {
          activeDoc.isDirty = false;
          // Directly invoke native close thread bypassing the dirty trap rule
          appWindow.close();
        };
        showUnsavedModal = true;
      }
    });

    return () => {
      window.removeEventListener('keydown', trapBrowserPrintShortcut, { capture: true });
      unlistenCloseRequest.then(f => f());
    };
  });
</script>

<svelte:window onclick={closeMenu} onkeydown={closeMenu} />

<div
  oncontextmenu={handleRightClick}
  class="flex flex-col h-screen w-screen overflow-hidden select-none bg-[#070a12] text-slate-100 font-sans antialiased"
>
  <TitleBar
    bind:this={titleBarRef}
    onMinimize={minimizeApp}
    onMaximize={maximizeApp}
    onClose={closeApp}
    onToggleHelp={() => (showHelpModal = !showHelpModal)}
    onPrint={triggerHeadlessPrintSpool}
    onOpenFile={openFile}
    onCloseDocument={closeDocument}
    onSaveSuccess={(msg: string) => showNotification(msg || "Changes Written Safely to Disk")}
  />

  {#if activeDoc.rawBytes}
    <div class="flex flex-1 w-full overflow-hidden relative">
      <ToolSidebar bind:zoomScale />
      <Workspace {zoomScale} {isSystemPrinting} />
      <PageSidebar />

      {#if renderDurationMs !== null}
        <div class="fixed top-11 left-14 z-10 select-none pointer-events-none font-mono text-[9px] tracking-widest text-slate-500/40 font-semibold uppercase mix-blend-screen">
          Document Loaded in: <span class="text-cyan-400/30 font-bold">{renderDurationMs}ms</span>
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
            class="flex gap-6 overflow-x-auto pb-6 pt-3 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent scroll-smooth snap-x"
          >
            {#each recentFiles as file}
              {@const exists = fileStatusMap[file.path] !== false}
              {@const isLandscape = file.orientation === "landscape"}

              <div
                onclick={() => exists && openRecentFile(file.name, file.path)}
                onkeydown={(e) =>
                  e.key === "Enter" &&
                  exists &&
                  openRecentFile(file.name, file.path)}
                role="button"
                tabindex="0"
                class="flex-none snap-start relative group bg-[#090d16] rounded-xl overflow-hidden border transition-all duration-300 ease-out shadow-lg transform
                       {exists
                  ? 'border-slate-800/60 shadow-slate-950/50 cursor-pointer hover:shadow-2xl hover:scale-106 hover:border-emerald-500/30'
                  : 'border-slate-900 opacity-40 cursor-not-allowed select-none'}
                       {isLandscape ? 'w-72 h-44' : 'w-44 h-56'}"
              >
                <div
                  class="w-full h-full flex items-center justify-center bg-[#04060a] relative"
                >
                  {#if file.thumbnail}
                    <img
                      src={file.thumbnail}
                      alt={file.name}
                      class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-102"
                    />
                  {/if}

                  <div
                    class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-80 group-hover:opacity-100 transition-opacity"
                  ></div>
                </div>

                <div
                  class="absolute bottom-0 inset-x-0 p-3 flex flex-col justify-end"
                >
                  <p
                    class="text-xs font-medium text-slate-200 truncate w-full tracking-wide drop-shadow-md"
                  >
                    {file.name}
                  </p>
                </div>

                {#if exists}
                  <div
                    class="absolute top-3 right-3 flex h-2 w-2"
                    title="File available on local storage disk"
                  >
                    <span
                      class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                    ></span>
                    <span
                      class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]"
                    ></span>
                  </div>
                {:else}
                  <div
                    class="absolute top-3 right-3 h-2 w-2 rounded-full bg-slate-700"
                    title="File path missing or unreadable"
                  ></div>
                {/if}
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
            >v0.9.3</span
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
        class="p-3 border-t border-slate-900/60 bg-[#0e1524]/40 flex justify-end"
      >
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
  <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[1000] flex items-center justify-center p-6 font-sans select-none">
    <div class="bg-[#0b101c] border border-red-500/30 w-full max-w-md rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-300 animate-fade-in animate-duration-150">
      <div class="p-4 border-b border-slate-900/60 flex items-center gap-2 bg-[#120b0e]">
        <span class="text-xs font-bold uppercase tracking-widest text-red-400">⚠️ Unsaved Layout Modifications</span>
      </div>
      <div class="p-5 text-xs text-slate-300 leading-relaxed font-sans font-medium">
        {unsavedModalMessage}
      </div>
      <div class="p-3 border-t border-slate-900/60 bg-[#0e1524]/40 flex justify-end gap-2.5">
        <button 
          onclick={() => { showUnsavedModal = false; pendingNavigationAction = null; }}
          class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold transition-colors"
        >
          Cancel
        </button>
        <button 
          onclick={() => { showUnsavedModal = false; if (pendingNavigationAction) pendingNavigationAction(); }}
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
  <div class="fixed top-16 left-16 z-[5000] pointer-events-none speeddf-toast-animate">
    <div class="bg-[#0e1629]/95 border border-cyan-500/30 shadow-[0_4px_20px_rgba(6,182,212,0.15)] rounded-xl px-4 py-3 flex flex-col gap-1.5 backdrop-blur-md max-w-sm relative overflow-hidden">
      <div class="flex items-center gap-3">
        <div class="flex h-6 w-6 shrink-0 bg-cyan-500/10 rounded-lg items-center justify-center text-cyan-400 font-bold text-sm">
          ✓
        </div>
        <div class="flex flex-col">
          <p class="text-[12px] font-semibold text-slate-100 tracking-wide">{toastMessage}</p>
          <p class="text-[10px] text-slate-400 font-medium mt-0.5">Local document processed</p>
        </div>
      </div>

      {#if isZippingLoader}
        <div class="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-cyan-500 to-emerald-400 speeddf-zip-bar"></div>
      {/if}
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
    animation: speeddfZipAction 0.45s cubic-bezier(0.075, 0.82, 0.165, 1) forwards;
  }
  
  @keyframes speeddfZipAction {
    0% { width: 0%; }
    100% { width: 100%; }
  }
</style>
