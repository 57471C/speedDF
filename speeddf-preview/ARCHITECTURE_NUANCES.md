# Architecture Nuances Ledger — speeddf-preview

Permanent notes for the Windows x64 `.md` preview-handler crate. The app ledger at the repo root does not cover this DLL. Keep these facts here.

The crate is a standalone `cdylib` + `rlib` (`handler.rs`, `paint.rs`, `webview.rs`, `markdown.rs`, `logutil.rs`). Build from `speeddf-preview`. There is no root `Cargo.toml` for this crate. CLSID `{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}` in `src/lib.rs` stays in sync with `register.ps1`.

---

## HWND floor

The host gives a parent HWND and a stream. The DLL creates a child of class `SpeedDFPreviewPane` with `CreateWindowEx`. That child is the preview. It is never reparented with `SetParent`. If the host later supplies a different parent, close the WebView controller, destroy the child, and create a new one on the new parent.

Call order is `IInitializeWithStream`, then `SetWindow` / `SetRect` / `DoPreview`, then `Unload`. A second `Initialize` returns `0x800704DF`. `DoPreview` with no parent returns `E_UNEXPECTED`.

### Empty rects

Explorer sends a real `SetWindow`, then `SetRect(0,0,0,0)` or a zero-width rect. Applying that collapses the child. `rect_has_area` is `right > left && bottom > top`. A rect with no area is ignored and the last rect with area is kept. The log line is `ignored kept=`.

`effective_rect` is used only when placing or moving the child: the stored rect when it has size, otherwise the parent client rect when that is non-zero, otherwise 320×180. The stored host rect can still be `0,0,0,0` in the `DoPreview` log if no positive `SetRect` has arrived.

### Unload keeps the pane

`Unload` releases the stream so the file is not locked, closes the WebView controller, and leaves the child HWND, the last good rect, and the last paint. It calls `ShowWindow(SW_SHOWNA)` and `InvalidateRect`. It does not hide or destroy the pane.

The COM object's `Drop` does destroy the child. That runs when the host releases the object, which is later than `Unload`.

### Hold no RefCell borrow across window calls

`PreviewState` is a `RefCell`. `WndProc` reads `*const RefCell<PreviewState>` from `GWLP_USERDATA`. Drop the borrow before `CreateWindowEx`, `DestroyWindow`, `MoveWindow`, `UpdateWindow`, `SetBounds`, `NavigateToString`, `ShowWindow`, or a message pump. `MoveWindow` can dispatch `WM_PAINT`.

`#[implement(..., Agile = false)]`. Threading model is `Apartment`. Implemented interfaces are `IPreviewHandler`, `IInitializeWithStream`, `IOleWindow`, and `IObjectWithSite`. There is no `IInitializeWithFile`.

### Killing prevhost kills the HWND

The preview HWND lives in `prevhost.exe`. Killing that process destroys it. Explorer then calls the new handler with a dead parent and `DoPreview` returns `E_UNEXPECTED` until a new Explorer window exists (`explorer.exe /n,/e,"<fixtures>"`). Do not restart `explorer.exe` to recover. `register.ps1 -RestartExplorer` is the only path that restarts Explorer, and it is opt-in.

`prevhost.exe` locks `target\release\deps\speeddf_preview.dll` (`LNK1104`). Kill `prevhost.exe` only to unlock a rebuild. Never `taskkill explorer.exe` for a link error.

---

## Explorer vs Outlook Click-to-Run

Both hosts load this DLL inside 64-bit `prevhost.exe` (AppID `{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}`). The log `host=` field is the process image name, so a real preview line says `host=prevhost.exe`. `host.exe` is the in-process example. Its `HOST_OK` and `paint=webview` do not prove Explorer or Outlook.

### Explorer (HKCU)

`register.ps1` writes HKCU only, 64-bit view, `.md` only:

- `Software\Classes\.md\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}` = the CLSID
- The same shellex value on the `.md` ProgID (the script skips ProgIDs that look like PDF or Adobe)
- `Software\Classes\CLSID\{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}` with `InprocServer32`, `ThreadingModel=Apartment`, `AppID`, and `DisableLowILProcessIsolation=1`
- `Software\Microsoft\Windows\CurrentVersion\PreviewHandlers` value name = the CLSID, data = `speedDF Markdown Preview`

`ShowPreviewHandlers` under HKCU Explorer Advanced must be 1 or the pane stays off. The preview-pane toggle is UI Automation id `PreviewPaneToggleButton`. Matching the substring "preview" hits the wrong control.

Explorer uses a new STA thread per file inside one `prevhost` PID. See WebView2 below for what that does to the environment.

The `.md` Open-with default stays `Markdown`. The script does not write `SystemFileAssociations` or the open command.

### Outlook (Click-to-Run PreviewHandlers, outside the scripts)

64-bit Click-to-Run Outlook ignores HKCU `PreviewHandlers`. "This file cannot be previewed because there is no previewer installed for it" is that lookup miss, before the DLL loads.

The list Outlook reads is:

`HKLM\SOFTWARE\Microsoft\Office\ClickToRun\REGISTRY\MACHINE\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers`

Markdown registration adds one REG_SZ there: name `{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}`, data `speedDF Markdown Preview`. When SVG preview is enabled, `register --svg` adds `{C3B7A91E-5D24-4E68-8F10-6A2D9C4B7E15}` = `speedDF SVG Preview`. When PDF preview is enabled, `register --pdf` adds `{8F2C1B64-7A90-4D35-B6E1-3C9A5D7F04E8}` = `speedDF PDF Preview`. Each unregister deletes only its own value. Word, Excel, PowerPoint, and Visio values stay. `register.ps1` and `unregister.ps1` do not write or delete that key. It is outside git. Checking out code restores the helper only and leaves the Click-to-Run values in place.

Outlook itself is `C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE` (PE machine `0x8664`). The user restarts Outlook after a registry change. Do not create, save, or delete mail to test. If no `.md` preview pane is on screen, say so.

---

## WebView2 vs GDI

`DoPreview` always builds sanitized HTML and always has a GDI/DirectWrite paint on `SpeedDFPreviewPane`. WebView2 is a child controller on that same HWND. The green pane is the floor when WebView2 does not become ready.

`DoPreview` logs `paint=webview` only when `state.web.controller` is `Some` after `present`. Otherwise it logs `paint=gdi`. A line from `host=host.exe` does not count. DirectWrite still logs once per process `DirectWrite ready paint=gdi` (or `DirectWrite fallback paint=gdi`) because the child paints before the controller is up.

GDI colors: background `PREVIEW_BG` `0x004F6E0B` (RGB 11, 110, 79), white text, 16px inset. The header is the stream filename (last path segment of `IStream::Stat` `pwcsName`) or, when the stream has no name, the first line of the source. Headings, lists, and code come from the same pulldown-cmark events the HTML path uses. A Direct2D failure falls through to GDI `TextOut`. Pixel (4, 4) of a GDI pane is RGB(11, 110, 79). A loaded HTML pane is white `#fff`.

### One environment per prevhost PID

User data is `%LOCALAPPDATA%\speedDF\preview-wv2\<pid>\`. Exclusive folder access is on. Browser arguments are `--disable-gpu --disable-features=RendererCodeIntegrity` because prevhost is Low IL: the GPU process and renderer code-integrity check otherwise leave the page on `about:blank`.

The environment object is thread-local. Explorer's next file is a new STA thread, so the creating thread is `ENV_OWNER`. The last controller `Close` on that thread drops the environment and logs `WebView release`. The next thread logs `WebView wait-owner`, pumps up to about 1.2s, then creates a new environment on the same pid folder. One environment at a time per PID.

Create is async. `present` pumps `PeekMessage` until `NavigationCompleted` succeeds or about 3 seconds. A live controller is reused. A new file only `NavigateToString`s when `html_epoch` changes. `SetRect` resizes bounds and does not reload HTML.

### Failure stays on the green HWND

- `0x800700AA` (`ERROR_BUSY`): retry once after about 700ms. A second busy sets `ENV_FAILED` and logs `fallback busy paint=gdi` with that hr. The GDI pane stays visible.
- About 3s with no successful navigation: log `WebView timeout paint=gdi`, close the controller, `InvalidateRect`. Timeout does not sticky-fail. Closing the controller is required so a blank WebView does not cover the green text.
- A missing WebView2 runtime logs `fallback runtime-missing`.
- `create_dir` of the pid folder treats `AlreadyExists` and raw os error 183 as success. `ERROR_PATH_NOT_FOUND` (3) creates `speedDF`, then `preview-wv2`, then the pid folder. `create_dir_all` on an existing parent mapped `AlreadyExists` to `0x800700B7` and was the wrong call.

`Unload` closes the controller. It does not delete the user-data folder. Do not delete `preview-wv2\<pid>` while that prevhost is alive.

### NavigateToString is data:text/html

WebView2 reports `NavigateToString` as `data:text/html;charset=utf-8;base64,...`, not `about:blank`. Cancelling every non-about URI makes `NavigationCompleted` fail with `WebErrorStatus` 14 (`OPERATION_CANCELED`) and the page stays blank. `send_html` arms a thread-local allow for one `data:text/html` navigation. Empty and `about:` stay allowed. Every later `data:`, `file:`, and `http(s):` navigation is cancelled. The log records `cancel scheme=` only (scheme, at most 16 characters), never the document or the base64.

`NavigationCompleted` with a matching id and `IsSuccess` sets `navigated_epoch` and logs `WebView ready paint=webview`. One extra `NavigateToString` is allowed if a different tracked id completes (`nav_fixups`).

---

## Elevation and integrity

`prevhost.exe` runs at Low integrity (RID `0x1000`). `DisableLowILProcessIsolation=1` on the HKCU CLSID does not raise that integrity level. Do not write HKLM to "fix" integrity.

Low IL cannot create a file in a medium-integrity directory. It can append to a file whose mandatory label is Low.

- Log path is `%USERPROFILE%\AppData\Local\Temp\speeddf-preview.log` (not `GetTempPath`, which inside prevhost is `%LOCALAPPDATA%\Temp\Low`). `register.ps1` runs `icacls /setintegritylevel L` on that file. The host example's `remove_file` recreates a medium file; its `Drop` restores Low. Do not delete the log to "clean" a test.
- `%LOCALAPPDATA%\speedDF\preview-wv2` must not inherit AppContainer package allow ACEs (`S-1-15-2-*`). Those ACEs make Low IL `CreateDirectory` return access denied (`0x80070005`). `register.ps1` drops inheritance and grants `(OI)(CI)F` to SYSTEM (`S-1-5-18`), Administrators (`S-1-5-32-544`), and the current user SID, then `(OI)(CI)L`. The handler creates only the pid child under that root.
- The Click-to-Run `PreviewHandlers` values are the machine-wide writes, and they are not in the scripts. Adding or changing them needs elevation. Leave the Office previewer values on that key alone.

Static CRT is on (`.cargo\config.toml`, `+crt-static`) so prevhost does not need a VC runtime beside the DLL. `cargo build` from `C:\Scripts\speedDF` fails: no `Cargo.toml` there. Run Cargo inside `speeddf-preview`. PowerShell scripts stay ASCII for Windows PowerShell 5.1. UI and bitmap checks use `powershell.exe -NoProfile -Sta`, not `pwsh` `Add-Type` of `System.Drawing`.

Log line shape: `{timestamp} pid={pid} tid={tid} host={exe} {op} {detail} hr=0x{hr as u32:08X}`. `host` is the file name only.

---

## Security

The handler reads the `IStream` as UTF-8, cap 2MB (`READ_CAP`), strips a UTF-8 BOM and NUL bytes. It does not open the attachment path and does not take `IInitializeWithFile`.

HTML is pulldown-cmark (tables, strikethrough, task lists) then `ammonia::clean`. The document is wrapped with CSP `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:`. Output is capped near 1.5MB (`HTML_CAP`); over the cap, a prefix is rendered and a trailing ellipsis paragraph is appended. Script tags, `onerror`, and `javascript:` links are stripped before they reach the control. The same events feed the GDI blocks, which do not draw raw HTML.

WebView2 settings: script off, script dialogs off, web message off, dev tools off, host objects off, status bar off, default context menus off. `NewWindowRequested` is handled. `DownloadStarting` (`ICoreWebView2_4`) is cancelled and handled. No network and no `file://` to the attachment. The single allowed non-about navigation is the `data:text/html` document `NavigateToString` just queued.

---

## What not to do

- Do not change the CLSID, the `.md` shellex IID `{8895b1c6-b41f-4c1c-a562-0d564250836f}`, or the Click-to-Run `PreviewHandlers` value unless a host goes blank. Do not remove Word, Excel, PowerPoint, or Visio from that key.
- Do not add Adobe keys, `SystemFileAssociations`, UserChoice, OpenWith, PerceivedType, or a ProgID. Do not make speedDF or Edge the default PDF app. The SVG and PDF opt-ins each write only their own CLSID on the Click-to-Run `PreviewHandlers` key. Do not replace the Markdown value, the other speedDF value, or the Office previewers. Do not delete another product's preview handler to make the pane ours.
- Do not point this work at `speeddf.exe`, the Tauri webview, or the in-app markdown viewer. Do not copy another previewer tree into this crate.
- Do not apply an empty or zero-area `SetRect` / `SetWindow`. Keep the last good rect.
- Do not hide or destroy the pane in `Unload`. Do not `SetParent` the child onto Explorer or Outlook.
- Do not treat a WebView2 failure as a reason to abandon the HWND. Leave GDI on that window and log the hr.
- Do not cancel the `data:text/html` navigation that `NavigateToString` is. Do not allow a later `data:`, `file:`, or `http(s):` navigation.
- Do not delete `preview-wv2\<pid>` while that prevhost process is alive. Do not put the user-data folder back on an inherited AppContainer ACL.
- Do not log the document URI or the base64 payload.
- Do not restart Explorer, send Alt+P, or kill `prevhost.exe` except to unlock the DLL after `LNK1104`.
- Do not create, save, or delete mail to test Outlook.
- Do not treat `examples/host.rs` `HOST_OK` as proof the preview host works. The counting log line is `host=prevhost.exe` with `paint=webview` or, on fallback, `paint=gdi` and a still-visible green pane.

---

## Settings registration

Markdown preview stays off until the user turns it on. The NSIS installer remains `installMode: currentUser` and does not request administrator execution. UAC is only the helper.

`speeddf-preview-register.exe` (`register` | `unregister` | `status`, plus `--svg` or `--pdf`) lives in this crate. Settings starts it as the current user. `status` is unelevated and prints one JSON line: `explorer`, `outlook_clicktorun`, `svg`, `pdf`, `dll_path`. `outlook_clicktorun` is the Markdown value. `register` and `unregister` ShellExecute `runas` when the process is not elevated, and they write nothing until that prompt succeeds. Cancel exits `1223`. The checkboxes and status line stay as the last `status` read. Markdown `register` / `unregister` do not pass `--svg` or `--pdf`. `--svg` and `--pdf` cannot be passed together.

`register` is idempotent. It writes HKCU `.md` shellex (and the non-PDF ProgID), `PreviewHandlers`, CLSID `AppID` `{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}`, and `InprocServer32` with an absolute x64 DLL path. `DllSurrogate` stays on the system prevhost AppID. The helper writes an HKCU AppID `DllSurrogate` only when that system value is missing, and unregister removes that HKCU key only if this helper created it. It also sets the Click-to-Run HKLM value `{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}` = `speedDF Markdown Preview`. `unregister` deletes only that value plus our HKCU values. Word, Excel, PowerPoint, and Visio stay. Repair is `register` again.

The helper appends to `%USERPROFILE%\AppData\Local\Temp\speeddf-preview.log` (the user `%TEMP%` file). It logs the operation and the DLL path, not file contents. Do not add `speeddf.exe --preview`.

## SVG preview

SVG preview stays off until the separate Settings checkbox is turned on. It uses the same `speeddf_preview.dll` and the same prevhost AppID `{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}`. Its CLSID is `{C3B7A91E-5D24-4E68-8F10-6A2D9C4B7E15}` (`speedDF SVG Preview`), so Markdown unregister does not delete it. No second executable is shipped.

`register --svg` and `unregister --svg` are the only commands that touch `.svg`. They write HKCU `Software\Classes\.svg\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}`, the SVG CLSID `InprocServer32`, the HKCU `PreviewHandlers` value, the shared HKCU AppID surrogate only when the system prevhost value is missing, and the Click-to-Run value `{C3B7A91E-5D24-4E68-8F10-6A2D9C4B7E15}` = `speedDF SVG Preview`. `unregister --svg` deletes only that Click-to-Run value. They do not change the Markdown Click-to-Run value, `.pdf`, `.md`, UserChoice, OpenWith, PerceivedType, or a ProgID. `status` reports `"svg":"yes"` only when that `.svg` shellex default is the SVG CLSID and the Click-to-Run value is `speedDF SVG Preview`. A shellex without that value reports `"svg":"no"`. While that shellex is still ours, Markdown unregister keeps the shared HKCU AppID and the backup entries whose kind is `svg`.

A file whose name ends in `.svg` is loaded as a static image: the bytes are base64 in `data:image/svg+xml` and passed to `NavigateToString`. Script stays off. A file over 1 MiB, a truncated read, or markup with script, entities, `javascript:`, `foreignObject`, frames, or an inline `on*` handler produces no HTML. GDI then draws `Can't preview this SVG.` The log records the file name and HRESULT, not the file body.

A read-only check on 2026-09-30 found no `.svg` preview-handler shellex under HKCU, HKLM, or `SystemFileAssociations`, and HKLM `PreviewHandlers` had no SVG, Photos, or Edge value. The existing `.svg` UserChoice ProgID was left unchanged. If Edge or Photos later owns the pane after this shellex is set, stop. Do not hijack the default app.

## PDF preview

PDF preview stays off until its own Settings checkbox is turned on. It uses the same `speeddf_preview.dll` and the same prevhost AppID. Its CLSID is `{8F2C1B64-7A90-4D35-B6E1-3C9A5D7F04E8}` (`speedDF PDF Preview`). Markdown and SVG unregister do not delete it. No second executable is shipped.

`register --pdf` and `unregister --pdf` are the only commands that touch `.pdf`. They write HKCU `Software\Classes\.pdf\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}`, the PDF CLSID `InprocServer32`, the HKCU `PreviewHandlers` value, the shared HKCU AppID surrogate only when the system prevhost value is missing, and the Click-to-Run value `{8F2C1B64-7A90-4D35-B6E1-3C9A5D7F04E8}` = `speedDF PDF Preview`. `unregister --pdf` deletes only that Click-to-Run value. They do not change the Markdown or SVG values, UserChoice, OpenWith, PerceivedType, or a ProgID, and they do not set the default PDF app. `status` reports `"pdf":"yes"` only when that `.pdf` shellex default is the PDF CLSID and the Click-to-Run value is `speedDF PDF Preview`. While that shellex is still ours, Markdown unregister keeps the shared HKCU AppID and the backup entries whose kind is `pdf`.

A file whose name ends in `.pdf` is copied from the preview stream into `%LOCALAPPDATA%\speedDF\preview-wv2\<pid>\pdf-stage\preview.pdf`, at most 15MB. WebView2 maps that folder to `https://speeddf-pdf.invalid` and navigates to `preview.pdf#page=1`, which is Edge's built-in PDF viewer. The viewer does not paint with script off, so script is enabled for that navigation only. Every other navigation is cancelled except that document URL and `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai`. New windows and downloads stay cancelled. Over the cap, a truncated read, a missing `%PDF-` header, or a failed stage produces no navigation. GDI then draws `Can't preview this PDF.` The log records the path, size, and HRESULT, not the file bytes.

If Edge or Adobe later owns the Explorer pane after this shellex is set, stop. Do not unregister their handler and do not change the default PDF app.

The tag workflow still does not run `register` or `unregister`. The Windows bundle is still `speeddf_preview.dll` and `speeddf-preview-register.exe`.

## Windows bundle

`cargo build --release --manifest-path speeddf-preview/Cargo.toml` writes `speeddf_preview.dll` (the `[lib]` cdylib name) and `speeddf-preview-register.exe` to `speeddf-preview/target/release`. That directory is the Windows bundle input. NSIS copies both files into the same folder as `speeddf.exe`. MSI uses the same resource map when that target is built. Settings launches the helper from that install directory and passes the sibling DLL. With no `--dll`, the helper looks beside itself, then in `deps/`. A dev `speeddf.exe` still falls back to `speeddf-preview/target/release` or `debug`.

The tag workflow builds this crate on `windows-latest` only, copies those two files into the bundle input, and does not run `register` or `unregister`. macOS and Linux jobs do not build or ship the preview binaries. The installer stays `installMode: currentUser`.
