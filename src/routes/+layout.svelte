<script lang="ts">
  // Import your Tailwind global stylesheet directly into SvelteKit's layout root!
  import '../global.css';
  
  // Svelte 5 rune that safely grabs child pages (like our dashboard)
  let { children } = $props();
</script>

{@render children()}