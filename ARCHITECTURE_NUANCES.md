# Architecture Nuances Ledger

This document serves as the permanent engineering log for hidden project quirks and critical workarounds in the SpeedDF project.

---

## Section A: PDF.js Web Worker Security Workaround

### How the Worker is Embedded
The PDF.js web worker is served as a static asset in this repository. 
- Files:
  - `static/pdf.worker.mjs`
  - `static/pdf.worker.min.mjs`
  - `static/pdf.worker.mjs.map`
- Initialization in `src/routes/+page.svelte`:
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
- **CDN Blocking:** Standard live CDNs (like cdnjs or unpkg) cannot be used directly in strict, offline, or firewalled client environments. Additionally, cross-origin web worker restrictions block loading workers from external domains unless complex CORS headers or wrapper blobs are constructed.
- **Vite Bundling Limits:** Standard dynamic Vite URLs (e.g., `new Worker(new URL(..., import.meta.url))`) often fail or introduce bundling complexity inside Tauri's asset containerization, sometimes yielding path resolution errors at runtime.
- **Solution:** Manually copying the worker scripts directly into the `static/` directory allows them to be served from the same `tauri.localhost` domain origin, cleanly satisfying all security policies.

### Upgrade Protocol
Whenever `pdfjs-dist` is upgraded in `package.json`:
1. Run `npm install` to update the package in `node_modules`.
2. Manually copy the updated worker assets from `node_modules/pdfjs-dist/build/` to the `static/` folder:
   ```powershell
   Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.mjs" -Destination "static/pdf.worker.mjs"
   Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.min.mjs" -Destination "static/pdf.worker.min.mjs"
   Copy-Item -Path "node_modules/pdfjs-dist/build/pdf.worker.mjs.map" -Destination "static/pdf.worker.mjs.map"
   ```
3. Verify that the version string inside the static assets matches the updated main thread library package version.

---

## Section B: Custom Printing Mechanism Workaround

### The Problem: WebView2 / Tauri Native Printing Constraints
- **Exclusive File Lock Crash:** WebView2 (Windows) and Tauri hold an exclusive file lock on the user profile directory. Spawning external background browser processes (like trying to execute standard CLI PDF printing or external engine calls) leads to **Chromium Exit Code 21**, causing severe rendering window crashes (turning the application into black boxes).
- **Native Browser Print Deficit:** Direct calls to `window.print()` print the active window layout (containing the editor, toolbars, sidebar, etc.) rather than the clean compiled PDF document.

### The Solution: The Hidden iframe Pipeline
To print the document cleanly and prevent crashes, a custom hidden iframe pipeline isolates the canvas print tree safely inside webview memory.

#### Implementation Pattern (`src/routes/+page.svelte`):
1. **Intercepting Native Print Shortcuts:** A capturing phase listener blocks default browser print dialogs (`Ctrl + P`) and routes them to our custom printing flow:
   ```typescript
   const trapBrowserPrintShortcut = (e: KeyboardEvent) => {
     if (e.ctrlKey && e.key.toLowerCase() === 'p') {
       e.preventDefault();
       e.stopPropagation();
       triggerHeadlessPrintSpool();
     }
   };
   window.addEventListener('keydown', trapBrowserPrintShortcut, { capture: true });
   ```
2. **Spooling Content Headlessly:**
   - Compile annotations and text markups into raw PDF bytes (`compileAndFlattenDocumentBytes`).
   - Wrap the PDF bytes into a local Blob URL:
     ```typescript
     const blob = new Blob([compiledPdfBytes], { type: 'application/pdf' });
     const blobUrl = URL.createObjectURL(blob);
     ```
   - Spawn a hidden `<iframe>` positioned completely off-screen:
     ```typescript
     const iframe = document.createElement('iframe');
     iframe.style.position = 'fixed';
     iframe.style.top = '-10000px';
     iframe.style.left = '-10000px';
     iframe.style.width = '0';
     iframe.style.height = '0';
     iframe.style.border = 'none';
     iframe.src = blobUrl;
     document.body.appendChild(iframe);
     ```
   - On frame load, target its `contentWindow` to focus and trigger print:
     ```typescript
     iframe.onload = () => {
       setTimeout(() => {
         iframe.contentWindow?.focus();
         iframe.contentWindow?.print();
         // Cleanup resources after spooling is complete
         setTimeout(() => {
           if (iframe.parentNode) document.body.removeChild(iframe);
           URL.revokeObjectURL(blobUrl);
         }, 30000);
       }, 500);
     };
     ```
