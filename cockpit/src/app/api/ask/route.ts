import { assertOllamaReady } from "@/lib/health";
import { chat } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getActiveProjectId } from "@/lib/project";
import { getMemoryContext } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-shot "ask anything" for the command palette — quick Q&A with the active
// project's memory injected, without leaving the keyboard. (Deep chat lives in
// Open WebUI; this is the fast in-app answer.)
export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { q } = (await req.json().catch(() => ({}))) as { q?: string };
  if (!q || !q.trim()) return Response.json({ error: "Ask a question." }, { status: 400 });

  const cfg = await getEffectiveConfig();
  const projectId = await getActiveProjectId();
  const memory = await getMemoryContext({ projectId, query: q.trim() });

  const text = await chat(
    [
      ...(memory ? [{ role: "system" as const, content: memory }] : []),
      { role: "system", content: "Answer concisely and helpfully. If you don't know, say so." },
      { role: "user", content: q.trim() },
    ],
    { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.4 }
  );
  return Response.json({ text: text.trim() });
}
