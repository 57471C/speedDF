<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import * as pdfjsLib from "pdfjs-dist";
  // ⚡ Load the worker path exactly ONCE at the absolute root level of the app
  import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
  
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";

  // Configure the global worker source once here to prevent Vite's HMR watcher reload loop
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  let activeTool = $state(null);
  let darkMode = $state(true); 

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
      <ToolSidebar bind:activeTool={activeTool} />
      <Workspace />
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