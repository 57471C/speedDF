; speedDF NSIS installer hooks
; Hooked into the main installer.nsi script by Tauri via `bundle.windows.nsis.installerHooks`.
;
; Macros executed at the correct lifecycle points:
;   NSIS_HOOK_POSTINSTALL  — runs after all files are copied, registers the COM preview handler.
;   NSIS_HOOK_PREUNINSTALL — runs before files are removed, unregisters the COM preview handler.
;
; regsvr32 /s  = silent (no dialog boxes)
; regsvr32 /u  = unregister
; Both calls require the installer to run as Administrator (requestedExecutionLevel = requireAdministrator),
; which is guaranteed by installMode = "perMachine".

!macro NSIS_HOOK_POSTINSTALL
  ; Register the speedDF preview handler DLL system-wide.
  ; $INSTDIR is the installation directory chosen by the user during setup.
  ExecWait '$SYSDIR\regsvr32.exe /s "$INSTDIR\speeddf_previewer.dll"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Unregister before files are deleted so regsvr32 can locate the DLL.
  ExecWait '$SYSDIR\regsvr32.exe /s /u "$INSTDIR\speeddf_previewer.dll"'
!macroend
