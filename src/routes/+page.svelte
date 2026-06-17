<script lang="ts">
  import TitleBar from "../components/TitleBar.svelte";
  import ToolSidebar from "../components/ToolSidebar.svelte";
  import Workspace from "../components/Workspace.svelte";
  import PageSidebar from "../components/PageSidebar.svelte";

  let activeTool = $state(null);
  let darkMode = $state(true); 

  function minimizeApp() { console.log("Minimize"); }
  function maximizeApp() { console.log("Maximize"); }
  function closeApp() { console.log("Close"); }
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