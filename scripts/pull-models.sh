#!/usr/bin/env bash
set -e
# Two chat tiers so you can trade output quality for RAM (switch live in the
# cockpit: Settings → Model):
#   QUALITY — best output, heavier (~10-14 GB RAM)
#   LIGHT   — Gemma "effective-4B"; much lighter (~4 GB). Pick this when the
#             full Docker stack (Open WebUI) is also running, so a 12B model +
#             containers don't nearly fill 48 GB of RAM.
#
# Platform note: the MLX quality build (gemma4:12b-mlx) is APPLE SILICON ONLY.
# Everywhere else the quality tier is the GGUF gemma4:12b. Windows users:
# scripts/pull-models.ps1 is the native equivalent of this script.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) DEFAULT_QUALITY="gemma4:12b-mlx" ;;
  *)            DEFAULT_QUALITY="gemma4:12b" ;;
esac
QUALITY="${OLLAMA_MODEL:-$DEFAULT_QUALITY}"
LIGHT="${OLLAMA_LIGHT_MODEL:-gemma4:e4b}"
EMBED="${EMBED_MODEL:-embeddinggemma}"

# LIGHT first: it's the default the app actually needs. A failed QUALITY pull
# (typo'd tag, MLX on the wrong platform) must never strand a machine with
# zero usable models, so QUALITY is pulled last and soft-fails.
echo "Pulling chat model: $LIGHT"
ollama pull "$LIGHT"

echo "Pulling embedding model (for memory ranking + Open WebUI RAG): $EMBED"
ollama pull "$EMBED" || echo "  (embedding model optional for now — skipping)"

if [ "$QUALITY" != "$LIGHT" ]; then
  echo "Pulling quality chat model: $QUALITY"
  ollama pull "$QUALITY" || echo "  (quality tier failed to pull — the light tier still works; run 'ollama pull $QUALITY' later)"
fi
