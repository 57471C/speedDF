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

### Outlook (one HKLM value, outside this repo)

64-bit Click-to-Run Outlook ignores HKCU `PreviewHandlers`. "This file cannot be previewed because there is no previewer installed for it" is that lookup miss, before the DLL loads.

The list Outlook reads is:

`HKLM\SOFTWARE\Microsoft\Office\ClickToRun\REGISTRY\MACHINE\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers`

One REG_SZ was added there: name `{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}`, data `speedDF Markdown Preview`. Word, Excel, PowerPoint, and Visio values on that key stay. `register.ps1` and `unregister.ps1` do not write or delete that key. It is outside git. Checking out the Phase 0 commit restores code only and leaves the Click-to-Run value in place.

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
- The Click-to-Run `PreviewHandlers` value is the one machine-wide write, and it is not in the scripts. Adding or changing it needs elevation. Leave the Office previewer values on that key alone.

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
- Do not add `.pdf`, `.svg`, Adobe keys, `SystemFileAssociations`, or an Open-with change for `.md`.
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
