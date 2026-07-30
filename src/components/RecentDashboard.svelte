<script lang="ts">
  export interface RecentFile {
    name: string;
    path: string;
    timestamp: number;
    thumbnail: string;
    orientation?: string;
  }

  let {
    recentFiles,
    fileStatusMap,
    openDocumentPaths = [],
    openRecentFile,
    handleCompress,
    handleClearFromRecents,
    handleDeleteFromHDD,
  }: {
    recentFiles: RecentFile[];
    fileStatusMap: Record<string, boolean>;
    /** Paths already open as tabs — hidden from the dashboard list. */
    openDocumentPaths?: string[];
    openRecentFile: (name: string, path: string) => void;
    handleCompress: (file: any) => void;
    handleClearFromRecents: (targetId: string) => void;
    handleDeleteFromHDD: (file: any) => void;
  } = $props();

  let visibleRecents = $derived.by(() => {
    const open = new Set(
      (openDocumentPaths || []).map((p) => p.toLowerCase()).filter(Boolean),
    );
    return (recentFiles || []).filter(
      (f) => f.path && !open.has(f.path.toLowerCase()),
    );
  });
</script>

<div
  class="flex-1 w-full flex flex-col justify-center items-center py-8 h-full min-h-[82vh] overflow-hidden p-12 select-none relative"
  style="background: var(--sdf-bg-app); color: var(--sdf-text-primary);"
>
  <div
    class="m-auto flex flex-col items-center justify-center text-center max-w-sm pointer-events-none select-none animate-fade-in"
  >
    <svg
      class="hero-icon-dark"
      width="192"
      height="192"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
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

    <svg
      class="hero-icon-light"
      width="192"
      height="192"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      ><defs
        ><linearGradient id="bg-light-grad" x1="0%" y1="0%" x2="100%" y2="100%"
          ><stop offset="0%" stop-color="#f8fafc"></stop><stop
            offset="100%"
            stop-color="#e2e8f0"
          ></stop></linearGradient
        ><linearGradient id="bolt-light-grad" x1="0%" y1="0%" x2="100%" y2="100%"
          ><stop offset="0%" stop-color="#0891b2"></stop><stop
            offset="100%"
            stop-color="#0e7490"
          ></stop></linearGradient
        ><filter id="bolt-light-glow" x="-40%" y="-40%" width="180%" height="180%"
          ><feGaussianBlur stdDeviation="7" result="blur"
          ></feGaussianBlur><feMerge
            ><feMergeNode in="blur"></feMergeNode><feMergeNode
              in="SourceGraphic"
            ></feMergeNode></feMerge
          ></filter
        ><filter id="glow-light-soft" x="-60%" y="-60%" width="220%" height="220%"
          ><feGaussianBlur stdDeviation="16" result="blur"
          ></feGaussianBlur></filter
        ><filter id="doc-light-shadow" x="-10%" y="-10%" width="130%" height="130%"
          ><feDropShadow
            dx="0"
            dy="4"
            stdDeviation="10"
            flood-color="#94a3b8"
            flood-opacity="0.25"
          ></feDropShadow></filter
        ></defs
      ><rect
        x="0"
        y="0"
        width="512"
        height="512"
        rx="108"
        ry="108"
        fill="url(#bg-light-grad)"
      ></rect><g opacity="0.22"
        ><line
          x1="52"
          y1="218"
          x2="128"
          y2="218"
          stroke="#0891b2"
          stroke-width="6"
          stroke-linecap="round"
        ></line><line
          x1="38"
          y1="244"
          x2="118"
          y2="244"
          stroke="#0891b2"
          stroke-width="5"
          stroke-linecap="round"
        ></line><line
          x1="52"
          y1="270"
          x2="108"
          y2="270"
          stroke="#0891b2"
          stroke-width="4"
          stroke-linecap="round"
        ></line></g
      ><g
        transform="translate(256, 264) rotate(-4) translate(-256, -264)"
        filter="url(#doc-light-shadow)"
        ><polygon points="162,112 322,112 362,152 362,414 162,414" fill="#ffffff"
        ></polygon><polygon points="322,112 362,112 362,152" fill="#e2e8f0"
        ></polygon><polygon points="322,112 362,152 322,152" fill="#cbd5e1"
        ></polygon><line
          x1="190"
          y1="195"
          x2="330"
          y2="195"
          stroke="#e2e8f0"
          stroke-width="7"
          stroke-linecap="round"
        ></line><line
          x1="190"
          y1="218"
          x2="300"
          y2="218"
          stroke="#e2e8f0"
          stroke-width="7"
          stroke-linecap="round"
        ></line><line
          x1="190"
          y1="241"
          x2="315"
          y2="241"
          stroke="#e2e8f0"
          stroke-width="7"
          stroke-linecap="round"
        ></line><line
          x1="190"
          y1="315"
          x2="330"
          y2="315"
          stroke="#e2e8f0"
          stroke-width="6"
          stroke-linecap="round"
        ></line><line
          x1="190"
          y1="336"
          x2="280"
          y2="336"
          stroke="#e2e8f0"
          stroke-width="6"
          stroke-linecap="round"
        ></line><line
          x1="190"
          y1="357"
          x2="305"
          y2="357"
          stroke="#e2e8f0"
          stroke-width="6"
          stroke-linecap="round"
        ></line></g
      ><ellipse
        cx="278"
        cy="264"
        rx="68"
        ry="110"
        fill="#0891b2"
        opacity="0.08"
        filter="url(#glow-light-soft)"
      ></ellipse><g filter="url(#bolt-light-glow)"
        ><polygon
          points="306,138 248,276 284,276 206,396 174,396 236,262 200,262 256,138"
          fill="url(#bolt-light-grad)"
        ></polygon></g
      ><polygon
        points="296,155 254,264 278,264 220,368 246,368 290,264 266,264 302,168"
        fill="#cffafe"
        opacity="0.4"
      ></polygon></svg
    >

    <h1
      class="text-lg font-bold tracking-tight mb-2"
      style="font-family: 'Space Grotesk', sans-serif; color: var(--sdf-text-primary);"
    >
      speed<span style="color: var(--sdf-accent-text);">DF</span>
    </h1>
    <p class="text-[11px] font-medium max-w-xs" style="color: var(--sdf-text-muted);">
      Drop any PDF document anywhere into this window, or use the menu
      toolbar above to begin editing your documents.
    </p>
  </div>

  {#if visibleRecents.length > 0}
    <!--
      5-column grid: equal column tracks + uniform gap.
      Each card uses its own aspect-ratio (portrait taller, landscape wider-looking)
      at full column width so neighbours never collide and portraits aren't sparse.
    -->
    <div
      class="w-full border-t pt-5 max-w-6xl animate-fade-in pointer-events-auto mt-auto"
      style="border-color: var(--sdf-border-subtle);"
    >
      <h2
        class="text-[9px] font-bold uppercase tracking-widest pl-4 mb-3 text-left"
        style="color: var(--sdf-text-muted);"
      >
        Recent Documents
      </h2>

      <div
        class="grid grid-cols-5 gap-x-5 gap-y-12 pt-10 pb-6 px-4 w-full items-start"
        style="grid-template-columns: repeat(5, minmax(0, 1fr));"
      >
        {#each visibleRecents as file}
          {@const exists = fileStatusMap[file.path] !== false}
          {@const isLandscape = file.orientation === "landscape"}
          {@const doc = { ...file, id: file.path }}

          <div class="relative snap-start min-w-0 w-full">
            <div
              onclick={() => {
                if (exists) openRecentFile(file.name, file.path);
              }}
              onkeydown={(e) => {
                if (e.key === "Enter" && exists) openRecentFile(file.name, file.path);
              }}
              role="button"
              tabindex={exists ? 0 : -1}
              aria-disabled={!exists}
              title={exists ? file.path : "File unavailable on disk"}
              class="recent-card-item w-full relative flex flex-col items-center rounded-none select-none group p-0 border will-change-transform transform-gpu subpixel-antialiased [backface-visibility:hidden] min-w-0
                {isLandscape ? 'recent-card-item--landscape' : 'recent-card-item--portrait'}
                {exists
                  ? 'cursor-pointer'
                  : 'recent-card-item--disabled opacity-40 cursor-default'}"
              style="background: var(--sdf-bg-surface); border-color: var(--sdf-border-subtle);"
            >
              <div class="absolute -top-5 left-0 right-0 text-[10.5px] font-medium overflow-hidden whitespace-nowrap px-0.5 pointer-events-none w-full select-none" style="color: var(--sdf-text-secondary);">
                {#if file.name.length > 22}
                  <div class="speeddf-marquee-track inline-flex whitespace-nowrap will-change-transform">
                    <span class="speeddf-marquee-content pr-8">{file.name}</span>
                    <span class="speeddf-marquee-content pr-8">{file.name}</span>
                  </div>
                {:else}
                  <span class="truncate block w-full text-left">{file.name}</span>
                {/if}
              </div>

              <div class="w-full h-full flex items-center justify-center relative overflow-hidden transition-all duration-200 {!exists ? 'opacity-25 grayscale brightness-75' : ''}" style="background: var(--sdf-bg-app);">
                {#if file.thumbnail}
                  <img src={file.thumbnail} alt={file.name} class="w-full h-full object-cover rounded-none" />
                {/if}
                <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-30"></div>
              </div>

              <div class="bottom-dock-tray absolute bottom-0 left-0 right-0 h-10 border-t flex items-center justify-around px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-out z-40" style="background: color-mix(in srgb, var(--sdf-bg-chrome) 95%, transparent); border-color: var(--sdf-border);">
                {#if exists}
                  <button
                    onclick={(e) => { e.stopPropagation(); handleCompress(doc); }}
                    class="p-1.5 text-cyan-400 hover:text-white hover:bg-cyan-500/20 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-cyan"
                    title="Compress PDF"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>
                  </button>
                {/if}

                <button
                  onclick={(e) => { e.stopPropagation(); handleClearFromRecents(doc.id); }}
                  class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-slate"
                  title="Remove from Recents"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                {#if exists}
                  <button
                    onclick={(e) => { e.stopPropagation(); handleDeleteFromHDD(doc); }}
                    class="p-1.5 text-red-400 hover:text-white hover:bg-red-500/20 rounded transition-colors flex items-center justify-center bg-transparent border-none cursor-pointer hover-red"
                    title="Delete File From Computer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .group:hover .speeddf-marquee-content {
    color: #22d3ee !important; /* cyan-400 */
    text-shadow: 0 0 8px rgba(34, 211, 238, 0.4) !important;
  }
  .group:hover .speeddf-marquee-track {
    animation: speeddfMarquee 6s linear infinite;
    overflow: visible !important;
    width: max-content !important;
  }
  @keyframes speeddfMarquee {
    0% {
      transform: translateX(0%);
    }
    100% {
      transform: translateX(-50%);
    }
  }

  .recent-card-item {
    /* Intrinsic height from aspect-ratio — not a shared fixed box */
    width: 100%;
    height: auto;
    transform: scale(0.92) translateY(0);
    transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1), border-color 240ms ease, box-shadow 240ms ease;
    position: relative;
    z-index: 10;
  }

  /* Portrait: taller than wide (letter-ish). Landscape: wider than tall. */
  .recent-card-item--portrait {
    aspect-ratio: 3 / 4;
  }
  .recent-card-item--landscape {
    aspect-ratio: 16 / 10;
  }

  .recent-card-item:hover:not(.recent-card-item--disabled) {
    transform: scale(1.05) translateY(-8px) !important;
    z-index: 50 !important;
    border-color: #22d3ee !important; /* cyan-400 structural highlight */
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85), 0 0 20px rgba(34, 211, 238, 0.2) !important;
  }

  .recent-card-item:hover:not(.recent-card-item--disabled) .bottom-dock-tray {
    opacity: 1 !important;
  }

  /* Unavailable: listed + dimmed, still interactive for "remove from recents".
     Never use not-allowed — keep default arrow so the list feels usable. */
  .recent-card-item--disabled {
    cursor: default !important;
  }
  .recent-card-item--disabled:hover {
    transform: scale(0.92) translateY(0) !important;
    border-color: rgb(15 23 42 / 0.4) !important;
    box-shadow: none !important;
  }
  .recent-card-item--disabled:hover .bottom-dock-tray {
    opacity: 1 !important;
  }
</style>
