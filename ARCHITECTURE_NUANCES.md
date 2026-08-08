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
- **Serialised open:** all `getSharedWorkspacePdf` / `destroySharedWorkspacePdf` ops run on one `opChain`. Concurrent cold-open callers (loadDocument + registerRecentFile effect + first paint) **join** the same in-flight `loadingTask` instead of aborting it (`Loading aborted`).
- **Never destroy while same-bytes load is in flight** — only replace when `rawBytes` identity changes (save/new file) or on explicit close/tab switch.
- Idle: armed only via `enableSharedPdfIdleCleanup()` from `markMainViewReady` (first main paint or 2.5s fallback) — **not** on `getDocument` resolve. Every 30s call `doc.cleanup(false)` when the render queue is idle **and** there has been no scroll/paint activity for ~15s. Temporary `[idle-mem]` console logs report heap before/after.
- Bulk metadata (layout dims, hyperlinks) must `page.cleanup()` after each `getPage` and finish with `runIdleCleanup()` only after main view ready — never leave every page proxy warm.
- Recent-file snapshot uses `getSharedWorkspacePdf` (never a second `getDocument`).
- On tab switch / close of active doc: `destroySharedWorkspacePdf()` (loadingTask.destroy + cleanup).
- On **last tab close** (`cleanupWorkspace`): also `PDFWorker.destroy()` so Wasm heaps do not stack across open/close cycles; next open creates a fresh worker.
- `purgeDocumentResources(doc)` nulls `rawBytes`, shapes, thumbnail overrides, TIFF pages, forms, etc. **before** dropping the tab so GC can reclaim.

**Do not** reintroduce per-paint `getDocument` on workspace bytes. **Do not** eagerly generate every sidebar thumbnail on open. **Do not** call `loadingTask.destroy()` from idle cleanup.

### Static sidebar thumbnails

- Generate each page thumb **once** via `ensurePageThumbnail` → JPEG in `pageThumbnailOverrides[pageIndex]`.
- Sidebar/grid render `<img src={override}>` — no canvas/pdf.js on zoom, scroll, tab focus, or grid toggle.
- Re-generate only on **page rotate** (`invalidatePageThumbnail`) or **save** (`applyLiveThumbnail` / `syncLiveThumbnail` for annotated page 0).
- Lazy priority: placeholder mounts `requestStaticThumb` with **IntersectionObserver** so visible cards jump the queue.
- **Background fill:** after `markMainViewReady`, `startBackgroundThumbnailGeneration()` walks every uncached page **one at a time** on the low-priority render slot (shared PDF only), stores each JPEG in `pageThumbnailOverrides` + IndexedDB immediately, and yields between pages. **Order:** currently visible / near-visible PageSidebar cards first (`[data-sidebar-page]` + scroll root `[data-sidebar-thumb-scroll]`, ~240px margin), then the rest of `pageOrder`. Cancelled on tab switch / close via `stopBackgroundThumbnailGeneration` / `clearThumbnailInflight` (generation token).
- **High-res Recent p1:** when the background fill finishes successfully, `upgradePage1RecentThumbnail` re-renders page 1 with `RECENT_THUMB_MAX_EDGE_PX` / `RECENT_THUMB_MAX_SCALE` / `RECENT_THUMB_JPEG_QUALITY` and calls `applyLiveThumbnail` so Recent Documents cards are sharp (sidebar-scale JPEGs look soft on the dashboard).
- **Merge / blank insert:** after rewriting `rawBytes` + sequential `pageOrder`, **await** `refreshThumbnailsAfterPageInsert(prePages, extraCount, postPages, bytes)`. That remaps surviving thumbs, then `generateThumbnailsForPages` force-paints every new page with **high** render priority (no IntersectionObserver). Always `destroySharedWorkspacePdf` before rebinding bytes.
- **Critical gate:** `destroySharedWorkspacePdf` → `clearPdfRenderQueue` sets `lowPriorityAllowed = false`. If `mainReady` is already true, `markMainViewReady` used to early-return and leave thumbs blocked forever. Fix: `markMainViewReady` always re-enables low priority; merge path also calls `setLowPriorityAllowed(true)` and uses high-priority slots for new-page thumbs.
- **Do not** open a temporary `pdfjsLib.getDocument` just to count pages after merge (use `mergedDoc.getPageCount()` from pdf-lib).
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
2. Focuses the existing **`main`** window only (unminimize / show / focus) — not secondary `doc-*` windows.
3. Loads any supported file path from argv and emits **`open-file-request`** with a `FilePayload` (app-wide emit).
4. **Main window only** listens for `open-file-request` **without** startup dedupe → `loadDocument` opens a new tab (or focuses an existing path match). Secondary `doc-*` windows must not register this listener (would open the OS file in every open window).

`check_startup_file` remains as a fallback only. Do not make double-click / Open with depend on it again.

**Supported extensions:** `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.webp`, `.bmp`, `.heic`, `.heif`

**Related:** In-app **Open in new window** (tab context menu) is a separate path — see **Section W**. It creates an in-process `WebviewWindow`; it does not spawn a second OS process and is not blocked by single-instance.

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
- Widget rects are mapped with **`pdfRectToDisplayPercent`** (CropBox origin + page `/Rotate`, pdf.js PageViewport matrix at scale 1) so percentages match the painted canvas — MediaBox-only Y-flip drifts on rotated / cropped pages.
- `FormLayer.svelte` draws widgets in those page-relative % coordinates (same space as annotations). Chrome uses **outline** (not inset border) and zoom-scaled font/padding so fixed-px borders never shrink the hit box relative to the PDF field.
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

- **Ctrl/Cmd+click** toggles shapes into `selectedShapes` (grouping modifier on move/select paths).
- **Shift+drag marquee** (select tool only) selects intersecting shapes on the current page (`dragHandler` + marquee overlay in `AnnotationLayer`).
- With **2+** selected shapes on a page, `AnnotationLayer` shows a floating **align bar**; pure align/distribute math lives in `lib/annotation/alignShapes.ts` + `shapeBounds.ts`.

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

## Section O: Ctrl+F Search Highlights (Text Layer)

### The Problem

Full-document search joined every pdf.js text item with spaces, then mapped “occurrence N” to **span N**. Multi-hit spans and item/span mismatches left some cycles with no visible yellow mark. Text-layer glyphs use `color: transparent`, so Tailwind-only classes on dynamic `<mark>` HTML were also easy to miss.

### The Solution

1. **Index per text item** (`collectMatchesFromPageItems`) so occurrence order matches the painted text layer.
2. **Paint every hit** with escaped HTML marks (`sdf-search-hit` / `sdf-search-hit-current`) via `paintSearchHighlightsOnRoot`.
3. **Explicit CSS** on `WorkspacePage`: normal hits use ~20% yellow wash; the focused hit uses ~50% yellow + a thin amber outline (Safari-style). Canvas text stays legible under the translucent marks.
4. **Scroll the mark** into view; retry paint until the text layer exists (off-screen pages need time).
5. Reuse **`getSharedWorkspacePdf`** for indexing — never open a second `getDocument` per keystroke.

### Rules

- Always `escapeHtml` mark text (never re-inject raw span `innerHTML`).
- Bind/scroll the specific `<mark data-sdf-search-occ="N">`, not only the page shell.
- Close search when document or zoom changes (text layer rebuilds).

---

## Section P: Zoom-to-Pointer (Ctrl+Wheel)

### The Problem

Re-anchoring with `scrollWidth` / `scrollHeight` ratios treats `mx-auto` side gutters as content. Zooming in collapses those margins → content drifts sideways under the cursor.

### The Solution

1. Mark the page stack with **`data-workspace-pages`**.
2. Capture **content-local** cursor coords (client − content rect) and viewport coords before zoom.
3. Apply `zoomScale`, `await tick()` + one animation frame for page-shell reflow.
4. `scrollAfterZoomToPointer` places the same local point under the cursor using post-layout content placement (`contentRect − nodeRect`).
5. Stack multi-notch wheels on `pendingZoom` so rapid events are not lost before rAF.

### Rules

- Prefer content element metrics over full `scrollWidth` when the stack is centered.
- Keep `scroll-behavior: auto` while re-anchoring (`workspace-zooming` class).
- Clamp scroll to `[0, scrollSize − clientSize]`.

---

## Section Q: Workspace Bookmark Icon (Click-to-Compose)

### The Problem

Empty bookmark icons used a hover popout with an “Add” button that disappeared when the cursor left the narrow gutter — users hunted for the control. Click also immediately committed an **Untitled** bookmark.

### The Solution

- **Empty:** click opens compose popout with focused title input; commit only on Add/Enter via `addBookmarkAction`. Escape / × cancels. **No hover popout** when empty.
- **Existing:** hover shows title / rename / delete (same sticky-while-composing pattern as comments).
- Sidebar bookmark list behaviour is unchanged.

### Rules

- Do not auto-create a bookmark on icon click without a user commit.
- Hover is for **existing** bookmarks only.

---

## Section R: Calculator Expression Memory

### Behaviour (Windows 11 style)

- `CalculatorState.expression` is a dim secondary line above the main `display`.
- Operator → e.g. `12 +`; equals → `12 + 3 =` with result on the main line.
- Next digit after `=` clears the expression.
- **CE** clears the current entry only (keeps expression); **C** resets everything.

Engine: pure `src/lib/tools/calculator.ts` (no DOM). UI: `src/routes/tools/+page.svelte`.

---

## Section T: Page Move + Selection + Snapshot Overlay

### Page-bound data travels with pages

- **Reorder** (`pageOrder` drag in grid): page identities stay the same, so bookmarks/comments/shapes/**hyperlinks/form fields** keyed by `pageNum` automatically follow their pages. Multi-select drag preserves relative document order (not click order). Sidebar labels show **display position** via `displayPagePosition(pageOrder, pageNum)`.
- **Delete**: after filtering `pageOrder`, call `prunePageBoundToOrder` so orphaned bookmarks/comments/**hyperlinks/form fields** are dropped (and formValues for removed field names).
- **Merge / blank insert**: PDF is rewritten as sequential pages 1..N. Same pre/extra/post slices as thumbnail remap — use `remapSessionAfterPageInsert` for bookmarks, comments, shapes, rotations, **hyperlinks, form fields**, and `currentPage` **before** assigning the new `pageOrder`. Form *values* stay name-keyed (not remapped by page).

Helpers live in pure `src/lib/pages/pageBoundData.ts` (unit-tested).

### Esc and empty-page click selection

- **Esc** (Workspace `handleKeyDown`): when focus is not in an editable field, clear `selectedShape` / `selectedShapes` and set `activeTool = "select"`. Compose/form Escape handlers keep working because focus is on their inputs.
- **Empty page click** (`dragHandler`): with Select tool, plain click clears selection; **Ctrl/Cmd+click** keeps multi-select. Text-layer empty hits clear both selection arrays the same way.

### Snapshot grey-out vs zoom

Do **not** use `absolute inset-0` on the scroll container for the snapshot mask — it drifts relative to zoomed page shells (padding, scroll origin, content growth).

- Measure `scrollContainer.getBoundingClientRect()` and paint a **fixed** mask at those screen coords; re-measure on zoom, scroll, and resize.
- Marquee corners are pure `clientX` / `clientY`; capture maps screen → canvas via `getBoundingClientRect` + `canvas.width / displayWidth` (DPR-safe).

---

## Section S: HEIC/HEIF Support (Feature-Gated One-Time Conversion)

### The Problem

iPhone photos are saved as `.heic` / `.heif` (HEVC-compressed HEIF containers). The browser WebView cannot decode HEIC natively, and no web-standard API exists for it. Users expect to open iPhone photos the same way they open PNG/JPEG.

### The Solution

A Rust-side one-time conversion pipeline, mirroring the existing TIFF path:

1. Frontend detects `.heic` / `.heif` via `determineFileType` → `"heic"` category.
2. Invokes `parse_heic_document` (Tauri command) with the file path.
3. Rust reads the file, decodes HEIC → RGBA8 via the `heic` crate (`DecoderConfig::new().decode()`), then encodes to PNG using `image::codecs::png::PngEncoder` (same encoder the TIFF pipeline uses).
4. PNG bytes return over IPC. Frontend stores them as `rawBytes` and creates a blob URL → standard single-page `"image"` workspace. All existing image tools (annotations, rotation, export) work unchanged.
5. Conversion is **one-time at open** — subsequent renders use the cached PNG bytes.

### Feature gate

The `heic` crate is **AGPL-3.0-only OR Imazen Commercial** dual-licensed. To keep the default build MIT-clean:

- `Cargo.toml` declares `heic` as an **optional dependency** behind `[features] heic = ["dep:heic"]`.
- The decode command uses `#[cfg(feature = "heic")]`; a `#[cfg(not(feature = "heic"))]` **stub** returns a descriptive error string.
- Both variants are always registered in `invoke_handler` — Tauri's `generate_handler!` sees the stub in default builds.
- File dialogs and OS file associations include `.heic`/`.heif` **regardless** of the feature, so users see the format is "known" and get a clear error if the feature is off.
- Build with `cargo build --features heic` (or `cargo tauri build --features heic`) to enable.

### Patent / licensing constraints

- HEVC/HEIF is covered by MPEG-LA and Access Advance patent pools. The `heic` crate grants copyright but **not** patent rights. Consult a patent attorney before commercial distribution.
- The `heic` crate attribution is listed in `HelpModal.svelte` (Open Source Compliance section) with a note that it is optional and feature-gated.

### Rules

- Do not compile the `heic` crate into the default (featureless) build.
- Do not add FFI / system-library HEIC decoders — pure Rust only.
- Do not re-decode on zoom/scroll/tab switch — rawBytes already holds the converted PNG.
- After conversion, `fileType` is `"image"` (not a new `"heic"` type) so the entire render/export pipeline works without any conditional branches.
- The `heic` 0.1.x series bundles its HEVC backend; no separate `backend-rust` feature needed. Version 0.2.0 was yanked.

---

## Section T2: SVG Opens as Image (No Inline SVG DOM)

### Pattern

`.svg` files use the **same** image workspace as PNG/JPEG:

1. Startup / Open dialog accept `.svg` (Rust `is_supported_startup_extension` + frontend `IMAGE_EXTENSIONS` + `tauri.conf.json` associations).
2. Bytes → `Blob` with MIME **`image/svg+xml`** → `URL.createObjectURL` → existing image frame (`<img>`).
3. `fileType: "image"` — zoom, fit, resize strip, annotations, and flatten reuse the image path.

### Security

Do **not** inject raw SVG via `{@html}` or an inline `<svg>` DOM tree. Prefer **`<img src=blob:…>`** so scripts and external resources inside the SVG do not execute in the app origin.

### Save / flatten

Annotations bake through the canvas image flatten pipeline (raster). Saving a marked-up SVG typically becomes JPEG/PNG like other images — do not invent SVG source editing or path re-serialization in this path.

### Rules

- Prefer reusing `"image"` over a new `"svg"` fileType unless a hard special-case is required.
- Thumbnail: same canvas-from-`<img>` path; if decode fails, leave empty / live `imageUrl` fallback — do not block open.
- PDF and markdown pipelines stay unchanged.

---

## Section U: Light Mode Design System & FOUC Prevention

### The Problem

Hardcoded slate/cyan hex codes (`bg-[#090d16]`, `bg-slate-900`, `text-slate-100`, `bg-[#020617]`) caused washed-out text, invisible borders, and dark popups when switching to light mode. Additionally, applying the light theme only after SvelteKit hydration caused a Flash of Unstyled Content (FOUC).

### The Solution

1. **CSS Custom Properties (`global.css`)**  
   All component backgrounds, chrome borders, text tiers (`primary`, `secondary`, `muted`, `faint`), overlays, and active tool states are bound to `--sdf-*` CSS custom properties. Overrides are scoped to `[data-theme="light"]`.

2. **Synchronous Head Script (`app.html`)**  
   To prevent FOUC, an inline `<script>` in `<head>` inspects `localStorage.getItem("speeddf_app_settings")` synchronously before first paint:
   ```html
   <script>
     (() => {
       try {
         const raw = localStorage.getItem('speeddf_app_settings');
         if (raw) {
           const parsed = JSON.parse(raw);
           if (parsed && parsed.theme === 'light') {
             document.documentElement.dataset.theme = 'light';
           }
         }
       } catch {}
     })();
   </script>
   ```

3. **Dual Hero Icon Specificity (`RecentDashboard.svelte`)**  
   Both light and dark SVG hero icons exist in the DOM for the empty state. `global.css` defines rules with `!important` to ensure theme switching overrides Svelte component inline style specificity:
   ```css
   [data-theme="light"] .hero-icon-dark { display: none !important; }
   [data-theme="light"] .hero-icon-light { display: block !important; }
   :root:not([data-theme="light"]) .hero-icon-light { display: none !important; }
   :root:not([data-theme="light"]) .hero-icon-dark { display: block !important; }
   ```

4. **Floating Overlays & Context Menus**  
   Toast notifications (`showToast`, `showUpdateToast`, `isDownloadingUpdate`), thumbnail options popovers ("Add/Merge...", "Insert Blank"), and tool flyouts use `var(--sdf-overlay-bg)`, `var(--sdf-overlay-border)`, and high z-index layers so popovers remain legible against both document pages and app chrome.

---

## Section V: Scratch Pad HTML Paste Sanitization

### The Problem

Pasting text from external formatted sources (web pages, Word documents, IDEs) into the `contenteditable` Scratch Pad carried inline `style="..."` attributes (`font-family`, `font-size`, `color`, `background-color`) and `<font>` tags. This locked pasted text into hardcoded colors or typefaces that broke in light mode.

### The Solution

1. **HTML Sanitizer Helper (`src/lib/tools/scratchPad.ts`)**  
   `stripFontStylesFromHtml(html: string): string` parses pasted HTML using `DOMParser` and recursively strips `style`, `color`, `face`, `size`, and `bgcolor` attributes from element nodes, and unwraps `<font>` tags into their parent container.
   ```ts
   export function stripFontStylesFromHtml(html: string): string {
     if (!html || !html.trim()) return html;
     if (typeof DOMParser !== "undefined") {
       const parser = new DOMParser();
       const doc = parser.parseFromString(html, "text/html");
       // Recursively removes font attributes & style tags while preserving <b>, <i>, <u>, <ul>, <ol>, <li>, <p>, <br>
       // ...
       return doc.body.innerHTML;
     }
     return html.replace(/\s*style="[^"]*"/gi, "").replace(/<\/?font[^>]*>/gi, "");
   }
   ```

2. **Paste Handler (`src/routes/tools/+page.svelte`)**  
   The Scratch Pad element binds `onpaste={onPadPaste}`, which prevents default insertion, extracts `text/html` (or `text/plain`), cleans it via `stripFontStylesFromHtml`, and inserts clean HTML via `document.execCommand("insertHTML", false, cleanHtml)`.

---

## Section W: Secondary Document Windows (Open in new window)

### The Problem

Users want a second full workspace on another monitor without closing the original tab. Spawning a second **process** is wrong: `tauri-plugin-single-instance` hands argv back to `main` as a new tab. A true multi-window UI must stay **in-process**.

### The Solution

1. **Tab context menu** (`DocumentTabs.svelte`): right-click tab → **Open in new window**.
2. **`openDocumentInNewWindow(path, name?)`** (`src/lib/window/openDocumentWindow.ts`):
   - Requires a saved absolute `filePath` (no-path / untitled → toast, return `"no-path"`).
   - Creates `new WebviewWindow("doc-<12hex>", { url: "/?open=…", decorations: false, visible: false, … })`.
   - Label is unique each time (same file may open in multiple windows).
   - **Leaves the original tab open** — new window reloads **from disk** via `read_file_bytes` (unsaved markup in the source tab is not cloned).
3. **Bootstrap:** `+page.svelte` reads `URLSearchParams` `open`, strips the query with `history.replaceState`, then `promptAndLoadFile` / `loadDocument`.
4. **Main vs secondary:**
   - Secondary (`label.startsWith("doc-")`): skip updater check; **do not** listen for `startup-file-loaded` / `open-file-request`.
   - Main: cold start + single-instance open-file path unchanged.
5. **Reveal:** `+layout.svelte` shows any non-`tools-*` window after paint; focuses `doc-*`.
6. **Capabilities:** `default.json` windows = `["main", "doc-*"]` so plugin/core permissions apply to secondary windows. Tools stay on `tools.json` (`tools-*`).

### Rules

- Do not bypass single-instance by launching a second executable for “new window”.
- Do not let secondary windows handle app-wide open-file events (multi-window double-load).
- Do not transfer in-memory dirty state across windows unless explicitly designed (current design is disk-only).
- Window labels: alphanumeric + hyphens only (`doc-` prefix reserved for document windows).

---

## Section X: Floating Centre Toolbars & Page-1 Clearance

### The Problem

Image resize and text-style toolbars use **`position: fixed`** relative to the viewport. TitleBar (`h-9`) + document tab strip consume ~70px at the top. If strips sit too high they collide with chrome; if page content keeps a small fixed `pt-*`, strips cover the top of page 1 and block editing. When **both** strips show (image doc + text tool), they also stacked with **no gap**.

### The Solution

| Strip | Component | Fixed top |
|--------|-----------|-----------|
| Image resize | `ImageResizeStrip.svelte` | `top-20` |
| Text style | floating menu in `Workspace.svelte` | `top-20`, or **`top-36`** when image strip is visible (breathing room between bars) |

**Dynamic workspace padding** (`Workspace.svelte` → `workspacePadTop`):

```ts
const bands = (imageStrip ? 1 : 0) + (textMenu ? 1 : 0);
const rem = bands === 0 ? 2 : 1.25 + bands * 3.25;
// applied as style padding-top on the scroll container
```

Page 1 therefore drops below the fixed strips whenever they appear; empty chrome keeps modest `2rem` air under the tab strip.

### Rules

- Keep image strip **above** text strip when both are visible; preserve a few px / rem of gap (`top-20` then `top-36`).
- Never rely on viewport-fixed toolbars alone without increasing scroll-area top padding.
- Padding is per-band (~3.25rem) so one vs two strips stay consistent.

---

## Section Y: Image Document Resize Strip

### Behaviour

For `fileType === "image"` only, a centre-top strip edits **Width (px)**, **Height (px)**, and **Scale (%)** with aspect lock (on by default).

- Pure math: `src/lib/annotation/imageResize.ts` (`computeLinkedResize`, `clampScale` 1–99, presets 75/50/25).
- Apply: `applyImageResizeAction(w, h)` resamples pixels on the active workspace; **`imageNativeWidth` / `imageNativeHeight`** remain the Scale % baseline (multi-doc safe).
- After HEIC conversion the workspace is a normal image — resize applies to the PNG bytes like any other image.

### Rules

- Do not treat Scale % as a zoom UI (viewport zoom is separate `zoomScale`).
- Do not apply the strip to multi-page PDF/TIFF page geometry.
- Commit on Enter / blur / preset pick; keep history snapshot on apply.

---

## Section Z: Markdown Source vs View (Canonical Source)

### Pattern

Markdown documents use a dedicated `fileType: "markdown"` (not PDF/image). On open:

1. File bytes are decoded as **UTF-8** into `DocumentWorkspace.markdownSource`.
2. `rawBytes` is retained for tab identity / recents / close paths.
3. The workspace **view** is a pure projection: `markdownSource → marked → DOMPurify → HTML` (`MarkdownView.svelte`).
4. **Initial zoom is 150%** for markdown only. Workspace auto-fit on open is skipped for this type so fit-to-window does not overwrite the default; zoom controls still work freely after open.

### Why it matters

Future editing (source editor or WYSIWYG) must **write back to `markdownSource`**, then re-project. Never treat the rendered HTML DOM as the document of record, or Save will lose fidelity (comments, unparsed constructs, original newlines).

### Rules

- Do not open markdown with pdf.js or the A4 page shell.
- Hide annotation tools / OCR / page-merge / bookmarks for this type.
- Print uses a headless iframe (`lib/markdown/print.ts`) with `@page { size: A4 }`, not PDF flatten.
- Startup associations: `.md` / `.markdown` in Rust `is_supported_startup_extension` + `tauri.conf.json` fileAssociations.
- **Recent / sidebar thumbs:** single simple path — `html2canvas` of live `[data-markdown-content]` (top band), then `applyLiveThumbnail`. Fixed dark paper `#121a2b` + light text + sans stack in `onclone` (theme must not flip colours or yield Times). Await `document.fonts.ready` before capture. No offscreen clone / modern-screenshot / multi-strategy stack. Capture failure must not block open.
- Do not reintroduce auto-fit-on-open for markdown (would fight the 150% default).

---

**Last Updated:** August 2026 (SVG-as-image open path; Markdown continuous viewer phase 1 — source vs view, 150% open zoom, fixed-palette thumbs; Secondary doc windows Open-in-new-window, floating toolbar stack + dynamic pad, image resize strip, Shift+marquee multi-select + align, light mode FOUC, Scratch Pad paste sanitize, page-move bookmarks/comments, Esc→select, snapshot overlay zoom, HEIC feature-gate, form CropBox/rotate, Ctrl+F marks, merge thumbs, zoom-to-pointer, bookmark compose, calculator memory, line tool, hyperlinks, form/text value memory, workspaceId / Save As)
