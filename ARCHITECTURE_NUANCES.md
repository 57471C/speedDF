# Architecture Nuances Ledger

This document serves as the permanent engineering log for hidden project quirks and critical workarounds in the speedDF project.

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

### Rules

- Persist **defaults**, not per-shape values (selected shapes update the live shape only).
- Keep validation bounds on size (e.g. 6–200) when loading from storage.

---

## Section I: Form Signature Picker Portal

### The Problem

Page containers use CSS transforms for zoom/rotation. A `position: fixed` modal inside `FormLayer` would be clipped or offset relative to the page, not the window.

### The Solution

Stamp picker uses a small **body portal** action (`document.body.appendChild`) so the dialog covers the full window. Escape / backdrop close; apply is ignored if the user switched tabs mid-pick (`pickingDocId`).

---

**Last Updated:** July 2026 (forms + AcroForm signatures, workspaceId / Save As, single-instance warm open, text settings persistence, recents upsert on Save As)
