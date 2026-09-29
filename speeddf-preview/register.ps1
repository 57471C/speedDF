# Per-user registration for the speedDF .md preview-handler spike.
# HKCU only, 64-bit view, .md only. Does not write HKLM, .pdf, Adobe keys,
# SystemFileAssociations, or the .md open command.
# ASCII-only for Windows PowerShell 5.1.

param(
    [string]$DllPath = "",
    [switch]$RestartExplorer
)

$ErrorActionPreference = "Stop"

$Clsid = "{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}"
$PreviewHandler = "{8895b1c6-b41f-4c1c-a562-0d564250836f}"
$AppId = "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}"
$Display = "speedDF Markdown Preview"

if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Error "This spike registers a 64-bit preview handler only."
}

if (-not $DllPath) {
    $uplifted = Join-Path $PSScriptRoot "target\release\speeddf_preview.dll"
    $deps = Join-Path $PSScriptRoot "target\release\deps\speeddf_preview.dll"
    if (Test-Path -LiteralPath $uplifted) {
        $DllPath = $uplifted
    } elseif (Test-Path -LiteralPath $deps) {
        $DllPath = $deps
    } else {
        $DllPath = $uplifted
    }
}
$DllPath = [System.IO.Path]::GetFullPath($DllPath)
if (-not (Test-Path -LiteralPath $DllPath)) {
    Write-Error "DLL not found: $DllPath"
}

$fs = [System.IO.File]::Open($DllPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
    $buf = New-Object byte[] 4096
    $n = $fs.Read($buf, 0, $buf.Length)
    if ($n -lt 64 -or $buf[0] -ne 0x4D -or $buf[1] -ne 0x5A) {
        Write-Error "Not a PE file: $DllPath"
    }
    $lfanew = [BitConverter]::ToInt32($buf, 0x3C)
    if ($lfanew -lt 0 -or ($lfanew + 6) -gt $n) {
        Write-Error "PE header is outside the first 4KB: $DllPath"
    }
    $machine = [BitConverter]::ToUInt16($buf, $lfanew + 4)
    if ($machine -ne 0x8664) {
        Write-Error "DLL is not x64 (machine 0x$($machine.ToString('X4'))): $DllPath"
    }
} finally {
    $fs.Close()
}

function Open-Hive([Microsoft.Win32.RegistryHive]$hive, [bool]$writable) {
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
    if ($writable) { return $root }
    return $root
}

function Get-RegDefault($root, [string]$path) {
    $key = $root.OpenSubKey($path)
    if ($null -eq $key) {
        return @{ Exists = $false; Value = $null }
    }
    try {
        $has = $false
        foreach ($name in $key.GetValueNames()) {
            if ($name -eq "") { $has = $true }
        }
        if (-not $has) {
            return @{ Exists = $true; Value = $null }
        }
        $value = $key.GetValue("")
        if ($null -eq $value) {
            return @{ Exists = $true; Value = $null }
        }
        return @{ Exists = $true; Value = [string]$value }
    } finally {
        $key.Close()
    }
}

function Set-RegString($root, [string]$path, [string]$name, [string]$value) {
    $key = $root.CreateSubKey($path)
    if ($null -eq $key) { Write-Error "CreateSubKey failed: $path" }
    try {
        $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $key.Close()
    }
}

function Set-RegDword($root, [string]$path, [string]$name, [int]$value) {
    $key = $root.CreateSubKey($path)
    if ($null -eq $key) { Write-Error "CreateSubKey failed: $path" }
    try {
        $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::DWord)
    } finally {
        $key.Close()
    }
}

function Add-ProgId($list, $id) {
    if ([string]::IsNullOrWhiteSpace([string]$id)) { return }
    $text = [string]$id
    if ($text -match "(?i)pdf|adobe|acroexch") {
        Write-Host "Skipping ProgId $text"
        return
    }
    if (-not $list.Contains($text)) {
        [void]$list.Add($text)
    }
}

$hkcu = Open-Hive ([Microsoft.Win32.RegistryHive]::CurrentUser) $true
$hklm = Open-Hive ([Microsoft.Win32.RegistryHive]::LocalMachine) $false
try {
    $progIds = New-Object System.Collections.Generic.List[string]
    $choice = $hkcu.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")
    if ($null -ne $choice) {
        try { Add-ProgId $progIds $choice.GetValue("ProgId") } finally { $choice.Close() }
    }
    $userExt = Get-RegDefault $hkcu "Software\Classes\.md"
    Add-ProgId $progIds $userExt.Value
    $machineExt = Get-RegDefault $hklm "Software\Classes\.md"
    Add-ProgId $progIds $machineExt.Value

    $shellexPaths = New-Object System.Collections.Generic.List[string]
    [void]$shellexPaths.Add("Software\Classes\.md\shellex\$PreviewHandler")
    foreach ($progId in $progIds) {
        [void]$shellexPaths.Add("Software\Classes\$progId\shellex\$PreviewHandler")
    }

    $backupPath = Join-Path $PSScriptRoot "registration-backup.json"
    $known = @{}
    if (Test-Path -LiteralPath $backupPath) {
        $old = Get-Content -LiteralPath $backupPath -Raw -Encoding Ascii | ConvertFrom-Json
        foreach ($entry in @($old.shellex)) {
            if ($null -ne $entry -and $entry.path) {
                $known[[string]$entry.path] = $entry
            }
        }
    }

    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($path in $shellexPaths) {
        if ($known.ContainsKey($path)) {
            $prev = $known[$path]
            $existed = [bool]$prev.existed
            $previous = $prev.previous
            if ([string]::IsNullOrEmpty([string]$previous)) { $previous = $null }
        } else {
            $snap = Get-RegDefault $hkcu $path
            if ((-not $snap.Exists) -or ($snap.Value -eq $Clsid)) {
                $existed = $false
                $previous = $null
            } else {
                $existed = $true
                $previous = $snap.Value
            }
        }
        $entries.Add([pscustomobject]@{
            path = $path
            existed = $existed
            previous = $previous
        }) | Out-Null
        Set-RegString $hkcu $path "" $Clsid
        Write-Host "shellex $path"
    }

    $clsidPath = "Software\Classes\CLSID\$Clsid"
    Set-RegString $hkcu $clsidPath "" $Display
    Set-RegString $hkcu $clsidPath "DisplayName" $Display
    Set-RegString $hkcu $clsidPath "AppID" $AppId
    Set-RegDword $hkcu $clsidPath "DisableLowILProcessIsolation" 1
    Set-RegString $hkcu "$clsidPath\InprocServer32" "" $DllPath
    Set-RegString $hkcu "$clsidPath\InprocServer32" "ThreadingModel" "Apartment"
    Set-RegString $hkcu "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" $Clsid $Display

    $payload = [pscustomobject]@{
        clsid = $Clsid
        dll = $DllPath
        shellex = $entries.ToArray()
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupPath -Encoding Ascii
} finally {
    $hkcu.Close()
    $hklm.Close()
}

if (-not ("SpeedDF.ShellNotify" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace SpeedDF {
  public static class ShellNotify {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
  }
}
"@
}
[SpeedDF.ShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

$logFile = Join-Path $env:TEMP "speeddf-preview.log"
if (-not (Test-Path -LiteralPath $logFile)) {
    New-Item -ItemType File -Path $logFile | Out-Null
}
# Low-IL prevhost can append only when the file label is Low. Lowering is allowed
# for a file the current user owns.
& icacls.exe $logFile /setintegritylevel L | Out-Null

Write-Host "Registered $Clsid"
Write-Host "DLL $DllPath"
Write-Host "Log $logFile"

if ($RestartExplorer) {
    & taskkill.exe /f /im explorer.exe | Out-Null
    Start-Process explorer.exe
    Write-Host "Restarted Explorer"
}
