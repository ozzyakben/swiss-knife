// Curated local-engine model tiers + helpers, shared by the /api/models route
// and the Settings model picker. The point of the tiers: trade output quality
// for RAM. Running the full Docker stack (Open WebUI) next to a 12B model can
// nearly fill 48 GB, so a light "effective-4B" model keeps headroom.

export type ModelTier = "ultra-light" | "light" | "quality" | "embedding";

export type ModelPreset = {
  tag: string;
  label: string;
  tier: ModelTier;
  /** Approximate resident RAM when loaded (Q4-class build). Not the disk size. */
  ramHint: string;
  note: string;
};

// Ordered light → heavy. RAM figures are approximate; "E2B/E4B" are Gemma's
// effective-parameter builds (actual 5B/8B params, but run at ~2B/4B memory
// load via per-layer-embedding caching), so they cost far less RAM than 12B.
export const MODEL_PRESETS: ModelPreset[] = [
  {
    tag: "gemma4:e2b",
    label: "Gemma 4 E2B — ultra-light",
    tier: "ultra-light",
    ramHint: "~2 GB",
    note: "Lowest RAM. Weakest output; fine for quick cleanup and summaries.",
  },
  {
    tag: "gemma4:e4b",
    label: "Gemma 4 E4B — light",
    tier: "light",
    ramHint: "~4 GB",
    note: "Effective-4B. Best pick when Open WebUI / Docker runs alongside.",
  },
  {
    tag: "gemma4:12b-mlx",
    label: "Gemma 4 12B (MLX) — quality, Mac only",
    tier: "quality",
    ramHint: "~10–14 GB",
    note: "Best output. APPLE SILICON ONLY (MLX) — on Windows/Linux pick gemma4:12b. Heavy if Docker is also up.",
  },
  {
    tag: "gemma4:12b",
    label: "Gemma 4 12B (GGUF) — quality",
    tier: "quality",
    ramHint: "~10–14 GB",
    note: "Best output on Windows/Linux (GGUF runs everywhere). Heavy if Docker is also up.",
  },
];

export const PRESET_BY_TAG: Record<string, ModelPreset> = Object.fromEntries(
  MODEL_PRESETS.map((p) => [p.tag, p])
);

/** Heuristic: an embedding model, not a chat model (hide from the chat picker). */
export function isEmbeddingTag(tag: string): boolean {
  return /embed/i.test(tag);
}

/** Bytes → a short human label ("9.6 GB", "512 MB"). Empty for falsy/zero. */
export function formatBytes(n?: number): string {
  if (!n || n <= 0) return "";
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / 1024 ** 2;
  return `${Math.round(mb)} MB`;
}
