<script lang="ts">
import { onMount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Import your Tailwind global stylesheet directly into SvelteKit's layout root!
import "../global.css";

// Svelte 5 rune that safely grabs child pages (like our dashboard)
let { children } = $props();

onMount(() => {
  setTimeout(async () => {
    try {
      await getCurrentWindow().show();
    } catch (e) {
      console.warn("Failed to reveal window:", e);
    }
  }, 50);
});
</script>

{@render children()}