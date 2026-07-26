#Requires -Version 5.1
<#
.SYNOPSIS
  Reset local Pi / X-agent config for tutorial recording.

.DESCRIPTION
  1. Uninstall global @earendil-works/pi-coding-agent (if present)
  2. Delete all files under %USERPROFILE%\.pi, then remove empty dirs

.PARAMETER Yes
  Skip confirmation prompt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/reset-tutorial-env.ps1 -Yes
#>
[CmdletBinding()]
param(
  [switch]$Yes
)

$ErrorActionPreference = "Stop"

$piRoot = Join-Path $env:USERPROFILE ".pi"
$piPackage = "@earendil-works/pi-coding-agent"

Write-Host ""
Write-Host "X-agent tutorial env reset" -ForegroundColor Cyan
Write-Host "Will:"
Write-Host "  - uninstall global $piPackage"
Write-Host "  - delete $piRoot (auth / models / providers / prefs / sessions)"
Write-Host ""

if (-not $Yes) {
  $answer = Read-Host "Type y to continue"
  if ($answer -notin @("y", "Y", "yes", "YES")) {
    Write-Host "Cancelled."
    exit 0
  }
}

# --- 1) Uninstall global Pi CLI ---
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($null -ne $npm) {
  Write-Host ""
  Write-Host "[1/2] Uninstalling global Pi CLI..."
  # npm may write warnings to stderr; do not treat them as terminating errors
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  cmd.exe /c "npm uninstall -g $piPackage"
  $npmCode = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($npmCode -ne 0) {
    Write-Host "  (maybe not installed; continue)" -ForegroundColor DarkGray
  } else {
    Write-Host "  Done." -ForegroundColor Green
  }
} else {
  Write-Host ""
  Write-Host "[1/2] npm not found; skip Pi CLI uninstall." -ForegroundColor Yellow
}

# --- 2) Clear ~/.pi files then empty dirs ---
Write-Host ""
Write-Host "[2/2] Cleaning $piRoot ..."
if (-not (Test-Path -LiteralPath $piRoot)) {
  Write-Host "  Directory missing; skip." -ForegroundColor DarkGray
} else {
  $files = @(
    Get-ChildItem -LiteralPath $piRoot -Recurse -Force -File -ErrorAction SilentlyContinue
  )
  Write-Host "  Files to delete: $($files.Count)"
  foreach ($f in $files) {
    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
    Write-Host "  - $($f.FullName)"
  }

  # Remove empty directories deepest-first (never Remove-Item -Recurse on the tree)
  $dirs = @(
    Get-ChildItem -LiteralPath $piRoot -Recurse -Force -Directory -ErrorAction SilentlyContinue
  ) | Sort-Object { $_.FullName.Length } -Descending

  foreach ($d in $dirs) {
    $kids = @(Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue)
    if ($kids.Count -eq 0) {
      Remove-Item -LiteralPath $d.FullName -ErrorAction Stop
    }
  }

  $rootKids = @(Get-ChildItem -LiteralPath $piRoot -Force -ErrorAction SilentlyContinue)
  if ($rootKids.Count -eq 0) {
    Remove-Item -LiteralPath $piRoot -ErrorAction Stop
    Write-Host "  Removed empty $piRoot" -ForegroundColor Green
  } else {
    Write-Host "  WARNING: $piRoot still has $($rootKids.Count) item(s)" -ForegroundColor Yellow
    $rootKids | ForEach-Object { Write-Host "    $($_.FullName)" }
    exit 1
  }
}

# --- Verify ---
Write-Host ""
Write-Host "Verify:"
$piExists = Test-Path -LiteralPath $piRoot
$piCmd = Get-Command pi -ErrorAction SilentlyContinue
Write-Host ("  ~/.pi exists: {0}" -f $piExists)
Write-Host ("  pi on PATH: {0}" -f ($null -ne $piCmd))

if ($piExists -or ($null -ne $piCmd)) {
  Write-Host ""
  Write-Host "Reset incomplete. Check output above." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Done. Open X-agent to record first-run flow." -ForegroundColor Green
