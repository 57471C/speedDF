<script lang="ts">
  import type { AnnotationShape } from "../pdfStore.svelte";
  import { activeDoc } from "../pdfStore.svelte";

  let {
    shape,
    pageNumber,
    idx,
  }: {
    shape: AnnotationShape;
    pageNumber: number;
    idx: number;
  } = $props();

  const pointsString = $derived(
    shape.points ? shape.points.map((p) => `${p.x},${p.y}`).join(" ") : "",
  );

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    if (activeDoc.activeTool === "select") {
      activeDoc.selectedShape = { pageNumber, index: idx };
    }
  }

  const isSelected = $derived(
    activeDoc.selectedShape?.pageNumber === pageNumber &&
      activeDoc.selectedShape?.index === idx,
  );
</script>

{#if shape.type === "highlight" && shape.points}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <polyline
    onclick={handleClick}
    points={pointsString}
    stroke="#fff200"
    stroke-width="2.0"
    stroke-opacity="0.42"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="cursor-pointer pointer-events-auto hover:stroke-yellow-300 transition-colors {isSelected
      ? 'stroke-yellow-300 stroke-opacity-60'
      : ''}"
  />
{:else if shape.type === "pen" && shape.points}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <polyline
    onclick={handleClick}
    points={pointsString}
    stroke={shape.color || "#ef4444"}
    stroke-width={(shape.thickness || 3) * 0.22}
    stroke-opacity="1"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="cursor-pointer pointer-events-auto hover:stroke-cyan-400 transition-colors {isSelected
      ? 'stroke-cyan-400'
      : ''}"
  />
{/if}
