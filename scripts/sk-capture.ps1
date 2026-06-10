# Quick-capture into Swiss Knife from anywhere on Windows (the macOS Shortcut
# equivalent). No secret is stored here: the capture token is fetched from the
# running cockpit at runtime, so this file is safe to commit.
#
# Usage:
#   .\sk-capture.ps1                       # captures the clipboard as a task
#   .\sk-capture.ps1 "buy milk"            # captures the given text as a task
#   .\sk-capture.ps1 "" fact               # captures the clipboard as a memory fact
#   .\sk-capture.ps1 "idea text" idea      # task | fact | prompt | idea
#
# Hotkey: create a shortcut to this script (Target:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\sk-capture.ps1"
# ), put it on the Desktop or Start Menu, open its Properties, and assign a
# "Shortcut key" (e.g. Ctrl+Alt+C). AutoHotkey works too if you use it.
param(
  [Parameter(Position = 0)] [string]$Text = "",
  [Parameter(Position = 1)] [string]$Target = "task"
)
$ErrorActionPreference = "Stop"

$Base = if ($env:SK_BASE) { $env:SK_BASE } else { "http://localhost:3000" }

if (-not $Text) {
  try { $Text = Get-Clipboard -Raw } catch { $Text = "" }
}
if (-not ($Text -replace "\s", "")) {
  Write-Host "Nothing to capture (clipboard empty)." -ForegroundColor Yellow
  exit 1
}

try {
  $tokenResp = Invoke-RestMethod -Uri "$Base/api/capture/token" -TimeoutSec 5
  $token = [string]$tokenResp.token
} catch { $token = "" }
if (-not $token) {
  Write-Host "No capture token. Generate one in the cockpit: Settings -> Quick capture." -ForegroundColor Yellow
  exit 1
}

$body = @{ target = $Target; text = $Text } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "$Base/api/capture" -Method Post -TimeoutSec 10 `
    -Headers @{ "x-capture-token" = $token } -ContentType "application/json" -Body $body | Out-Null
  Write-Host "Captured to $Target."
} catch {
  Write-Host "Capture failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
