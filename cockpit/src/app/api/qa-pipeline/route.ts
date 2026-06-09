import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import { getActiveProjectId } from "@/lib/project";
import { logActivity } from "@/lib/activity";
import {
  loadProjectQaContext,
  runFreshIteration,
  serializeSession,
  deriveTitle,
  type RubricScore,
} from "@/lib/qaPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITERATION_SELECT = {
  id: true,
  order: true,
  instruction: true,
  draftFeature: true,
  score: true,
  edited: true,
  createdAt: true,
} as const;

// GET — list saved sessions for the active project (summary only; the detail
// route returns full iterations).
export async function GET() {
  const projectId = await getActiveProjectId();
  const rows = await prisma.qaSession.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { iterations: true } },
      iterations: {
        orderBy: { order: "desc" },
        take: 1,
        select: { order: true, lintOk: true, errors: true, warnings: true, score: true },
      },
    },
  });

  const sessions = rows.map((s) => {
    const latest = s.iterations[0];
    const verdict = (latest?.score as RubricScore | null)?.verdict ?? null;
    return {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      iterationCount: s._count.iterations,
      latest: latest
        ? { order: latest.order, lintOk: latest.lintOk, errors: latest.errors, warnings: latest.warnings, verdict }
        : null,
    };
  });

  return Response.json({ projectId, sessions });
}

// POST — start a NEW session from a story: draft → lint → score → save as
// iteration 1. A project with no QA pack returns { needsPack: true } (a 200,
// not a degraded run).
export async function POST(req: Request) {
  const { input } = (await req.json().catch(() => ({}))) as { input?: string };
  if (!input || typeof input !== "string" || !input.trim()) {
    return Response.json({ error: "Paste a user story to run." }, { status: 400 });
  }

  // cookies() is async in Next 15; resolve in handler scope.
  const projectId = await getActiveProjectId();

  // Pack check is DB-only (no model) — do it before the health gate so a no-pack
  // project gets the empty state even when Ollama is down, rather than a 503.
  const ctx = await loadProjectQaContext(projectId);
  if (!ctx.hasPack) {
    return Response.json({ projectId, needsPack: true });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  let iteration;
  try {
    iteration = await runFreshIteration(input, projectId, ctx);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "QA run failed." }, { status: 500 });
  }
  const { draftFeature, lint, rubric } = iteration;

  const session = await prisma.qaSession.create({
    data: {
      title: deriveTitle(input),
      story: input,
      projectId,
      iterations: {
        create: {
          order: 1,
          draftFeature,
          lintOk: lint.ok,
          errors: lint.summary.errors,
          warnings: lint.summary.warnings,
          score: rubric,
        },
      },
    },
    select: {
      id: true,
      title: true,
      story: true,
      projectId: true,
      createdAt: true,
      updatedAt: true,
      iterations: { orderBy: { order: "asc" }, select: ITERATION_SELECT },
    },
  });

  await logActivity({
    entity: "qa",
    action: "ran",
    summary: `QA session: ${session.title}`,
    projectId,
  });
  return Response.json({ projectId, needsPack: false, session: serializeSession(session) });
}
