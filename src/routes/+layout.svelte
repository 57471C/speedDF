<script lang="ts">
import { onMount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Import your Tailwind global stylesheet directly into SvelteKit's layout root!
import "../global.css";

// Svelte 5 rune that safely grabs child pages (like our dashboard)
let { children } = $props();

onMount(() => {
  // Main window starts `visible: false` in tauri.conf — reveal once UI is ready.
  // Tools widgets create themselves hidden and reveal from `/tools` after paint.
  setTimeout(async () => {
    try {
      const win = getCurrentWindow();
      if (win.label.startsWith("tools-")) return;
      await win.show();
    } catch (e) {
      console.warn("Failed to reveal window:", e);
    }
  }, 50);
});
</script>

{@render children()}
