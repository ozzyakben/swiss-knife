import { assertOllamaReady } from "@/lib/health";
import { getActiveProjectId } from "@/lib/project";
import { learnFromText } from "@/lib/memoryLoop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capture → classify → dedupe → consolidate: turn pasted text into reviewable
 * candidate facts (and merge proposals) for the active project. Writes are all
 * pending; nothing enters active memory without a human accept.
 */
export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Paste some text to learn from." }, { status: 400 });
  }

  const projectId = await getActiveProjectId();
  try {
    const result = await learnFromText({ text: text.trim(), projectId });
    if (result.created + result.merges === 0) {
      const msg = result.skipped > 0 ? "Those facts are already in your queue." : "No new facts found in that text.";
      return Response.json({ error: msg }, { status: 422 });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Learn failed." }, { status: 500 });
  }
}
