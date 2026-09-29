# Removes the per-user .md preview-handler registration created by register.ps1.
# Restores shellex values recorded in registration-backup.json.
# Does not write HKLM, .pdf, or Adobe keys.
# ASCII-only for Windows PowerShell 5.1.

param(
    [switch]$RestartExplorer
)

$ErrorActionPreference = "Stop"

$Clsid = "{E7A4C2B1-9D58-4F63-A1E0-6C8B3D5F27A4}"
$PreviewHandler = "{8895b1c6-b41f-4c1c-a562-0d564250836f}"

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
        if (-not $has) { return @{ Exists = $true; Value = $null } }
        $value = $key.GetValue("")
        if ($null -eq $value) { return @{ Exists = $true; Value = $null } }
        return @{ Exists = $true; Value = [string]$value }
    } finally {
        $key.Close()
    }
}

function Set-RegString($root, [string]$path, [string]$name, [string]$value) {
    $key = $root.CreateSubKey($path)
    try { $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Close() }
}

function Remove-RegKey($root, [string]$path) {
    $slash = $path.LastIndexOf("\")
    if ($slash -lt 0) { return }
    $parentPath = $path.Substring(0, $slash)
    $name = $path.Substring($slash + 1)
    $parent = $root.OpenSubKey($parentPath, $true)
    if ($null -eq $parent) { return }
    try { $parent.DeleteSubKeyTree($name, $false) } finally { $parent.Close() }
}

function Remove-DefaultIfMatches($root, [string]$path, [string]$expected) {
    $snap = Get-RegDefault $root $path
    if (-not $snap.Exists) { return }
    if ($snap.Value -ne $expected) { return }
    $key = $root.OpenSubKey($path, $true)
    if ($null -eq $key) { return }
    try { $key.DeleteValue("", $false) } finally { $key.Close() }
}

function Remove-KeyIfEmpty($root, [string]$path) {
    $key = $root.OpenSubKey($path)
    if ($null -eq $key) { return }
    $subs = $key.GetSubKeyNames()
    $vals = $key.GetValueNames()
    $key.Close()
    if ($subs.Length -eq 0 -and $vals.Length -eq 0) {
        Remove-RegKey $root $path
    }
}

$hkcu = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::CurrentUser,
    [Microsoft.Win32.RegistryView]::Registry64)
try {
    $backupPath = Join-Path $PSScriptRoot "registration-backup.json"
    $paths = New-Object System.Collections.Generic.List[object]
    if (Test-Path -LiteralPath $backupPath) {
        $old = Get-Content -LiteralPath $backupPath -Raw -Encoding Ascii | ConvertFrom-Json
        foreach ($entry in @($old.shellex)) {
            if ($null -ne $entry -and $entry.path) {
                [void]$paths.Add($entry)
            }
        }
    } else {
        Write-Host "No registration-backup.json; removing keys that still point at $Clsid"
        [void]$paths.Add([pscustomobject]@{
            path = "Software\Classes\.md\shellex\$PreviewHandler"
            existed = $false
            previous = $null
        })
    }

    foreach ($entry in $paths) {
        $path = [string]$entry.path
        $previous = $entry.previous
        if ([string]::IsNullOrEmpty([string]$previous)) { $previous = $null }
        if ([bool]$entry.existed -and $null -ne $previous) {
            Set-RegString $hkcu $path "" ([string]$previous)
            Write-Host "Restored $path"
        } elseif ([bool]$entry.existed) {
            Remove-DefaultIfMatches $hkcu $path $Clsid
            Write-Host "Cleared $path"
        } else {
            $snap = Get-RegDefault $hkcu $path
            if ($snap.Exists -and ($null -eq $snap.Value -or $snap.Value -eq $Clsid)) {
                Remove-RegKey $hkcu $path
                $parent = $path.Substring(0, $path.LastIndexOf("\"))
                Remove-KeyIfEmpty $hkcu $parent
                Write-Host "Removed $path"
            } else {
                Write-Host "Left $path (value is not this handler)"
            }
        }
    }

    Remove-RegKey $hkcu "Software\Classes\CLSID\$Clsid"
} finally {
    $hkcu.Close()
}

# The placeholder above is replaced below; this file sets the expected display string inline.
# Re-open to delete the PreviewHandlers value by known display name or by name match.
$hkcu = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::CurrentUser,
    [Microsoft.Win32.RegistryView]::Registry64)
try {
    $key = $hkcu.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", $true)
    if ($null -ne $key) {
        try {
            $current = $key.GetValue($Clsid)
            if ($null -ne $current) {
                $key.DeleteValue($Clsid, $false)
                Write-Host "Removed PreviewHandlers\$Clsid"
            }
        } finally {
            $key.Close()
        }
    }
} finally {
    $hkcu.Close()
}

$backupPath = Join-Path $PSScriptRoot "registration-backup.json"
if (Test-Path -LiteralPath $backupPath) {
    Remove-Item -LiteralPath $backupPath -Force
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

Write-Host "Unregistered $Clsid"

if ($RestartExplorer) {
    & taskkill.exe /f /im explorer.exe | Out-Null
    Start-Process explorer.exe
    Write-Host "Restarted Explorer"
}
