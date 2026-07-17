# speedDF Developer & Agent Mapping Reference (`AGENT_MAP.md`)

This document serves as a standardized reference guide for understanding the architectural layout, core files, and global state registries within the speedDF repository.

---

## 1. The File Tree Matrix

### Frontend System (SvelteKit / TypeScript)
* **`src/pdfStore.svelte.ts`**: Central document ownership facade. Holds open documents, active document, shapes ownership, bookmarks, signatures, and selection state. Delegates history and tools to dedicated modules.
* **`src/lib/stores/history.svelte.ts`**: Undo/redo stack and `pushHistorySnapshot()` helpers.
* **`src/lib/stores/tools.svelte.ts`**: Active tool, color, thickness, and line style state.
* **`src/lib/annotation/shapeHelpers.ts`**: Pure helper utilities for shape selection patches and related annotation operations.
* **`src/components/WorkspacePage.svelte`**: The core canvas rendering pipeline that handles PDF.js page painting, text layer overlays, SVG annotation tracking, and interactive tool drafting.
* **`src/components/TitleBar.svelte`**: The custom OS-level header component that orchestrates top-level tools, window drag mechanics, file saving dialogs, and delegates the `pdf-lib` PDF/Image flattening export pipeline.
* **`src/components/Workspace.svelte`**: The primary layout container that maps and orchestrates the scrollable sequence of `WorkspacePage` components.
* **`src/components/ToolSidebar.svelte`**: The left-hand navigation panel providing UI buttons to toggle active annotation tools, colors, styles, and document properties.
* **`src/components/PageSidebar.svelte`**: The right-hand navigation panel managing page ordering, thumbnail routing, deletion loops, and outline/bookmark rendering.
* **`src/routes/+page.svelte`**: The application's root entry point linking the sidebars, workspace, and titlebar into a unified Single Page Application view.
* **`src/routes/OcrPanel.svelte`**: The dedicated overlay component for interacting with the local AI OCR extraction processes.

### Backend System (Rust / Tauri)
* **`src-tauri/src/lib.rs`**: The primary backend command registry and application builder, handling filesystem access validations, TIFF multi-page parsing, and native OS integrations.
* **`src-tauri/src/commands.rs`**: The dedicated module housing the high-performance local ONNX OCR processing pipeline (DBNet detection + CRNN recognition) utilizing the `tract-onnx` crate.
* **`src-tauri/src/main.rs`**: The minimal binary entry point initializing the Tauri v2 builder application.

---

## 2. The Global Hook Registry

### Central Workspace Variables (`activeDoc`)
Located in `src/pdfStore.svelte.ts`, the `activeDoc` proxy exposes these primary state keys:
* **`openDocuments`**: An array of `DocumentWorkspace` objects tracking all currently loaded files.
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