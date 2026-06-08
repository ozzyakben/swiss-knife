import { assertOllamaReady } from "@/lib/health";
import { getActiveProjectId } from "@/lib/project";
import { learnFromActivity } from "@/lib/memoryLoop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opt-in: capture candidate facts from the active project's recent activity. */
export async function POST() {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const projectId = await getActiveProjectId();
  try {
    const result = await learnFromActivity(projectId);
    if (result.sources === 0) {
      return Response.json(
        { error: "No recent ideas, QA sessions, or task notes to learn from." },
        { status: 422 }
      );
    }
    if (result.created + result.merges === 0) {
      const msg =
        result.skipped > 0
          ? "Nothing new — recent activity is already captured."
          : "No durable facts found in recent activity.";
      return Response.json({ error: msg }, { status: 422 });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
