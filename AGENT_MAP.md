# speedDF Developer & Agent Mapping Reference (`AGENT_MAP.md`)

This document serves as a standardized reference guide for understanding the architectural layout, core files, and global state registries within the speedDF repository.

---

## 1. The File Tree Matrix

### Frontend System (SvelteKit / TypeScript)
* **`src/pdfStore.svelte.ts`**: Central document ownership facade. Holds open documents, active document, shapes ownership, bookmarks, signatures, and selection state. Delegates history and tools to dedicated modules.
* **`src/lib/stores/history.svelte.ts`**: Undo/redo stack and `pushHistorySnapshot()` helpers.
* **`src/lib/stores/tools.svelte.ts`**: Active tool, color, thickness, and line style state.
* **`src/lib/annotation/shapeHelpers.ts`**: Pure helper utilities for shape selection patches and related annotation operations.
* **`src/lib/annotation/toolShapes.ts`**: Pure factories for tool-created shapes (box, freehand, text, stamps).
* **`src/lib/annotation/ghostDimensions.ts`**: Stamp ghost size defaults + localStorage cache for resized stamps.
* **`src/lib/annotation/strokeStyles.ts`**: Shared SVG stroke-dasharray presets.
* **`src/lib/interaction/dragHandler.svelte.ts`**: Page drag, multi-select, resize, and pointer event session for `WorkspacePage`.
* **`src/lib/interaction/coordinates.ts`**: Percentage coordinate transforms (including image rotation).
* **`src/lib/render/pageRenderer.ts`**: PDF.js / image / TIFF canvas paint + text-layer pipeline.
* **`src/components/WorkspacePage.svelte`**: Page shell — layout, observers, bookmarks; delegates paint, interaction, and annotation overlay.
* **`src/components/AnnotationLayer.svelte`**: SVG/DOM annotation overlay (shapes, handles, ghosts, live drawing previews).
* **`src/components/TitleBar.svelte`**: The custom OS-level header component that orchestrates top-level tools, window drag mechanics, file saving dialogs, and delegates the `pdf-lib` PDF/Image flattening export pipeline.
* **`src/components/Workspace.svelte`**: The primary layout container that maps and orchestrates the scrollable sequence of `WorkspacePage` components.
* **`src/components/ToolSidebar.svelte`**: The left-hand navigation panel providing UI buttons to toggle active annotation tools, colors, styles, and document properties.
* **`src/components/PageSidebar.svelte`**: The right-hand navigation panel managing page ordering, thumbnail routing, deletion loops, and outline/bookmark rendering.
* **`src/routes/+page.svelte`**: The application's root entry point linking the sidebars, workspace, and titlebar into a unified Single Page Application view. Also listens for the `startup-file-loaded` event.
* **`src/routes/OcrPanel.svelte`**: The dedicated overlay component for interacting with the local AI OCR extraction processes.

### Backend System (Rust / Tauri)
* **`src-tauri/src/lib.rs`**: The primary backend command registry and application builder. Handles filesystem access validations, TIFF multi-page parsing, native OS integrations, and **startup file detection** (reads `std::env::args()`, loads supported files, emits `startup-file-loaded`).
* **`src-tauri/src/commands.rs`**: The dedicated module housing the high-performance local ONNX OCR processing pipeline (DBNet detection + CRNN recognition) utilizing the `tract-onnx` crate.
* **`src-tauri/src/main.rs`**: The minimal binary entry point initializing the Tauri v2 builder application.

---

## 2. The Global Hook Registry

### Central Workspace Variables (`activeDoc`)
Located in `src/pdfStore.svelte.ts`, the `activeDoc` proxy exposes these primary state keys:
* **`openDocuments`**: An array of `DocumentWorkspace` objects tracking all currently loaded files (PDF and image types).
* **`activeDocumentId`**: The string identifier (file path or name) of the currently viewed document.
* **`currentPage`**: The active page number actively in view.
* **`pageOrder`**: An array of page numbers defining the logical structural flow and exclusions (for page deletion).
* **`shapes`**: A `Record<number, AnnotationShape[]>` mapped by page number, storing all drafted vector stamps, texts, and highlighters.
* **`bookmarks`**: An array of `{ pageNum, name }` tracking user-defined outline flags.
* **`isDirty`**: Boolean flag tracking whether unsaved workspace modifications exist.
* **`thumbnailVersion`**: Integer counter tracking thumbnail generation passes to trigger Svelte template/action repaints.
* **`pageThumbnailOverrides`**: A `Record<number, string>` mapping page index numbers to fresh base64 snapshot strings on save, bypassing pdf.js rendering lag.

### Active Tool Modifiers (`activeDoc`)
* **`activeTool`**: String literal tracking the currently selected tool (e.g., `"select"`, `"text"`, `"rect"`, `"signature"`, `"highlight"`).
* **`activeColor`**: Hexadecimal string defining the current stroke or fill color.
* **`activeThickness`**: Integer defining the stroke line width.
* **`activeLineStyle`**: String literal defining stroke style patterns (`"solid"`, `"dashed"`, `"dotted"`, `"dash-dot"`).
* **`selectedShape`** / **`selectedShapes`**: References to the actively selected layout nodes for multi-select moving or property overriding.

### Central Lifecycle Functions
* **`pushHistorySnapshot()`** (`pdfStore.svelte.ts`): Commits a deep clone of the current shapes and page layout to the `undoStack` array. MUST be called prior to document mutations.
* **`initializeNewDocument(fileName, filePath)`** (`pdfStore.svelte.ts`): Instantiates and registers a clean document workspace profile.
* **`flattenWorkspaceToPDF()`** (`TitleBar.svelte`): Iterates over the `activeDoc` shape states, compiles them mathematically into native PDF dictionaries using `pdf-lib`, and outputs the raw binary stream.
* **`flattenWorkspaceToImage()`** (`TitleBar.svelte`): Iterates over the `activeDoc` shape states, drawing them onto a standard HTML Canvas to export `.jpg` or `.png` binary buffers.
* **`parse_tiff_document()`** (`lib.rs`): A Tauri background task that reads a raw TIFF binary stream and unpacks its layered images into an array of optimized PNG Web Buffers.
* **`run_local_ocr()`** (`commands.rs`): A heavy background inference task that executes DBNet boundary detection and CRNN character recognition over an image using local `tract-onnx` models.
* **`check_startup_file()`** (`lib.rs`): Fallback command that reads CLI args and returns a `FilePayload`. Primary startup path no longer depends on this.

---

## 3. Startup File / File Association Path (Important)

**Primary path (v1.0.1+):**
1. On app setup, Rust reads `std::env::args()`.
2. If a supported file is found (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.webp`, `.bmp`), it is loaded into a `FilePayload`.
3. Rust emits the Tauri event **`startup-file-loaded`** with that payload (with short retries so the frontend listener is ready).
4. Frontend (`+page.svelte`) listens for `startup-file-loaded` and calls the same `loadDocument(...)` path used elsewhere.

**Do not** reintroduce a startup dependency on `invoke('check_startup_file')` for double-click / Open with. That path was blocked by CSP and is only kept as a fallback.

**Supported extensions:** `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.webp`, `.bmp`

---

## 4. Security Notes

* Path-taking commands should go through consistent validation (e.g. `secure_verify_path` or equivalent) to prevent directory traversal.
* Startup file loading only accepts existing regular files with supported extensions.
* Prefer shared validation helpers over one-off checks in each command.

---

**Last Updated:** July 2026 (post v1.0.2)