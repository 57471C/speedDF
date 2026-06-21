<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import * as pdfjsLib from "pdfjs-dist";
  import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";
  import {
    activeDoc,
    executeUndoAction,
    executeRedoAction,
    rotatePageAction,
  } from "../pdfStore.svelte";

  let darkMode = $state(true);
  let zoomScale = $state(100);
  let showHelpModal = $state(false);

  const appWindow = getCurrentWindow();

  const minimizeApp = () => appWindow.minimize();
  const maximizeApp = () => appWindow.toggleMaximize();
  const closeApp = () => appWindow.close();

  interface StartupPayload {
    bytes: number[];
    name: string;
    path: string;
  }

  onMount(async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

    try {
      console.log(
        "Checking for startup single-file execution arguments handshake...",
      );
      const payload = await invoke<StartupPayload | null>("check_startup_file");

      if (payload && payload.bytes && payload.bytes.length > 0) {
        console.log(`Loading single-file payload launch: ${payload.name}`);
        const typedBytes = new Uint8Array(payload.bytes);
        const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
        const pdfDocument = await loadingTask.promise;

        activeDoc.rawBytes = typedBytes;
        activeDoc.pageCount = pdfDocument.numPages;
        activeDoc.pageOrder = Array.from(
          { length: pdfDocument.numPages },
          (_, idx) => idx + 1,
        );
        activeDoc.currentPage = 1;
        activeDoc.shapes = {};
        activeDoc.fileName = payload.name;
        activeDoc.filePath = payload.path;
      }
    } catch (err) {
      console.warn("Startup file handshake processing failed:", err);
    }

    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const isCtrl = event.ctrlKey || event.metaKey;

      if (isCtrl) {
        switch (event.key.toLowerCase()) {
          case "z":
            event.preventDefault();
            executeUndoAction();
            break;
          case "y":
            event.preventDefault();
            executeRedoAction();
            break;
          case "arrowleft":
            event.preventDefault();
            if (activeDoc.currentPage) {
              rotatePageAction(activeDoc.currentPage, "counter");
            }
            break;
          case "arrowright":
            event.preventDefault();
            if (activeDoc.currentPage) {
              rotatePageAction(activeDoc.currentPage, "clockwise");
            }
            break;
        }
      } else {
        if (event.key === "F1") {
          event.preventDefault();
          showHelpModal = !showHelpModal;
        }
      }
    });
  });
</script>

<div
  class="flex flex-col h-screen w-screen overflow-hidden select-none bg-[#070a12] text-slate-100 font-sans antialiased"
>
  <TitleBar
    onMinimize={minimizeApp}
    onMaximize={maximizeApp}
    onClose={closeApp}
    {darkMode}
    onToggleTheme={() => (darkMode = !darkMode)}
    onToggleHelp={() => (showHelpModal = !showHelpModal)}
  />

  <div class="flex flex-1 w-full overflow-hidden relative">
    <ToolSidebar bind:zoomScale />
    <Workspace {zoomScale} />
    <PageSidebar />
  </div>
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
            >v0.4.2</span
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
