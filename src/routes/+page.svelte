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
  import { activeDoc } from "../pdfStore.svelte";

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  let darkMode = $state(true); 
  let zoomScale = $state(100);

  interface FilePayload {
    bytes: number[];
    name: string;
  }

  // ⚡ NEW LOGIC: Checks for OS double-clicks on load instantly
  onMount(async () => {
    try {
      const payload = await invoke<FilePayload | null>("check_startup_file");
      
      if (payload && payload.bytes && payload.bytes.length > 0) {
        console.log(`OS Launch Intercepted! Loading: ${payload.name}`);
        
        const typedBytes = new Uint8Array(payload.bytes);
        const loadingTask = pdfjsLib.getDocument({ data: typedBytes.slice(0) });
        const pdfDocument = await loadingTask.promise;

        activeDoc.rawBytes = typedBytes;
        activeDoc.pageCount = pdfDocument.numPages;
        activeDoc.pageOrder = Array.from({ length: pdfDocument.numPages }, (_, idx) => idx + 1);
        activeDoc.currentPage = 1;
        (activeDoc as any).scrollTop = 0; 
        activeDoc.shapes = {}; 
        activeDoc.fileName = payload.name;
      }
    } catch (err) {
      console.warn("Startup file handshake processing failed:", err);
    }
  });

  function minimizeApp() { 
    getCurrentWindow().minimize();
  }
  function maximizeApp() { 
    getCurrentWindow().toggleMaximize(); 
  }
  function closeApp() { 
    getCurrentWindow().close();
  }
</script>

<div class={darkMode ? "dark" : ""}>
  <div class="flex flex-col w-[100vw] h-screen overflow-hidden bg-[#090d16] text-slate-200 font-sans antialiased select-none">
    
    <TitleBar 
      bind:darkMode={darkMode} 
      onMinimize={minimizeApp} 
      onMaximize={maximizeApp} 
      onClose={closeApp} 
    />

    <div class="flex flex-1 w-full overflow-hidden">
      <ToolSidebar />
      <Workspace {zoomScale} />
      <PageSidebar />
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: #090d16;
  }
</style>