import { assertOllamaReady } from "@/lib/health";
import { streamTextResponse } from "@/lib/ai/streamRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are a prompt engineering assistant. Rewrite the user's prompt to be
clearer, more specific, and more effective for an LLM. Preserve intent. Add structure
(role, task, constraints, output format) where helpful. Return ONLY the improved prompt,
no preamble or explanation.`;

// Generation only — persisting happens AFTER the user reviews the result, via
// POST /api/prompts (the save-after-run path). The old request-time save flag
// committed before any output existed.
export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Missing 'prompt'." }, { status: 400 });
  }

  return streamTextResponse({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });
}
