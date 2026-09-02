<script lang="ts">
import { onMount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { attachWindowWheelZoomGuard, lockWebviewPageZoom } from "../lib/interaction/wheelZoom";

// Import your Tailwind global stylesheet directly into SvelteKit's layout root!
import "../global.css";

// Svelte 5 rune that safely grabs child pages (like our dashboard)
let { children } = $props();

onMount(() => {
  // Prevent WebView/browser page-zoom and pane scroll on Ctrl/Cmd+wheel (Workspace owns zoomScale)
  const detachWheelGuard = attachWindowWheelZoomGuard();
  void lockWebviewPageZoom();

  // Main + secondary doc windows start hidden — reveal once UI is ready.
  // Tools widgets create themselves hidden and reveal from `/tools` after paint.
  setTimeout(async () => {
    try {
      const win = getCurrentWindow();
      if (win.label.startsWith("tools-")) return;
      await win.show();
      // Secondary doc windows may remain behind the parent until focused
      if (win.label.startsWith("doc-")) {
        await win.setFocus().catch(() => undefined);
      }
    } catch (e) {
      console.warn("Failed to reveal window:", e);
    }
  }, 50);

  return () => {
    detachWheelGuard();
  };
});
</script>

{@render children()}
