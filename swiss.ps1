# Swiss Knife ops CLI for Windows - one command to run, stop, inspect, and
# diagnose the stack. PowerShell 5.1+ (works in Windows PowerShell and pwsh 7).
#
#   .\swiss.ps1 setup    one-time: install the prerequisites (Docker Desktop + Ollama app)
#   .\swiss.ps1 up       start everything: native Ollama + models + containers
#   .\swiss.ps1 down     stop the containers (native Ollama keeps running)
#   .\swiss.ps1 status   one-line state of engine / cockpit / Open WebUI / Docker
#   .\swiss.ps1 doctor   full preflight with fix-it commands
#
# Hard rule encoded here (same as the macOS ./swiss): Ollama runs NATIVELY on
# the host, never in Docker. On Windows the native app uses your NVIDIA/AMD
# GPU when present and falls back to CPU; containerized Ollama complicates GPU
# access for no benefit.
#
# Windows-specific rule: the QUALITY tier here is gemma4:12b (GGUF). The
# gemma4:12b-mlx tag the macOS docs mention is MLX = Apple Silicon ONLY and
# will not run on Windows.
#
# If scripts are blocked by execution policy, run via:
#   powershell -ExecutionPolicy Bypass -File .\swiss.ps1 doctor
# (or use the swiss.cmd wrapper, which does exactly that.)

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "help"
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$EngineUrl  = "http://localhost:11434"
$CockpitUrl = "http://localhost:3000"
$OwuiUrl    = "http://localhost:3001"
# Guarded: LOCALAPPDATA always exists on Windows, but null-safe init lets the
# script at least parse/run for help on other shells (and in CI).
$OllamaAppExe = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe" } else { $null }

function Test-OllamaApp {
  return ($OllamaAppExe -and (Test-Path $OllamaAppExe))
}

$script:Fails = 0

function Write-Ok([string]$Msg) {
  Write-Host "  [OK] " -ForegroundColor Green -NoNewline
  Write-Host $Msg
}
function Write-Bad([string]$Msg, [string]$Fix = "") {
  Write-Host "  [XX] " -ForegroundColor Red -NoNewline
  Write-Host $Msg
  if ($Fix) { Write-Host "       -> $Fix" -ForegroundColor DarkGray }
  $script:Fails++
}
function Write-Note([string]$Msg, [string]$Fix = "") {
  Write-Host "  [ !] " -ForegroundColor Yellow -NoNewline
  Write-Host $Msg
  if ($Fix) { Write-Host "       -> $Fix" -ForegroundColor DarkGray }
}
function Write-Say([string]$Msg) {
  Write-Host $Msg -ForegroundColor White
}

function Test-Engine {
  try {
    Invoke-RestMethod -Uri "$EngineUrl/api/tags" -TimeoutSec 3 | Out-Null
    return $true
  } catch { return $false }
}

function Get-EngineModelNames {
  try {
    $tags = Invoke-RestMethod -Uri "$EngineUrl/api/tags" -TimeoutSec 3
    if ($null -eq $tags.models) { return @() }
    return @($tags.models | ForEach-Object { [string]$_.name })
  } catch { return @() }
}

function Test-ModelPulled([string]$Tag) {
  # Tags may resolve as "name" or "name:latest".
  $names = Get-EngineModelNames
  foreach ($n in $names) {
    if ($n -eq $Tag -or $n -eq "${Tag}:latest" -or $n.StartsWith("${Tag}:")) { return $true }
  }
  return $false
}

function Test-DockerInstalled {
  return [bool](Get-Command docker -ErrorAction SilentlyContinue)
}

function Test-DockerUp {
  if (-not (Test-DockerInstalled)) { return $false }
  # Windows PowerShell 5.1 turns native stderr under 2>$null into a terminating
  # NativeCommandError when $ErrorActionPreference is Stop — a stopped Docker
  # Desktop (which writes its connect error to stderr) crashed this very check.
  $ErrorActionPreference = "Continue"
  try { docker info 2>$null | Out-Null } catch { return $false }
  return ($LASTEXITCODE -eq 0)
}

function Get-CockpitHealth {
  try {
    return Invoke-RestMethod -Uri "$CockpitUrl/api/health" -TimeoutSec 3
  } catch { return $null }
}

function Test-Cockpit { return ($null -ne (Get-CockpitHealth)) }

function Test-Owui {
  try {
    $r = Invoke-WebRequest -Uri $OwuiUrl -TimeoutSec 3 -UseBasicParsing
    return ($r.StatusCode -lt 400)
  } catch { return $false }
}

function Wait-ForCheck([int]$Seconds, [scriptblock]$Check) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (& $Check) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-Doctor {
  Write-Say "Swiss Knife doctor (Windows)"
  Write-Host ""

  Write-Say "Engine install (native Ollama for Windows - never in Docker)"
  if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Ok "ollama CLI on PATH (model pulls work)"
  } else {
    Write-Bad "Ollama isn't installed (or not on PATH)" "winget install Ollama.Ollama   (or download: https://ollama.com/download/windows)"
  }
  if (Test-OllamaApp) {
    Write-Ok "Ollama app found ($OllamaAppExe)"
  } else {
    Write-Note "Ollama tray app not found in the default location" "fine if you installed elsewhere; otherwise: winget install Ollama.Ollama"
  }
  # Ollama for Windows accelerates on NVIDIA (CUDA) and AMD Radeon (ROCm) —
  # only diagnose CPU-only when neither is present.
  $gpuNames = @()
  try { $gpuNames = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) } catch { }
  $hasNvidia = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue) -or (($gpuNames -match "NVIDIA").Count -gt 0)
  $hasAmd = ($gpuNames -match "AMD|Radeon").Count -gt 0
  if ($hasNvidia) {
    Write-Ok "NVIDIA GPU detected (models run CUDA-accelerated)"
  } elseif ($hasAmd) {
    Write-Ok "AMD Radeon GPU detected (Ollama accelerates via ROCm on supported models)"
  } else {
    Write-Note "No supported GPU detected - models run on CPU (works, slower)" "stick to the light tier (gemma4:e4b) on CPU-only machines"
  }
  try {
    $ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    if ($ramGb -ge 24) {
      Write-Ok "RAM: ${ramGb} GB (enough for the quality tier + Docker)"
    } elseif ($ramGb -ge 16) {
      Write-Note "RAM: ${ramGb} GB - use the light tier (gemma4:e4b) when Docker runs alongside" "Settings -> Model -> gemma4:e4b"
    } else {
      Write-Note "RAM: ${ramGb} GB - tight. Use gemma4:e2b/e4b and consider skipping Open WebUI" "docker compose up -d cockpit   (cockpit only)"
    }
  } catch { }

  Write-Host ""
  Write-Say "Engine runtime"
  if (Test-Engine) {
    Write-Ok "Ollama serving on :11434"
    foreach ($m in @("gemma4:e4b", "embeddinggemma")) {
      if (Test-ModelPulled $m) { Write-Ok "model $m pulled" }
      else { Write-Bad "model $m not pulled" "ollama pull $m   (or just: .\swiss.ps1 up)" }
    }
    if (Test-ModelPulled "gemma4:12b") {
      Write-Ok "model gemma4:12b pulled (quality tier, GGUF)"
    } else {
      Write-Note "model gemma4:12b not pulled (optional quality tier)" "ollama pull gemma4:12b"
    }
    if (Test-ModelPulled "gemma4:12b-mlx") {
      Write-Bad "gemma4:12b-mlx is in your model list - MLX is Apple Silicon ONLY and won't run here" "ollama rm gemma4:12b-mlx; ollama pull gemma4:12b   (then pick gemma4:12b in Settings -> Model)"
    }
  } else {
    Write-Bad "Ollama isn't serving on :11434" "start Ollama from the Start menu (or: .\swiss.ps1 up)"
  }

  Write-Host ""
  Write-Say "Docker"
  if (-not (Test-DockerInstalled)) {
    Write-Bad "Docker isn't installed" "install Docker Desktop (WSL2 backend): https://www.docker.com/products/docker-desktop/"
  } elseif (Test-DockerUp) {
    Write-Ok "Docker daemon running"
    $running = @()
    try { $running = @(docker compose ps --status running --services 2>$null) } catch { }
    if ($running -contains "cockpit") { Write-Ok "cockpit container running" }
    else { Write-Note "cockpit container not running" ".\swiss.ps1 up" }
    if ($running -contains "open-webui") { Write-Ok "open-webui container running" }
    else { Write-Note "open-webui container not running" ".\swiss.ps1 up" }
  } else {
    Write-Bad "Docker daemon isn't running" "start Docker Desktop, then: .\swiss.ps1 up"
  }

  Write-Host ""
  Write-Say "Surfaces"
  $h = Get-CockpitHealth
  if ($null -ne $h -and $h.ok) {
    Write-Ok "Cockpit healthy at $CockpitUrl"
  } elseif ($null -ne $h) {
    Write-Bad "Cockpit is up but unhealthy (reason: $($h.reason))" "fix the engine findings above, then refresh"
  } else {
    Write-Note "Cockpit not responding on :3000" ".\swiss.ps1 up   (Docker)  -  or local dev: cd cockpit; npm run dev"
  }
  if (Test-Owui) {
    Write-Ok "Open WebUI responding at $OwuiUrl"
  } else {
    Write-Note "Open WebUI not responding on :3001" ".\swiss.ps1 up   (first boot downloads its embedder - give it a few minutes)"
  }

  Write-Host ""
  Write-Say "Voice capture (optional)"
  $whisperBin = if ($env:WHISPER_BIN) { $env:WHISPER_BIN } else { "whisper-cli" }
  $ffmpegBin  = if ($env:FFMPEG_BIN)  { $env:FFMPEG_BIN }  else { "ffmpeg" }
  $hasWhisper = [bool](Get-Command $whisperBin -ErrorAction SilentlyContinue)
  $hasFfmpeg  = [bool](Get-Command $ffmpegBin -ErrorAction SilentlyContinue)
  if ($hasWhisper -and $hasFfmpeg) {
    Write-Ok "whisper-cli + ffmpeg installed"
  } else {
    Write-Note "whisper-cli / ffmpeg missing - voice capture stays off (everything else works)" "ffmpeg: winget install Gyan.FFmpeg   whisper: grab whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases, unzip, add to PATH (the binary may be named main.exe or whisper-cli.exe; set WHISPER_BIN if so)"
  }
  $home2 = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $whisperModel = if ($env:WHISPER_MODEL) { $env:WHISPER_MODEL } else { Join-Path $home2 ".cache\whisper\ggml-base.en.bin" }
  if ($whisperModel -and (Test-Path $whisperModel)) {
    Write-Ok "whisper model present"
  } else {
    Write-Note "whisper model missing" "mkdir `"$env:USERPROFILE\.cache\whisper`" -Force; curl.exe -L -o `"$env:USERPROFILE\.cache\whisper\ggml-base.en.bin`" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
  }
  Write-Note "Note: voice transcription runs in LOCAL DEV mode (cd cockpit; npm run dev) - the Docker cockpit image doesn't bundle ffmpeg/whisper" ""

  Write-Host ""
  if ($script:Fails -eq 0) {
    Write-Say "Everything required looks good."
  } else {
    Write-Say "$($script:Fails) problem(s) found - fixes are listed above."
    exit 1
  }
}

function Invoke-Status {
  if (Test-Engine) {
    $count = (Get-EngineModelNames).Count
    Write-Ok "Engine      up on :11434 ($count models pulled)"
  } else {
    Write-Bad "Engine      down" "start Ollama from the Start menu (or: .\swiss.ps1 up)"
  }

  $h = Get-CockpitHealth
  if ($null -ne $h -and $h.ok) {
    Write-Ok "Cockpit     $CockpitUrl"
  } elseif ($null -ne $h) {
    Write-Note "Cockpit     up, but engine unhealthy (reason: $($h.reason))" ".\swiss.ps1 doctor"
  } else {
    Write-Bad "Cockpit     down" ".\swiss.ps1 up"
  }

  if (Test-Owui) {
    Write-Ok "Open WebUI  $OwuiUrl"
  } else {
    Write-Bad "Open WebUI  down" ".\swiss.ps1 up"
  }

  if (-not (Test-DockerInstalled)) {
    Write-Bad "Docker      not installed" "install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  } elseif (Test-DockerUp) {
    Write-Ok "Docker      daemon running"
  } else {
    Write-Bad "Docker      daemon down" "start Docker Desktop"
  }

  if ($script:Fails -gt 0) { exit 1 }
}

function Invoke-Up {
  Write-Say "> Swiss Knife up (Windows)"

  # 1) Engine - native Ollama (GPU when present, never in Docker).
  if (-not (Test-Engine)) {
    if (Test-OllamaApp) {
      Write-Host "  starting the Ollama app..."
      Start-Process -FilePath $OllamaAppExe | Out-Null
      if (-not (Wait-ForCheck 30 { Test-Engine })) {
        Write-Bad "Ollama didn't come up on :11434 within 30s" ".\swiss.ps1 doctor"
        exit 1
      }
    } elseif (Get-Command ollama -ErrorAction SilentlyContinue) {
      Write-Host "  Ollama app not found; starting 'ollama serve' in the background..."
      Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden | Out-Null
      if (-not (Wait-ForCheck 20 { Test-Engine })) {
        Write-Bad "Ollama didn't start" ".\swiss.ps1 doctor"
        exit 1
      }
    } else {
      Write-Bad "Ollama isn't installed" "winget install Ollama.Ollama   (or https://ollama.com/download/windows)"
      exit 1
    }
  }
  Write-Ok "engine up on :11434"

  # 2) Models (light + quality tiers + the embedder). pull-models needs the
  # ollama CLI; the installer adds it to the USER PATH, which a same-session
  # terminal may not have picked up yet — self-heal from the app directory.
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    $ollamaDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Ollama" } else { $null }
    if ($ollamaDir -and (Test-Path (Join-Path $ollamaDir "ollama.exe"))) {
      $env:Path = "$ollamaDir;$env:Path"
    } else {
      Write-Bad "the 'ollama' CLI isn't on PATH (needed to pull models)" "open a NEW terminal after installing Ollama, or: winget install Ollama.Ollama"
      exit 1
    }
  }
  & (Join-Path $PSScriptRoot "scripts\pull-models.ps1")
  if ($LASTEXITCODE -ne 0) { exit 1 }

  # 3) Containers.
  if (-not (Test-DockerUp)) {
    Write-Bad "Docker daemon isn't running" "start Docker Desktop, then re-run: .\swiss.ps1 up"
    exit 1
  }
  # The cockpit does calendar-day math (due dates, Today panel); hand it the
  # host timezone as an IANA name or the container computes days in UTC.
  # TryConvertWindowsIdToIanaId needs .NET 6+ (pwsh 7) — skip quietly on 5.1.
  if (-not $env:TZ) {
    try {
      $iana = $null
      if ([System.TimeZoneInfo]::TryConvertWindowsIdToIanaId([System.TimeZoneInfo]::Local.Id, [ref]$iana) -and $iana) {
        $env:TZ = $iana
      }
    } catch { }
  }
  Write-Host "  building & starting containers..."
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) {
    Write-Bad "docker compose failed" "check the output above; .\swiss.ps1 doctor"
    exit 1
  }

  # 4) Wait for the surfaces (OWUI's first boot downloads an embedder - minutes).
  if (Wait-ForCheck 90 { Test-Cockpit }) { Write-Ok "cockpit responding" }
  else { Write-Note "cockpit still starting" ".\swiss.ps1 status in a minute" }
  if (Wait-ForCheck 30 { Test-Owui }) { Write-Ok "open webui responding" }
  else { Write-Note "open webui still starting (first boot is slow)" ".\swiss.ps1 status in a few minutes" }

  Write-Host ""
  Write-Say "Swiss Knife is running"
  Write-Host "   Cockpit:     $CockpitUrl"
  Write-Host "   Open WebUI:  $OwuiUrl"
  Write-Host "   Stop:        .\swiss.ps1 down    Inspect: .\swiss.ps1 status / .\swiss.ps1 doctor"
}

function Invoke-Setup {
  Write-Say "> Swiss Knife setup - install the two prerequisites (Docker Desktop + Ollama)"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Bad "winget isn't available (needed to install the prerequisites)" "install 'App Installer' from the Microsoft Store, then re-run .\swiss setup - or install Docker Desktop and Ollama manually from their sites"
    exit 1
  }

  if (Test-DockerInstalled) {
    Write-Ok "Docker already installed"
  } else {
    Write-Host "  installing Docker Desktop (winget)..."
    winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Bad "Docker Desktop install failed" "install manually: https://www.docker.com/products/docker-desktop/" }
    else { Write-Note "Launch Docker Desktop once to finish its setup (enables the WSL2 backend; it may ask to log out or reboot)" }
  }

  if ((Get-Command ollama -ErrorAction SilentlyContinue) -or (Test-OllamaApp)) {
    Write-Ok "Ollama already installed"
  } else {
    Write-Host "  installing Ollama (winget)..."
    winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Bad "Ollama install failed" "install manually: https://ollama.com/download/windows" }
    else { Write-Note "Open a NEW terminal afterwards so the ollama CLI lands on PATH (swiss up also self-heals this)" }
  }

  Write-Host ""
  if ($script:Fails -eq 0) {
    Write-Say "Setup done. Start everything with: .\swiss up"
  } else {
    Write-Say "Fix the item(s) above, then: .\swiss up"
    exit 1
  }
}

function Invoke-Down {
  Write-Say "> Swiss Knife down"
  if (Test-DockerUp) {
    docker compose down
    if ($LASTEXITCODE -ne 0) {
      Write-Bad "docker compose down failed" "check Docker Desktop and the compose output above"
      exit 1
    }
    Write-Ok "containers stopped & removed (data lives in named volumes)"
  } else {
    Write-Note "Docker isn't running - nothing to stop"
  }
  Write-Host "  The native Ollama app keeps running (it's your system engine) - quit it from the tray icon if you want."
}

function Show-Usage {
  Write-Host @"
Swiss Knife - local AI cockpit (Windows)

  .\swiss setup    one-time: install the prerequisites (Docker Desktop + Ollama)
  .\swiss up       start everything: native Ollama + models + containers
  .\swiss down     stop the containers (native Ollama keeps running)
  .\swiss status   one-line state of engine / cockpit / Open WebUI / Docker
  .\swiss doctor   full preflight: Ollama install, GPU/RAM, models, Docker,
                   surfaces, optional voice deps - with fix-it commands

Quality tier on Windows is gemma4:12b (GGUF). gemma4:12b-mlx is Apple Silicon
only. Default chat model everywhere is gemma4:e4b (light, ~4 GB).
"@
}

switch ($Command.ToLower()) {
  "setup"  { Invoke-Setup }
  "up"     { Invoke-Up }
  "down"   { Invoke-Down }
  "status" { Invoke-Status }
  "doctor" { Invoke-Doctor }
  "help"   { Show-Usage }
  default  {
    Write-Host "unknown command: $Command"
    Write-Host ""
    Show-Usage
    exit 1
  }
}
