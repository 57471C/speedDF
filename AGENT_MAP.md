# speedDF Developer & Agent Mapping Reference (`AGENT_MAP.md`)

This document serves as a standardized reference guide for understanding the architectural layout, core files, and global state registries within the speedDF repository.

---

## 1. The File Tree Matrix

### Frontend System (SvelteKit / TypeScript)
* **`src/pdfStore.svelte.ts`**: Central document ownership facade. Holds open documents, active document, shapes ownership, bookmarks, form field state, signatures, and selection state. Delegates history and tools to dedicated modules. Owns stable **`workspaceId`** tab identity and persisted text-tool defaults.
* **`src/lib/stores/history.svelte.ts`**: Undo/redo stack and `pushHistorySnapshot()` helpers.
* **`src/lib/stores/tools.svelte.ts`**: Active tool, color, thickness, and line style state.
* **`src/lib/annotation/shapeHelpers.ts`**: Pure helper utilities for shape selection patches and related annotation operations.
* **`src/lib/annotation/toolShapes.ts`**: Pure factories for tool-created shapes (box, freehand, text, stamps).
* **`src/lib/annotation/ghostDimensions.ts`**: Stamp ghost size defaults + localStorage cache for resized stamps.
* **`src/lib/annotation/strokeStyles.ts`**: Shared SVG stroke-dasharray presets.
* **`src/lib/forms/formFields.ts`**: AcroForm (non-XFA) field extraction, value application, signature stamp bake, and flatten helpers via pdf-lib.
* **`src/lib/export/flatten.ts`**: Workspace flatten/export pipeline (PDF + image compilation, annotation draw, form bake, post-save thumbnail generation). Called from `TitleBar.svelte`; UI chrome stays in TitleBar.
* **`src/lib/comments/comments.ts`**: Threaded page comments, author profile, and Keywords embed/decode for save.
* **`src/lib/interaction/dragHandler.svelte.ts`**: Page drag, multi-select, resize, and pointer event session for `WorkspacePage`.
* **`src/lib/interaction/coordinates.ts`**: Percentage coordinate transforms (including image rotation).
* **`src/lib/render/pageRenderer.ts`**: PDF.js / image / TIFF canvas paint + text-layer pipeline.
* **`src/components/WorkspacePage.svelte`**: Page shell — layout, observers, bookmarks; delegates paint, interaction, annotation overlay, and form overlay.
* **`src/components/AnnotationLayer.svelte`**: SVG/DOM annotation overlay (shapes, handles, ghosts, live drawing previews). Freehand signature/initial stamps live here (not AcroForm Sig fields).
* **`src/components/FormLayer.svelte`**: AcroForm overlay (text / checkbox / dropdown / signature widgets). Signature widgets open a stamp picker reusing `savedSignatureSets` (no new drawing on form fields).
* **`src/components/DocumentTabs.svelte`**: Multi-document tab strip; tab ids use `documentKey()` (`workspaceId`).
* **`src/components/TitleBar.svelte`**: Custom OS-level header: window chrome, file open/save dialogs, orchestrates save via `lib/export/flatten` + `commitActiveDocumentAfterSave`.
* **`src/components/Workspace.svelte`**: Primary layout container mapping scrollable `WorkspacePage`s; hosts text floating toolbar and “Document loaded in Xms” burn-in.
* **`src/components/ToolSidebar.svelte`**: Left-hand tools: select, stamps (create/edit signature sets), shapes, colors, styles.
* **`src/components/PageSidebar.svelte`**: Right-hand panel: page order, thumbnails, outline/bookmarks, comments tab.
* **`src/routes/+page.svelte`**: App root wiring sidebars, workspace, titlebar. Listens for **`startup-file-loaded`** (cold start) and **`open-file-request`** (second-instance / single-instance handoff).
* **`src/routes/OcrPanel.svelte`**: Overlay for local AI OCR extraction.

### Backend System (Rust / Tauri)
* **`src-tauri/src/lib.rs`**: Backend command registry and application builder. Filesystem validation, TIFF multi-page parse, native dialogs, **startup file detection** (`std::env::args` → emit `startup-file-loaded`), and **`tauri-plugin-single-instance`** (focus existing window + emit `open-file-request` with file bytes).
* **`src-tauri/src/commands.rs`**: Local ONNX OCR pipeline (DBNet + CRNN) via `tract-onnx`.
* **`src-tauri/src/main.rs`**: Minimal binary entry point for the Tauri v2 app.

---

## 2. The Global Hook Registry

### Central Workspace Variables (`activeDoc`)
Located in `src/pdfStore.svelte.ts`, the `activeDoc` proxy exposes these primary state keys:
* **`openDocuments`**: Array of `DocumentWorkspace` objects for all loaded tabs (PDF, TIFF, image).
* **`activeDocumentId`**: Stable tab identifier — **`workspaceId`** (not path). Path/name may change on Save As without remounting the workspace.
* **`DocumentWorkspace.workspaceId`**: UUID assigned at tab creation; used by `documentKey()` for tabs, close, and switch.
* **`currentPage`**: Active page number in view.
* **`pageOrder`**: Page numbers defining structural order / deletions.
* **`shapes`**: `Record<number, AnnotationShape[]>` — free annotation stamps, text, highlighters, etc.
* **`formFields`**: `FormFieldDef[]` — AcroForm widget geometry for overlay (empty when no form).
* **`formValues`**: `Record<string, FormFieldValue>` — field values by fully-qualified name; signature fields store stamp data URLs (or `""`).
* **`bookmarks`**: `{ pageNum, name }[]` outline flags.
* **`comments`**: Per-document threaded page comments.
* **`isDirty`**: Unsaved workspace modifications.
* **`isSaving`**: Session lock while flatten/write runs (blocks edits).
* **`thumbnailVersion`**: Counter forcing thumbnail / sidebar repaints after save.
* **`pageThumbnailOverrides`**: Per-document `Record<number, string>` base64 snapshots after save.

### Active Tool Modifiers (`activeDoc`)
* **`activeTool`**: e.g. `"select"`, `"text"`, `"rect"`, `"signature"`, `"highlight"`.
* **`activeColor`**, **`activeThickness`**, **`activeLineStyle`**: Stroke/fill modifiers.
* **`activeFontFamily`**, **`defaultFont`**, **`defaultSize`**, **`defaultStyle`**, **`activeTextAlignment`**: Text-tool defaults. **Persisted** in `localStorage` key `speeddf_text_settings` so they survive restarts and do not need reselect every session.
* **`selectedShape`** / **`selectedShapes`**: Selection for multi-select move / property override.
* **`savedSignatureSets`** / **`activeStampDataUrl`**: Signature stamp library (shared across tabs) and currently armed free-stamp image.

### Central Lifecycle Functions
* **`pushHistorySnapshot()`** (`pdfStore` / history module): Deep-clones shapes + layout onto `undoStack`. Call before document mutations.
* **`initializeNewDocument(fileName, filePath)`**: Creates a workspace with a new `workspaceId` and activates it.
* **`documentKey(doc)`**: Returns stable tab id (`workspaceId`, with path/name fallback).
* **`switchActiveDocument(id)`** / **`closeDocumentWorkspace(id)`**: Tab switch/close by id (workspaceId preferred).
* **`commitActiveDocumentAfterSave({ compiledBytes, filePath?, fileName? })`**: Post-save rebind of bytes/path/name, clear dirty, re-extract form fields, **upsert Recent Documents** for the saved path. Does **not** change `workspaceId` / remount the tab.
* **`setFormFieldValueAction(name, value)`**: Updates one AcroForm value (text / checkbox / dropdown / signature data URL) and marks dirty.
* **`extractFormFields(bytes)`** / **`applyAndFlattenFormValues(pdfDoc, values)`** (`lib/forms/formFields.ts`): Detect widgets on open; bake values (including signature stamps drawn into Sig widgets) on save.
* **`flattenWorkspaceToPDF()`** / **`flattenWorkspaceToImage()`** (`lib/export/flatten.ts`): Compile annotations (+ form bake for PDF) to bytes for save/print.
* **`upsertRecentEntry` / `updateRecentThumbnail` / `applyLiveThumbnail`**: Recent Documents + sidebar thumbnail pipeline after save.
* **`parse_tiff_document()`** (`lib.rs`): TIFF → PNG page buffers.
* **`run_local_ocr()`** (`commands.rs`): Local OCR inference.
* **`check_startup_file()`** (`lib.rs`): Fallback only; primary open-with path does not use it.

---

## 3. Multi-Document Identity (Important)

* Each open tab has a stable **`workspaceId`**. That is what `activeDocumentId` and the tab strip use.
* **Save As** updates `filePath` / `fileName` only. The same workspace object stays active — no “Loading document…” flash and no forced remount from path change.
* Prefer `documentKey(doc)` and `findOpenDocument` (workspaceId **or** path **or** name) when closing or switching tabs.
* Do **not** reintroduce path-as-primary-id for active tab selection; that caused Save As focus loss.

---

## 4. AcroForm Forms Entry (Non-XFA)

* **Detect** on PDF load via `extractFormFields` → `formFields` + `formValues` on the active `DocumentWorkspace`.
* **Overlay**: `FormLayer.svelte` on each page (interactive when tool is `select` or `text`).
* **Supported widgets (v1):** text, checkbox, dropdown, **signature** (stamp fill, not digital PKCS).
* **Signature fields:** click → picker of `savedSignatureSets` (signature + initials); value is a data URL; clear with ×. Multi-tab safe (apply ignored if active tab changes mid-pick).
* **Save:** `applyAndFlattenFormValues` sets text/check/dropdown, draws stamp images into Sig widget rects, removes Sig fields safely (pdf-lib cannot build Sig `/AP` streams), then flattens remaining fields. Export path is multi-document safe (uses active doc’s values only).
* **Not supported yet:** radio groups, buttons, option lists, XFA.

---

## 5. Startup File / File Association Path (Important)

### Cold start (app not running)
1. Rust setup reads `std::env::args()`.
2. If a supported file is found, load into `FilePayload`.
3. Emit **`startup-file-loaded`** (short retries until the frontend listener is ready).
4. Frontend (`+page.svelte`) dedupes and calls `loadDocument(...)`.

### Warm open (app already running)
1. OS starts a second process with the file path in argv.
2. **`tauri-plugin-single-instance`** (must be the **first** registered plugin) focuses the existing window and exits the second process.
3. First instance loads the file and emits **`open-file-request`** with a `FilePayload`.
4. Frontend always handles this event (no startup dedupe) → `loadDocument` opens a **new tab** or focuses an existing one with the same path.

**Do not** reintroduce a startup dependency on `invoke('check_startup_file')` for double-click / Open with (CSP/IPC cold-start issues). Keep it as fallback only.

**Supported extensions:** `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.webp`, `.bmp`

---

## 6. Security Notes

* Path-taking commands should go through `secure_verify_path` (or equivalent) to prevent directory traversal / relative paths / null bytes.
* Startup and single-instance file loading only accept existing regular files with supported extensions.
* Prefer shared validation helpers over one-off checks in each command.

---

**Last Updated:** July 2026 (forms entry + signatures, workspaceId / Save As, single-instance, text settings persistence)
