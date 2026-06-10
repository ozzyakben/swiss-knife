# Pull the Swiss Knife model tiers on Windows. Mirrors scripts/pull-models.sh,
# with ONE deliberate difference: the quality tier is gemma4:12b (GGUF) -
# gemma4:12b-mlx is MLX = Apple Silicon ONLY and will not run on Windows.
#
#   QUALITY - best output, heavier (~10-14 GB RAM); needs a decent GPU or patience
#   LIGHT   - Gemma "effective-4B"; much lighter (~4 GB). The default everywhere,
#             and the right pick when Docker (Open WebUI) runs alongside.
$ErrorActionPreference = "Stop"

$Quality = if ($env:OLLAMA_MODEL)       { $env:OLLAMA_MODEL }       else { "gemma4:12b" }
$Light   = if ($env:OLLAMA_LIGHT_MODEL) { $env:OLLAMA_LIGHT_MODEL } else { "gemma4:e4b" }
$Embed   = if ($env:EMBED_MODEL)        { $env:EMBED_MODEL }        else { "embeddinggemma" }

if ($Quality -like "*mlx*") {
  Write-Host "OLLAMA_MODEL=$Quality is an MLX build - Apple Silicon only. Using gemma4:12b instead." -ForegroundColor Yellow
  $Quality = "gemma4:12b"
}

# LIGHT first: it's the default the app actually needs. A failed QUALITY pull
# (typo'd tag) must never strand a machine with zero usable models, so QUALITY
# pulls last and soft-fails.
Write-Host "Pulling chat model: $Light"
ollama pull $Light
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to pull $Light" -ForegroundColor Red; exit 1 }

Write-Host "Pulling embedding model (for memory ranking + Open WebUI RAG): $Embed"
ollama pull $Embed
if ($LASTEXITCODE -ne 0) { Write-Host "  (embedding model optional for now - skipping)" -ForegroundColor Yellow }

if ($Quality -ne $Light) {
  Write-Host "Pulling quality chat model: $Quality"
  ollama pull $Quality
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  (quality tier failed to pull - the light tier still works; run 'ollama pull $Quality' later)" -ForegroundColor Yellow
  }
}
exit 0
