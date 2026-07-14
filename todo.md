# Todo List #

## Features to add ##
1. Add snapshot tool.
2. Add File tabs for multiple documents.
3. pagesToolbar - change "merge" to be a context menu "merge, insert blank page".

## long term goals (may never do)
1. Forms entry (NOT XFA Forms!)
2. Froms creation (NOT XFA Forms!)
3. True Structural Text Reflow:
Instead of writing a full structural reflow engine, intermediate tools use a visual masking mask shortcut:

When the user clicks to edit a text block, the app detects the bounding box area.

It places a solid background banner matching the page background color directly over the old coordinates to "whiteout" the original graphics.

It puts a standard HTML input text area right on top of it, lets the user type whatever they want, and bakes the final text down as a fresh independent annotation overlay layer upon export.

## Fixes
- None


##📝 Short Description
speedDF is an ultra-lightweight, high-performance desktop PDF viewer and editor engineered to eliminate the resource bloat of legacy corporate PDF utilities. Built on a hybrid architecture that pairs a high-performance Rust backend with a modern Svelte 5 frontend, speedDF utilizes native operating system webviews instead of a heavy Chromium engine. This results in near-instant boot times, minimal memory consumption, and a fluid workspace interface. Core features include native document stream decryption, seamless multi-file merging, high-fidelity canvas highlighting, fluid page reordering, and a built-in cryptographic auto-updater channel.

##🚀 The speedDF Tech Stack
```
 ┌─────────────────────────────────────────────────────────┐
 │             FRONTEND: Svelte 5 / Tailwind CSS           │
 │      (PDF.js Canvas Renderer & Isolated Web Workers)    │
 └───────────────────────────┬─────────────────────────────┘
                             │  IPC Bridge (Secure Origin)
 ┌───────────────────────────▼─────────────────────────────┐
 │               BACKEND: Tauri v2 / Rust                  │
 │      (Native File IO, Merge Operations & Decryption)    │
 └─────────────────────────────────────────────────────────┘
 ```
## 1. Core Desktop Runtime & Container
Tauri v2 (Rust Framework): The foundational pillar of the desktop shell. Tauri handles window lifecycles, operating system handshakes, native single-file execution handshakes, and file system isolation rules. By replacing a full Chromium browser wrapper (like Electron) with a secure, compiled Rust core that binds directly to native system Webviews (WebView2 on Windows, WebKit on macOS), speedDF slashes application bundles down to a fraction of normal desktop app sizes.

## 2. Frontend User Interface Layer
Svelte 5: Utilized for building an asynchronous frontend application loop. By using modern Runes ($state, $derived) and local UI configuration snippets, speedDF achieves lightning-fast state synchronization across the sidebar, tool controls, and active view layers with zero runtime overhead.

Tailwind CSS: Powers the sleek, ultra-responsive dark-mode utility design system, isolating tool trays, control banners, canvas gutters, and overlay menus into a unified workspace.

SortableJS: Embedded directly inside the workspace layout panel to drive native drag-and-drop page serialization and order arrays.

3. PDF Parsing & Vector Manipulation Engines
PDF.js (Mozilla Core): Handles client-side vector grid transformations and pushes multi-page rendering buffers cleanly to HTML5 elements. To bypass Tauri’s isolated local origin context gates (tauri.localhost), the engine loads synchronized web worker files directly from an embedded static bundle cache.

pdf-lib (JavaScript Matrix): Manages structural adjustments, canvas geometry injections, and local document exports.

lopdf (Rust Native Engine): Anchors the backend computational heavy lifting. It processes low-level structural modifications directly inside native threads, enabling rapid multi-file backend stitching loops (PDF merging) and secure document stream decryption routines.

4. Infrastructure, DevOps, & Security
GitHub Actions: Acts as the automated multi-matrix cloud compilation pipeline, generating secure architecture binaries for all targeted operational systems simultaneously on every repository tag push.

Minisign Cryptography: Handles data safety with asymmetric key pairings. Releases are signed in the cloud via a private vault key, which the client verification engine validates locally using a hardened public public-key mechanism.

Cloudflare Pages & Gateway CDN: Functions as the application distribution channel and homepage environment, delivering static deployment landing pages and routing automated software configuration update loops (latest.json) across a global, low-latency edge server network.

```bash
npx kill-port 1420
npm run tauri dev
```

### OCR BENCHMARK RESULTS ###

```text
[BENCH] Original image size: 1190x1683
DEBUG INFO: Original dimensions: 1190x1683, Detector dimensions: 1184x1696
DEBUG INFO: Detection heatmap range -> Min: -0.00000011920929, Max: 1
DEBUG INFO: Total text bounding boxes isolated: 181
[BENCH] Detection time: 45.26s
[BENCH] Detected text boxes: 181
DEBUG CROP: Box target [0] -> x: 20, y: 83, w: 438, h: 21
DEBUG CROP: Box target [1] -> x: 729, y: 86, w: 225, h: 18
DEBUG CROP: Box target [2] -> x: 959, y: 86, w: 24, h: 19

========== OCR BENCHMARK ==========
[BENCH] Total OCR time:       256.42s
[BENCH] Detection time:       45.26s
[BENCH] Recognition time:     211.05s
[BENCH] Number of text boxes: 181
[BENCH] Avg time per box:     1.166ss
===================================
```
