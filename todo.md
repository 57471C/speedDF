# Todo List #

## Features to add ##
3. Obeject alignment
4. R/click tab - "Open in new window" 
4. Forms creation (NOT XFA Forms!) + hyperlinks

## long term goals (may never do)
1. lopdf + docx-rs export to Word, lopdf + rust_xlsxwriter for Excel
2. tauri-plugin-tts for Text to Speach
3. True Structural Text Reflow:
Instead of writing a full structural reflow engine, intermediate tools use a visual masking mask shortcut:

When the user clicks to edit a text block, the app detects the bounding box area.

It places a solid background banner matching the page background color directly over the old coordinates to "whiteout" the original graphics.

It puts a standard HTML input text area right on top of it, lets the user type whatever they want, and bakes the final text down as a fresh independent annotation overlay layer upon export.
4. Switch to Bun - could be a big win for speed and bundle size.

## Fixes
- [x] aFter dropping a text annotation. if you select another tool (other than select tool or colour modifier) it should unselect the text that was dropped.
- [x] If you change the fontsize of a text annotation it should resize the teatarea's bounding box size to
- [x] hover over comment icon the the top right wrokspace comments icon correctly pops out the form for easy adding a comment. But there is "alt text" that pops over the input (clash). Bookmarks icon should popout in the same way and also have the altext removed. 
- [x] when Ctrl+scrolling to zoom, it should zoom to the pointer/co-ords
- [x] 2 click shape. when adding a shap 1 x click drops a shape with a size based on document zoom. change this to 1 c click ancors the top left corner (rubberbands). 2nd click finalises the size of the shape. BUT STILL ALLOW CLICK DRAG as the primary way to draw shapes.
- [x] smoother zoom resizing - is it possible?
- [x] dropping a text annotation is lower than it should be. it seems like the top/r of the text input drops at the center of the cursour. It should be the top.
- [x] Disable F5 refresh!
- [x] remove "Shift" key for grouping
- [x] Save/Save As annotation duplication (clear baked overlays after flatten)
---
- [ ] Percentage Coordinate Calculations: Scaling custom annotation coordinates using percentages handles responsive layout redraws smoothly. However, as heavy vector layers grow or high-density custom paths are drawn, processing structural text layouts might hit rendering delays on weaker hardware profiles.
- [ ] Form Field Layout Boundaries: Limiting initial widget operations strictly to text inputs, checkboxes, and dropdown strings provides a highly optimized experience. However, you'll need to keep a close eye on incoming documents containing radio group blocks or complex XFA templates, which remain out of scope for now.


---
- Can't OCR images (only PDF's work)
- Old install files clean-up
- Sometimes undo does the last two things (possible grouping or multi select - needs investigation).

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
- Open new branch
```bash
git checkout main
git pull origin main

git checkout -b feat/common-widgets
git push -u origin feat/common-widgets
```

- Close the branch via PR
```bash
git add -A
git commit -m "fix: always-on-top tools widgets and polish, then fixed text/shape/zoom, value-memory popover tracking, bookmark/comment
chrome, Ctrl+zoom-only multipage scroll, and moved the load-time badge under the pages"
git push
```
- New tag
```bash
# 1. Stage and commit all your changes and version bumps
git add .
git commit -m "chore: release v1.0.6"

# 2. Create the annotated tag locally
git tag -a v1.0.8 -m "Release v1.0.8"

# 3. Push your active branch code to GitHub
git push origin main

# 4. Push the v1.0.6 tag to trigger the GitHub release action
git push origin v1.0.8
```


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
