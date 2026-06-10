import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import { getActiveProjectId } from "@/lib/project";
import { EMPTY_BOARD_ERROR, isRoutine, runRoutine, ROUTINES } from "@/lib/routines";
import { readCaptureToken, tokenMatches } from "@/lib/captureAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function configuredToken(): Promise<string | null> {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  return s?.captureToken || null;
}

// Token-authed, headless routine runner (same token as quick-capture), so a
// scheduled macOS Shortcut — or a Windows Task Scheduler job running
// `Invoke-RestMethod` with the x-capture-token header — can fire
// `standup`/`wrapup` with no clicks.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const configured = await configuredToken();
  if (!configured) {
    return Response.json({ error: "Set a capture token in Settings first." }, { status: 400 });
  }
  if (!tokenMatches(readCaptureToken(req), configured)) {
    return Response.json({ error: "Invalid token." }, { status: 401 });
  }
  if (!isRoutine(slug)) {
    return Response.json({ error: `Unknown routine "${slug}". Available: ${ROUTINES.join(", ")}.` }, { status: 404 });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  try {
    // Browser-initiated runs (the palette) carry the active-project cookie and
    // scope the routine; headless Shortcut calls have no cookie → global.
    const projectId = await getActiveProjectId();
    const result = await runRoutine(slug, projectId);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Routine failed.";
    // An empty board is a user state (same 400 as /api/tasks/standup), not a server error.
    return Response.json({ error: message }, { status: message === EMPTY_BOARD_ERROR ? 400 : 500 });
  }
}
