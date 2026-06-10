import { getEffectiveConfig } from "@/lib/config";

export type Health =
  | { ok: true; model: string; baseUrl: string }
  | {
      ok: false;
      reason: "ollama_down" | "model_missing";
      model: string;
      baseUrl: string;
      detail?: string;
    };

/** Strip the trailing /v1 from the OpenAI-compatible base to reach native Ollama. */
function nativeRoot(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * Probe the native Ollama: is it up, and is the model pulled? Defaults to the
 * configured chat model; pass an override for routes that run on a DIFFERENT
 * model (qaModel, visionModel) — a typo'd override used to pass the gate and
 * then die mid-run with a raw engine error.
 */
export async function checkHealth(modelOverride?: string): Promise<Health> {
  const cfg = await getEffectiveConfig();
  const model = modelOverride ?? cfg.model;
  const baseUrl = cfg.baseUrl;
  const tagsUrl = `${nativeRoot(baseUrl)}/api/tags`;
  try {
    const res = await fetch(tagsUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000), // fail fast if the engine is down
    });
    if (!res.ok) {
      return { ok: false, reason: "ollama_down", model, baseUrl, detail: `status ${res.status}` };
    }
    const data = await res.json();
    const names: string[] = (data?.models ?? []).map(
      (m: { name?: string; model?: string }) => m.name ?? m.model ?? ""
    );
    const pulled = names.some(
      (n) => n === model || n === `${model}:latest` || n.replace(/:latest$/, "") === model
    );
    return pulled ? { ok: true, model, baseUrl } : { ok: false, reason: "model_missing", model, baseUrl };
  } catch (e) {
    return {
      ok: false,
      reason: "ollama_down",
      model,
      baseUrl,
      detail: e instanceof Error ? e.message : "unreachable",
    };
  }
}

/** Route guard: returns a ready-to-send 503 Response when not healthy, else null. */
export async function assertOllamaReady(modelOverride?: string): Promise<Response | null> {
  const h = await checkHealth(modelOverride);
  if (h.ok) return null;
  const msg =
    h.reason === "ollama_down"
      ? "Ollama isn't running. Start the Ollama app (macOS: open -a Ollama · Windows: launch Ollama from the Start menu) and try again."
      : `Model "${h.model}" isn't pulled. Run: ollama pull ${h.model}`;
  return Response.json({ error: msg, reason: h.reason }, { status: 503 });
}
