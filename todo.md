# Todo List #

## Features to add ##
3. Obeject alignment
4. R/click tab - "Open in new window" 
4. Forms creation (NOT XFA Forms!) + huperlinks
5. comments should have XY co-ords. not stuck at the top of the page.

## long term goals (may never do)
2. tauri-plugin-tts for Text to Speach
3. True Structural Text Reflow:
Instead of writing a full structural reflow engine, intermediate tools use a visual masking mask shortcut:

When the user clicks to edit a text block, the app detects the bounding box area.

It places a solid background banner matching the page background color directly over the old coordinates to "whiteout" the original graphics.

It puts a standard HTML input text area right on top of it, lets the user type whatever they want, and bakes the final text down as a fresh independent annotation overlay layer upon export.
4. Switch to Bun - could be a big win for speed and bundle size.

## Fixes
- [ ] Disable F5 refresh!
- [ ] remove "Shift" key for grouping
---
- [ ] Percentage Coordinate Calculations: Scaling custom annotation coordinates using percentages handles responsive layout redraws smoothly. However, as heavy vector layers grow or high-density custom paths are drawn, processing structural text layouts might hit rendering delays on weaker hardware profiles.
- [ ] Form Field Layout Boundaries: Limiting initial widget operations strictly to text inputs, checkboxes, and dropdown strings provides a highly optimized experience. However, you'll need to keep a close eye on incoming documents containing radio group blocks or complex XFA templates, which remain out of scope for now.


---
- Can't OCR images (only PDF's work)
- Old install files clean-up
- Sometimes undo does the last two things (possible grouping or multi select - needs investigation).


## v1.0.0 Stabilization Pass — Completed Items

### Security Hardening ✅ 100% Complete
- [x] Path traversal security hardening (`secure_verify_path` in lib.rs)
- [x] `native_overwrite_file` path validation (was unguarded — critical write path)
- [x] `read_file_binary` migrated to `Result`-returning validator
- [x] `read_file_bytes` migrated to `Result`-returning validator
- [x] `parse_tiff_document` path validation gate

### Typography Expansion ✅ 100% Complete
- [x] Inter font family integration (TrueType embedding + CSS mapping)
- [x] JetBrains Mono font family integration (TrueType embedding + CSS mapping)
- [x] FONT_MAP registry expansion with pdf-lib compilation mappings
- [x] Font cache system in TitleBar.svelte for embedded font flattening

### Input Sanitization ✅ 100% Complete
- [x] Text annotation sanitization before pdf-lib drawText (null fallback, 5000 char cap, control char strip)

### Telemetry Timer Relocation ✅ 100% Complete
- [x] `performance.now()` captured at click boundary in `openRecentFile`
- [x] Timestamp threaded through `promptAndLoadFile` → `loadDocument`
- [x] Telemetry channel labels (`Recent_Dashboard_Warm` vs `Standard_Load`)

### Reactivity & Lifecycle Hygiene ✅ 100% Complete
- [x] `untrack()` wrapping on toolbar sync effect cache write-backs
- [x] `untrack()` wrapping on `isClickScrolling` feedback loop
- [x] Event listener audit — all global listeners verified with proper teardowns

### Recent Document Layout Caching ✅ 100% Complete
- [x] `cacheDocumentLayoutMetadata` stores per-page dimensions to localStorage
- [x] Skeleton hydration in `openRecentFile` pre-seeds page containers from cache
- [x] WorkspacePage reads `cachedDimensions` for instant container sizing


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
PDF.js (Mozilla Core): Handles client-side vector grid transformations and pushes multi-page rendering buffers cleanly to HTML5 elements. To bypass Tauri's isolated local origin context gates (tauri.localhost), the engine loads synchronized web worker files directly from an embedded static bundle cache.

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
---
## common git commands ##

- Commit the Missed Version Numbers
```bash
git add .
git commit -m "chore: bump version numbers to 1.0.5"
# git push
```

- Overwrite the Local Tag
```bash
# 1. Push your updated code branch containing the version changes
git push origin main

# 2. Delete the incorrect tag from GitHub (ignore errors if you never pushed it)
git push origin --delete v1.0.5

# 3. Push your new, correct tag to GitHub
git push origin v1.0.5
```
