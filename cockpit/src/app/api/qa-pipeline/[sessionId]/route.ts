import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import {
  loadProjectQaContext,
  runFollowUpIteration,
  serializeSession,
  serializeIteration,
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

const SESSION_SELECT = {
  id: true,
  title: true,
  story: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  iterations: { orderBy: { order: "asc" as const }, select: ITERATION_SELECT },
} as const;

// GET — a full session with its ordered iteration timeline.
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await prisma.qaSession.findUnique({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
  return Response.json({ session: serializeSession(session) });
}

// POST — append a model follow-up iteration: revise the latest draft against the
// instruction, then lint + score, and save as the next iteration.
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { instruction } = (await req.json().catch(() => ({}))) as { instruction?: string };
  if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
    return Response.json({ error: "Describe what to change." }, { status: 400 });
  }

  const session = await prisma.qaSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      story: true,
      projectId: true,
      iterations: { orderBy: { order: "desc" }, take: 1, select: { order: true, draftFeature: true } },
    },
  });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  const ctx = await loadProjectQaContext(session.projectId);
  if (!ctx.hasPack) return Response.json({ projectId: session.projectId, needsPack: true });

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const previous = session.iterations[0];
  const previousDraft = previous?.draftFeature ?? "";
  const nextOrder = (previous?.order ?? 0) + 1;

  const { draftFeature, lint, rubric } = await runFollowUpIteration(
    session.story,
    previousDraft,
    instruction,
    session.projectId,
    ctx
  );

  const iteration = await prisma.qaIteration.create({
    data: {
      sessionId,
      order: nextOrder,
      instruction,
      draftFeature,
      lintOk: lint.ok,
      errors: lint.summary.errors,
      warnings: lint.summary.warnings,
      score: rubric,
    },
    select: ITERATION_SELECT,
  });
  // Bump the session so it sorts to the top of the history list.
  await prisma.qaSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });

  return Response.json({ needsPack: false, iteration: serializeIteration(iteration) });
}

// PATCH — rename the session.
export async function PATCH(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  if (!title || typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "Title can't be empty." }, { status: 400 });
  }
  const session = await prisma.qaSession
    .update({ where: { id: sessionId }, data: { title: title.trim() }, select: { id: true, title: true } })
    .catch(() => null);
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
  return Response.json({ ok: true, ...session });
}

// DELETE — remove the session (iterations cascade).
export async function DELETE(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    await prisma.qaSession.delete({ where: { id: sessionId } });
    return Response.json({ ok: true });
  } catch (e) {
    // Already gone is an idempotent success; a real DB error is not (don't claim
    // the delete worked when it didn't — the sibling routes do the same).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Couldn't delete the session." }, { status: 500 });
  }
}
