import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import { isRoutine, runRoutine, ROUTINES } from "@/lib/routines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function configuredToken(): Promise<string | null> {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  return s?.captureToken || null;
}

// Token-authed, headless routine runner (same token as quick-capture), so a
// scheduled macOS Shortcut can fire `standup`/`wrapup` with no clicks.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const configured = await configuredToken();
  if (!configured) {
    return Response.json({ error: "Set a capture token in Settings first." }, { status: 400 });
  }
  const provided = req.headers.get("x-capture-token") || new URL(req.url).searchParams.get("token");
  if (provided !== configured) {
    return Response.json({ error: "Invalid token." }, { status: 401 });
  }
  if (!isRoutine(slug)) {
    return Response.json({ error: `Unknown routine "${slug}". Available: ${ROUTINES.join(", ")}.` }, { status: 404 });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  try {
    const result = await runRoutine(slug);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Routine failed." }, { status: 500 });
  }
}
