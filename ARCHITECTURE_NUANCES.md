# Architecture Nuances Ledger

This document serves as the permanent engineering log for hidden project quirks and critical workarounds in the speedDF project.

---

## Section A0: Shared PDF Document (Memory Leak Guard)

### The Problem

On large PDFs (~25MB+), memory climbed continuously with **no user interaction**. Root cause: every main-page paint and many thumbnail/dimension paths called `pdfjsLib.getDocument({ data: bytes.slice(0) })` and never destroyed the resulting `PDFDocumentProxy`. Viewport preload + sidebar thumbs meant many full-document parses stacked in the worker heap.

### The Solution

- **`src/lib/render/sharedPdfDocument.ts`**: one shared document per `rawBytes` identity for the active workspace.
- Main paints (`pageRenderer`), page dimension preload (`WorkspacePage`), and thumbnails (`PageSidebar` / `ThumbnailCanvas`) all use `getSharedWorkspacePdf`.
- After each page paint: `page.cleanup()`; off-screen pages zero canvas bitmaps via `releaseWhenUnrendered`.
- Idle: every 30s call `doc.cleanup(true)` only when the render queue is idle (`isPdfRenderBusy()`).
- On tab switch / close of active doc: `destroySharedWorkspacePdf()` (loadingTask.destroy + cleanup).
- On **last tab close** (`cleanupWorkspace`): also `PDFWorker.destroy()` so Wasm heaps do not stack across open/close cycles; next open creates a fresh worker.
- `purgeDocumentResources(doc)` nulls `rawBytes`, shapes, thumbnail overrides, TIFF pages, forms, etc. **before** dropping the tab so GC can reclaim.

**Do not** reintroduce per-paint `getDocument` on workspace bytes.

### Static sidebar thumbnails

- Generate each page thumb **once** via `ensurePageThumbnail` → JPEG in `pageThumbnailOverrides[pageIndex]`.
- Sidebar/grid render `<img src={override}>` — no canvas/pdf.js on zoom, scroll, tab focus, or grid toggle.
- Re-generate only on **page rotate** (`invalidatePageThumbnail`) or **save** (`applyLiveThumbnail` / `syncLiveThumbnail` for annotated page 0).
- Lazy: placeholder mounts `requestStaticThumb` only while cache miss.
- **Main-first open:** low-priority paints blocked until `markMainViewReady()` (first main canvas paint) or 2.5s fallback (`mainViewGate.ts` + `setLowPriorityAllowed`).
- **Persistent cache:** IndexedDB `speeddf_page_thumbs_v1` keyed by path + content fingerprint (`thumbnailPersist.ts`). Hydrated on open before `pageOrder` mounts.

### Fast PDF open

- Single shared `getSharedWorkspacePdf` parse (no second load-time `getDocument`).
- Unblock UI after bytes + pageOrder + page-1 dim seed; outline / forms / links / full layout cache run in background.

---

## Section A: PDF.js Web Worker Security Workaround

### How the Worker is Embedded

The PDF.js web worker is served as a static asset in this repository.

**Files:**

- `static/pdf.worker.mjs`
- `static/pdf.worker.min.mjs`
- `static/pdf.worker.mjs.map`

**Initialization** in `src/routes/+page.svelte`:

```typescript
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    window.location.origin + "/pdf.worker.min.mjs";
  (pdfjsLib.GlobalWorkerOptions as any).wasmUrl =
    window.location.origin + "/";
}
```

### Why Standard Methods Fail (Tauri Local Origin Isolation)

- **Tauri Secure Origin Policy (`tauri.localhost`):** Tauri applications serve local assets from a custom secure origin (`tauri.localhost` or `http://tauri.localhost`).
- **CDN Blocking:** Standard live CDNs cannot be used directly in strict offline environments. Cross-origin worker restrictions also block external domains unless complex CORS/blob wrappers are used.
- **Vite Bundling Limits:** Dynamic Vite worker URLs often fail or resolve incorrectly inside Tauri’s asset container.
- **Solution:** Manually copy worker scripts into `static/` so they are served from the same origin as the app.

### Upgrade Protocol

Whenever `pdfjs-dist` is upgraded:

1. Run `npm install`
2. Copy updated worker assets from `node_modules/pdfjs-dist/build/` to `static/`:

```powershell
Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.mjs" -Destination "static/pdf.worker.mjs"
Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.min.mjs" -Destination "static/pdf.worker.min.mjs"
Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.mjs.map" -Destination "static/pdf.worker.mjs.map"
```

3. Confirm the static asset version matches the installed package.

---

## Section B: Custom Printing Mechanism Workaround

### The Problem

- WebView2/Tauri hold an exclusive lock on the user profile directory. Spawning external Chromium/PDF processes can cause Exit Code 21 and black GPU windows.
- `window.print()` prints the whole editor UI, not the clean document.

### The Solution: Hidden iframe Pipeline

1. Intercept Ctrl+P and route to a custom print flow.
2. Flatten the document to PDF bytes.
3. Create a Blob URL and load it in a hidden off-screen iframe.
4. Call `iframe.contentWindow.print()`, then clean up the iframe and object URL.

**Do not** re-implement native Win32/msedge process spooling for printing.

---

## Section C: Startup File Open (Double-click / Open with)

### The Problem

Frontend `invoke('check_startup_file')` was blocked by CSP when the app was launched via file association. The enforced policy was missing `http://ipc.localhost`, so the Rust command never ran.

Also, without single-instance handling, opening a file while the app was already running spawned a **second app window** instead of a new tab.

### The Solution

**Cold start — handle in Rust setup, not via frontend IPC:**

1. On setup, read `std::env::args()`.
2. If a supported file is present, load it into a `FilePayload`.
3. Emit the event `"startup-file-loaded"` (with short retries so the frontend listener is ready).
4. Frontend listens and calls the normal `loadDocument(...)` path (deduped for retries).

**Warm open — single-instance plugin (must be first registered plugin):**

1. `tauri-plugin-single-instance` intercepts the second process.
2. Focuses the existing `main` window (unminimize / show / focus).
3. Loads any supported file path from argv and emits **`open-file-request`** with a `FilePayload`.
4. Frontend listens for `open-file-request` **without** startup dedupe → `loadDocument` opens a new tab (or focuses an existing path match).

`check_startup_file` remains as a fallback only. Do not make double-click / Open with depend on it again.

**Supported extensions:** `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.webp`, `.bmp`

---

## Section D: Content Security Policy (CSP) Notes

Tauri v2 can apply CSP from `tauri.conf.json` and/or capabilities. If the running app still enforces a restrictive `connect-src` (e.g. only `'self' tauri://localhost ipc:`), IPC calls to `http://ipc.localhost` will fail and fall back to postMessage.

When changing CSP:

- Prefer a full clean rebuild after config changes.
- Confirm the enforced policy in the running app console, not only the config file.
- Capabilities can override or interact with `app.security.csp`.

---

## Section E: Post-Save Thumbnail Sync

### The Problem

Annotations live in a floating HTML/SVG layer above the PDF/image canvas. Capturing the live viewport canvas only gets the un-annotated background, so thumbnails go stale after save.

Also:

- Svelte 5 does not reliably re-render when only a nested field like `recents[i].thumbnail` is mutated in place.
- The PageSidebar `use:renderThumbnail` action only re-runs `update()` when its parameter values change.
- After the pdfStore split, thumbnail writes must touch module-level `$state` directly; going through some `activeDoc` getter/setter paths can fail to notify subscribers.
- Image and PDF save paths both need to apply the same override/version pipeline.
- **Save As** creates a **new path** that may not already exist in Recent Documents.

### The Solution

1. **Generate from flattened output**  
   After save/flatten, generate a thumbnail from the compiled document bytes (PDF via offscreen pdf.js, image via the image flatten path), not from the live editor canvas. Export a base64 JPEG data URL.

2. **Write shared override state**
   - `pageThumbnailOverrides[pageIndex] = dataUrl`
   - Recent docs update via shallow clone + array reassignment (or `upsertRecentEntry` when the path is new):

```ts
recents[targetIndex] = { ...recents[targetIndex], thumbnail: dataUrl };
recents = [...recents];
```

   - Always bump `thumbnailVersion++` (do not depend only on a recents path match).
   - On Save As, **upsert** the new path into recents (`upsertRecentEntry` / `updateRecentThumbnail` creates a row if missing).

3. **Invalidate sidebar actions**

```html
<canvas
  use:renderThumbnail={{
    pageNum,
    rotation,
    version: activeDoc.thumbnailVersion,
  }}
></canvas>
```

   The version bump wakes `update()`, which draws from `pageThumbnailOverrides`.

4. **Path matching**  
   Use case-insensitive path comparison on Windows when matching the saved file to a recents entry.

### Rules

- Never thumbnail from the live editor canvas after save.
- Always use flattened document output so annotations (and baked form stamps) are included.
- Always bump `thumbnailVersion`, even if the file is not yet present in recents.
- PDF and image save paths must both end in the same apply/override helper.
- Save As must register/update the **new** path in Recent Documents, not only the old one.

---

## Section F: Stable Tab Identity (Save As Focus Loss)

### The Problem

`activeDocumentId` used to be `filePath || fileName`. On Save As:

1. `filePath` changed while `activeDocumentId` still pointed at the old path.
2. `activeDoc.current` resolved to `null` → workspace showed **“Loading document…”**.
3. Updating the id remounted `{#key activeDoc.activeDocumentId}`, which felt like lost focus (user had to click the tab again).

### The Solution

- Each `DocumentWorkspace` has a stable **`workspaceId`** (UUID at creation).
- `documentKey(doc)` and `activeDocumentId` prefer **`workspaceId`**.
- Save As updates path/name/bytes only via `commitActiveDocumentAfterSave`; the tab id does **not** change.
- `findOpenDocument` / `activeDoc.current` match workspaceId **or** path **or** name for compatibility.

### Rules

- Never use path alone as the sole active-tab key if path can change mid-session.
- Do not rebind `activeDocumentId` to the new path on Save As.
- Keep multi-document close/switch helpers on `documentKey(doc)`.

---

## Section G: AcroForm Entry & Signature Fields (pdf-lib Limits)

### Scope

Non-XFA AcroForms only. Detected on PDF open; values live in-memory per document until save.

### Detection & Overlay

- `extractFormFields(bytes)` → `formFields` + `formValues` on the workspace.
- `FormLayer.svelte` draws widgets in page-relative % coordinates (same space as annotations).
- Interactive when tool is `select` or `text` so drawing tools are not stolen.

### Signature Fields

- pdf-lib’s `PDFSignature` has **no** digital-signature or appearance API.
- We treat Sig widgets as **stamp targets**: store a PNG/JPEG data URL in `formValues[name]`.
- UI reuses **`savedSignatureSets`** (no new drawing required for form fields).
- On save, `applyAndFlattenFormValues`:
  1. Draws the stamp image into each widget rect (contain + center).
  2. Removes the Sig field with a **safe remover** — `form.removeField` / `form.flatten` throw when widgets lack `/AP` streams.
  3. Updates appearances and flattens remaining text/check/dropdown fields.

### Rules

- Do not expect `form.flatten()` alone to handle empty signature widgets.
- Keep form values document-scoped (multi-tab safe); stamp library can stay session/global.
- Freehand annotation stamps (`AnnotationLayer` + `activeTool: signature|initial`) are separate from AcroForm Sig fields; both bake on export, different code paths.
- Radio groups / push buttons / option lists / XFA remain out of scope until explicitly designed.

---

## Section H: Text Tool Settings Persistence

### The Problem

Text font / size / style / alignment lived only in in-memory `$state`, so users had to reselect them every launch and often after tool switches.

### The Solution

Persist defaults under localStorage key **`speeddf_text_settings`**:

- `fontFamily`, `size`, `style`, `alignment`
- Loaded on module init into `defaultFont` / `defaultSize` / `defaultStyle` / `activeFontFamily` / `activeTextAlignment`
- Written on setter changes in `pdfStore.svelte.ts`

New text shapes still read `activeDoc.activeFontFamily`, `defaultSize`, and `defaultStyle` from the drag handler factory.

On **document open / tab switch**, `resetSessionUiForDocumentSwitch` also sets font to **Helvetica** (UI label: Standard Sans) so each document starts from a predictable default without wiping size/style prefs entirely from disk.

### Rules

- Persist **defaults**, not per-shape values (selected shapes update the live shape only).
- Keep validation bounds on size (e.g. 6–200) when loading from storage.
- Toolbar option value remains `Helvetica` (not “Arial”) — CSS stack may still list Arial as a fallback for rendering.

---

## Section I: Form Signature Picker Portal

### The Problem

Page containers use CSS transforms for zoom/rotation. A `position: fixed` modal inside `FormLayer` would be clipped or offset relative to the page, not the window.

### The Solution

Stamp picker uses a small **body portal** action (`document.body.appendChild`) so the dialog covers the full window. Escape / backdrop close; apply is ignored if the user switched tabs mid-pick (`pickingDocId`).

---

## Section J: Form & Text Value Memory

### The Problem

Users retype the same names, addresses, and reference numbers across annotations and AcroForm fields. Browser autocomplete is inconsistent inside Tauri webviews and does not span free text annotations.

### The Solution

Lightweight personal memory in localStorage key **`speeddf_form_memory`**:

```ts
{ version: 1, global: string[], byKey: Record<string, string[]> }
```

- **Global** MRU list (all text-like fields)
- **Per-key** lists: `annotation:text`, `form:text`, `form:field:<AcroFormName>`
- Suggestions require **≥ 2 characters**, case-insensitive **startsWith** only (not substring mid-word)
- UI: `ValueMemoryPopover.svelte` (body portal — same clipping issue as §I)
- ★ Remember / × remove one / Clear all
- Keyboard: ↓↑ highlight, Enter applies when a row is highlighted

### Rules

- Memory is **session/global**, not per-document — intentional for multi-tab work.
- Apply only to the **focused** field or `activelyEditingIndex` — never scan shapes by matching string value.
- Do not store memory blobs in PDF Keywords / metadata.

---

## Section K: Text Edit Session Safety (Finalize & Backspace)

### Problems that bit us

1. **`finalizeTextEdit` guard was too loose**  
   `if (activelyEditingIndex !== null && activelyEditingIndex !== index) return` allowed a second finalize after the session ended (`activelyEditingIndex === null`). Stale blurs (e.g. remount after picking a memory value) could delete/overwrite **another** text shape, especially when values matched.

2. **Global Backspace deleted the selected shape while typing**  
   `WorkspacePage` Delete/Backspace handler skipped only `INPUT`, not `TEXTAREA`. While editing, the text shape stayed selected, so Backspace removed the whole object instead of a character.

3. **Empty finalize deleted the object**  
   Clearing the last character and blurring removed the shape; users expect an empty box to remain until they place another text draft (cleaned via `withoutEmptyTextDrafts`).

### The Solution

- Strict session match: `if (activelyEditingIndex !== index) return;`
- Clear `activelyEditingIndex` **before** mutating shapes so concurrent finalizes no-op.
- Immutable single-slot patches: `next[index] = { ...shape, text }` — never filter-by-value.
- Deletion shortcut: ignore when focus is `INPUT` / `TEXTAREA` / `SELECT` / contenteditable, or `ix.activelyEditingIndex !== null`.
- Empty finalize **keeps** the shape with `text: ""`.

### Rules

- Never finalize “whatever index is in a stale event” after the edit session ends.
- Never treat Backspace as shape-delete while a text control is focused.
- Prefer index-based updates for text shapes; value equality is not identity.

---

## Section L: Text Box Auto-Grow & Shape Click-Drop Geometry

### Text auto-grow

Default height is one line via `defaultTextBoxHeightPct(fontSize, pageHeightPx, zoomScale)`. On input/Enter, `AnnotationLayer.growTextBoxToContent` measures `scrollHeight` and writes `shape.height` as **% of page** so multi-line content stays visible without manual BR resize (BR still works for explicit sizing).

### Shape click-drop

If a box-tool gesture is effectively a click (&lt; 2×2 CSS px drag):

- Default size = **`zoomScale * 1.5`** CSS pixels (100% → 150×150).
- Pointer is the **top-right** corner; shape extends **left and down** (normalize both corners through `normalizeCoordinates` so image rotation stays correct).
- Drag larger than the threshold still creates freeform size from start→end.

### Multi-select

`hasModifier = e.ctrlKey || e.metaKey` on shape move and text select paths. Grouping is Ctrl/Cmd only (Shift is not a multi-select modifier).

---

## Section M: Line Tool Geometry & Stroke Thickness

### Interaction model

Unlike box shapes (mousedown-drag-mouseup), the Line tool is **click → rubber-band → click**:

1. First click sets `lineStartPct` and enters `lineAwaitingEnd`.
2. Mousemove updates `linePreviewPct` (rubber band in AnnotationLayer).
3. Second click commits `createLineShape(start, end, …)` and clears drawing state.
4. `handleMouseUp` must **not** finalize while awaiting end (drag-release would cancel the two-click flow).
5. Leaving the page does **not** cancel an unfinished line (brief leave is common); switching tools does.

### Storage

```ts
{
  type: "line",
  points: [{ x, y }, { x, y }], // start, end (page %)
  x, y, width, height,          // axis-aligned bounds from points
  color, thickness, lineStyle,
  lineEnds: "plain" | "end" | "both",
}
```

Canonical geometry is **`points`**. Bounds are derived for multi-select/move consistency. On body move, translate **both** endpoints (and recompute bounds) — do not only bump `x`/`y`.

### Stroke thickness vs box shapes

Box outlines use `vector-effect="non-scaling-stroke"` with `stroke-width = thickness` in **CSS pixels**.

Lines live in a full-page SVG `viewBox="0 0 100 100"`. Using viewBox-scaled width (e.g. `thickness * 0.22`) makes lines look about **one step thicker** than shapes at the same toolbar size.

**Rule:** line and rubber-band strokes must use `vector-effect="non-scaling-stroke"` and raw `thickness` (same as rect/oval). Keep hit-area stroke non-scaling too (`max(12, thickness + 8)` px). Endpoint handles stay compact (`w-1.5 h-1.5`) so they sit cleanly on a thin stroke.

### Arrow heads

`arrowHeadVertices(from, tip, sizePct)` returns three percentage-space vertices. PDF export must account for pdf-lib `drawSvgPath` applying `scale(1, -1)` — place the path at the tip in PDF space and use local SVG coords relative to the tip.

---

## Section N: PDF Hyperlinks (Safe Open)

### Detection

On PDF open, reuse the loaded PDF.js document:

```ts
activeDoc.hyperlinks = await extractHyperlinksFromDocument(pdfDocument);
```

Post-save / alternate load paths may call `extractHyperlinks(bytes)` (dynamic PDF.js import). Results are **document-scoped** on `DocumentWorkspace.hyperlinks` (multi-tab safe). Clear on TIFF/image loads and document close.

Only `subtype === "Link"` annotations with a URI (`url` or `unsafeUrl`) are kept. Internal destinations (`dest`) are ignored in v1.

### Overlay stacking

`LinkLayer.svelte` uses `z-[36]` (above the text layer at `z-[35]`). Container is `pointer-events-none`; individual link hit-areas re-enable `pointer-events-auto` when `activeTool === "select"`. Drawing tools are never stolen.

### Security rules (non-negotiable)

1. **Scheme allow-list only:** `http:`, `https:`, `mailto:`.
2. **Hard-reject** `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `about:`, relative/schemeless strings.
3. **Confirm** with Tauri `ask` before every open; show the full URL in the dialog.
4. **Re-validate** with `isSafeHyperlinkUrl` at click time (never trust stored strings alone).
5. **Multi-tab:** if `activeDocumentId` changed during the dialog, do not open.
6. Open via `@tauri-apps/plugin-shell` `open` — never in-app navigation.

### Testing note

Do not static-import `pdfjs-dist` at the top of `hyperlinks.ts` — Node vitest lacks `DOMMatrix`. Keep pure helpers import-free; load PDF.js only inside `extractHyperlinks`.

---

**Last Updated:** July 2026 (line tool stroke/geometry, PDF hyperlinks, form/text value memory, text edit session safety, auto-grow + shape drop geometry, Shift multi-select, Helvetica defaults, forms + workspaceId / Save As)
