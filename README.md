# speedDF ⚡

A high-performance, hyper-secure, cyber-dark desktop PDF editor and annotation engine. Built using Tauri v2, SvelteKit, TypeScript, and Rust, speedDF provides a fully localized workflow to sign, mark up, audit, and restructure PDF files with zero cloud latency and absolute data privacy.

---

## Key Features

### 1. Client-Side Vector Flattening Engine (pdf-lib)
Unlike standard web editors that merely slide floating HTML elements over a canvas view, speedDF features a built-in client compilation compiler. When exporting via Save As.., your text modifications, bounding rectangles, audit stamps, digital signatures, and freehand highlights are mathematically translated and baked permanently into the document's native binary vector tree. The pipeline automatically calculates coordinate transformations, flipping your front-end actions from top-left web space to the true bottom-left point origins required by the PDF specification.

### 2. Digital Ink Signature & Initial Profiles
* Dual-Canvas Drafting Wizard: Sketch custom signature and initial sets directly inside the tool window. Canvas paths utilize a high-fidelity, segment-by-segment interpolation matrix to perfectly track your pointer tip regardless of display size or layout scale.
* Persistent Disk Memory: Committed sign-offs are packed into Base64 PNG data URLs and securely mirrored into local disk storage memory, keeping your configurations safely cached across system reboots.
* Sleek Template Management: Activate stamps on click or clear them cleanly. Features an inline, custom Tailwind confirmation overlay allowing you to drop obsolete profiles out of memory permanently.

### 3. Transparent Ghost Previews & Alignment HUD
When selecting a signature or initial profile to drop onto a sheet, a 45% semi-transparent ghost replica of that specific stroke path instantly binds directly to your cursor crosshairs. This removes all positioning guesswork, letting you align signatures exactly to visual rule blocks before clicking to print a solid commit onto the canvas layer.

### 4. Smart Sizing Memory Caches (localStorage)
When dragging vector corner handles to resize structural stamps like Ticks (✓) or Dashes (—), their percentage dimensions are instantly captured to local disk memory. The tool automatically remembers your exact sizing choices, allowing you to establish the exact layout proportions for a form blueprint once, and stamp duplicate rows endlessly without resizing each time.

### 5. Resolution-Independent Freehand Highlighter
Draw a fluid, translucent yellow wash over any data text rows. Highlighter strokes are tracked as an array of raw mathematical percentage nodes ([{x, y}]) rather than heavy raster assets. They are rendered live via an isolated front-end SVG overlay utilizing viewBox="0 0 100 100" and preserveAspectRatio="none", ensuring your markups stay crisp, vector-sharp, and un-blurred even when scaling document views.

### 6. Keyed Page Excision & Route Mapping
Page restructuring utilizes strict immutable list reconciliation tracking loops ((pageNumber) keys) to handle structural operations. When you drop a page via the right sidebar trashcan icon, its specific index path is instantly filtered out of the global state tracking array. Svelte completely target-destroys the explicit DOM element, cleanly erasing it from the thumbnail track, the main scroll container view, and completely skipping its byte segments during final export packaging.

### 7. Native OS Shell Integration
* Draggable Window Header: Sleek custom border frame layout allowing smooth app window movements across the OS environment.
* Centered Filename Tracking: Passes packed payload structures across the asynchronous Tauri bridge on file loads to display your true physical filename string centered in the titlebar.
* Unified Scroll Bar Aesthetics: Standard browser scroll bars are globally overridden with a dark slate matching color path to match the high-contrast editor interface style.
* Zoom HUD Controls: Smooth viewport canvas adjustments ranging from 50% to 200% alongside target-view focus snapping.

---

## Architecture Blueprint

The editor splits system duties cleanly between low-level system memory commands and real-time reactive layout rendering updates:

[Backend Interface (lib.rs)] <---IPC (Invoke)---> [Frontend SvelteKit & PDF Pipeline]

* rfd: Asynchronous OS File Picker Dialog Windows
* serde: Serialization Data Payload Mapping Bridges
* pdf.js: Renders high-res localized canvases for display layout
* pdf-lib: Calculates geometric point transformations & bakes bytes
* $state: Svelte 5 Runes managing reactive tools and pageOrder routes

---

## Installation & Build Guide

### Prerequisites
Ensure your local system toolchains are updated and properly installed:
1. Node.js (v18+ recommended)
2. Rust Compiler & Cargo Toolchain (via rustup)
3. C++ Build Tools for Windows (via Visual Studio workloads)

### Dependency Installation
Clone your development branch workspace repository, change into the root folder directory path, and fetch your package allocations:
npm install

### Run Hot-Reload Dev Server
Launch your desktop interface container cycle live with hot-swapping module assets active:
npm run tauri dev

### Compiling Production Standalone Executables
To pack your completely optimized, self-contained desktop system binary executable package (speeddf.exe), run the build script:
npm run build:exe

The packed asset drops straight inside your project generation release target subdirectory:
src-tauri\target\release\speeddf.exe

---

## Unlocking Debugging DevTools inside Production

Because tracking component behaviors inside compiled shells is blind work, you can force Tauri to unlock Chrome DevTools inspect tools directly inside your standalone production releases.

1. Open src-tauri/Cargo.toml
2. Locate your tauri package dependency reference block under [dependencies]
3. Simply append the "devtools" flag directly into its active features array:
tauri = { version = "2.0.0", features = [ "codec", "image", "devtools" ] }

4. Recompile your build (npm run build:exe). You can now press F12 or right-click anywhere on the running app workspace to bring up the Web Console inspect screens live!

Alternatively, you can compile an unlocked diagnostic executable without editing text configuration sheets:
npx tauri build --debug

---

## Keyboard Shortcut Matrix

* Delete / Backspace : Drops selected items (Select Mode)
* Ctrl + Right Arrow : Shifts active page orientation 90° Clockwise
* Ctrl + Left Arrow  : Shifts active page orientation 90° Counter-Clockwise
* F12                : Toggles Chrome DevTools Window (Unlocked Only)

---

## Development Roadmap
- [x] Persistent custom tool sizing caches.
- [x] Smooth freehand highlighting with translucent matrix bakes.
- [x] Clean Tailwind-styled delete prompt overlays.
- [x] Center-aligned native filename header regions.
- [ ] Implement multi-file backend stitching loops via + indicator commands (PDF Merge).
- [ ] Implement text annotation font-family variance sizing options.

---

## License
This project is open-source software and licensed under the terms of the MIT License.