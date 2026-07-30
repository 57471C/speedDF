# Todo List #

## Features to add ##
1. ~~Images only: resize by %, H:V px apect ratio locked (like power toys)~~
2. ~~Obeject alignment~~
3. ~~Light mode~~
4. ~~R/click tab - "Open in new window"~~ 
5. Forms creation (NOT XFA Forms!) + hyperlinks
6. ~~Tools: scratch pad/clip board (persistant across all docs)~~

## long term goals (may never do)
1. lopdf + docx-rs export to Word, lopdf + rust_xlsxwriter for Excel
2. tauri-plugin-tts for Text to Speach
3. True Structural Text Reflow:
Instead of writing a full structural reflow engine, intermediate tools use a visual masking mask shortcut:

When the user clicks to edit a text block, the app detects the bounding box area.

It places a solid background banner matching the page background color directly over the old coordinates to "whiteout" the original graphics.

It puts a standard HTML input text area right on top of it, lets the user type whatever they want, and bakes the final text down as a fresh independent annotation overlay layer upon export.
4. Switch to Bun - could be a big win for speed and bundle size.

## Fixes ##
- [x] Text annotations center top toolbar Sits too high. When an Image is open the image resize bar is also too high (text annotation toolbar should sit under it when activated) 
- [x] moving pages should move the bookmarks and comments with the page.
- [x] feat: Esc key unselects any selected object and always reverts to the select tool
- [x] clicking anywhere on the page (unles ctrl is currently pressed down) should unslect any objects.
- [x] snapshot tool greyout area does not zoom at the same rate as the display window (needs correction).
- [x] On the main page before any document is loaded: remove the green pulsing dot in the left top corner (it's not needed). landscape pages are bunched up they should be allowed more padding.

---
- Can't OCR images (only PDF's work)
- Old install files clean-up
- Sometimes undo does the last two things (possible grouping or multi select - needs investigation).

## 📝 Short Description
speedDF is an ultra-lightweight, high-performance desktop PDF viewer and editor engineered to eliminate the resource bloat of legacy corporate PDF utilities. Built on a hybrid architecture that pairs a high-performance Rust backend with a modern Svelte 5 frontend, speedDF utilizes native operating system webviews instead of a heavy Chromium engine. This results in near-instant boot times, minimal memory consumption, and a fluid workspace interface. Core features include native document stream decryption, seamless multi-file merging, high-fidelity canvas highlighting, fluid page reordering, and a built-in cryptographic auto-updater channel.

## 🚀 The speedDF Tech Stack
```plaintext
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

## 3. PDF Parsing & Vector Manipulation Engines
PDF.js (Mozilla Core): Handles client-side vector grid transformations and pushes multi-page rendering buffers cleanly to HTML5 elements. To bypass Tauri's isolated local origin context gates (tauri.localhost), the engine loads synchronized web worker files directly from an embedded static bundle cache.

pdf-lib (JavaScript Matrix): Manages structural adjustments, canvas geometry injections, and local document exports.

lopdf (Rust Native Engine): Anchors the backend computational heavy lifting. It processes low-level structural modifications directly inside native threads, enabling rapid multi-file backend stitching loops (PDF merging) and secure document stream decryption routines.

## 4. Infrastructure, DevOps, & Security
GitHub Actions: Acts as the automated multi-matrix cloud compilation pipeline, generating secure architecture binaries for all targeted operational systems simultaneously on every repository tag push.

Minisign Cryptography: Handles data safety with asymmetric key pairings. Releases are signed in the cloud via a private vault key, which the client verification engine validates locally using a hardened public public-key mechanism.

Cloudflare Pages & Gateway CDN: Functions as the application distribution channel and homepage environment, delivering static deployment landing pages and routing automated software configuration update loops (latest.json) across a global, low-latency edge server network.


---
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
## key commands ##
- Build with HEIC enabled (waiting on OSS ket for MIT license)
```bash
# Default build (no HEIC support — MIT-clean):
cargo build
# With HEIC support enabled:
cargo build --features heic
# Or in tauri dev mode:
cargo tauri dev -- --features heic
```
```bash
npx kill-port 1420
npm run tauri dev
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
git tag -a v1.1.0 -m "Release v1.1.0"

# 3. Push your active branch code to GitHub
git push origin main

# 4. Push the v1.0.6 tag to trigger the GitHub release action
git push origin v1.1.0
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
---
## Package updating prompt ##

# Chore: Dependency health check & safe updates

## Goal
Review and safely update npm and Cargo dependencies without breaking the app.

## Steps
1. Report current outdated packages:
   - Frontend: `npm outdated`
   - Rust: `cargo outdated` (or `cargo update --dry-run` if the tool isn’t installed)

2. Apply only safe updates:
   - Patch and minor version bumps that look low-risk
   - Do **not** jump major versions of Tauri, Svelte, pdfjs-dist, or pdf-lib without explicit approval

3. After updates:
   - Run `npm install`
   - Run `npm run check`
   - Run `cargo check` (and `cargo check --features heic` if the feature exists)
   - Confirm no new TypeScript or Rust errors

4. Summarise what was updated and what was deliberately left alone (and why).

## Constraints
- Work on the current branch only
- Do not change application logic
- Keep the build MIT-clean (do not force the heic feature on)
- `npm run check` and `cargo check` must stay clean

## Success criteria
- Outdated report is clear
- Safe updates applied
- App still builds and type-checks
- Clear summary of changes for the PR description