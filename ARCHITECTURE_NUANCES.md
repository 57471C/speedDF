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

### The Solution

Handle startup files in Rust setup, **not** via frontend IPC:

1. On setup, read `std::env::args()`.
2. If a supported file is present, load it into a `FilePayload`.
3. Emit the event `"startup-file-loaded"` (with short retries so the frontend listener is ready).
4. Frontend listens for that event and calls the normal `loadDocument(...)` path.

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

### The Solution

1. **Generate from flattened output**  
   After save/flatten, generate a thumbnail from the compiled document bytes (PDF via offscreen pdf.js, image via the image flatten path), not from the live editor canvas. Export a base64 JPEG data URL.

2. **Write shared override state**
   - `pageThumbnailOverrides[pageIndex] = dataUrl`
   - Recent docs update via shallow clone + array reassignment:

```ts
recents[targetIndex] = { ...recents[targetIndex], thumbnail: dataUrl };
recents = [...recents];
```

   - Always bump `thumbnailVersion++` (do not depend on a recents path match).

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
- Always use flattened document output so annotations are included.
- Always bump `thumbnailVersion`, even if the file is not yet present in recents.
- PDF and image save paths must both end in the same apply/override helper.

---

**Last Updated:** July 2026 (post v1.0.2)
