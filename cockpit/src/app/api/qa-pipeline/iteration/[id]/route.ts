import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import {
  loadProjectQaContext,
  scoreFeature,
  lintFeature,
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

// PATCH — two manual-refine actions on one iteration:
//   { draftFeature }  → save a hand-edit, re-lint deterministically (no model),
//                       and clear the rubric score (now stale → "re-score").
//   { rescore: true } → re-run the rubric (model) on the current draft.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    draftFeature?: string;
    rescore?: boolean;
  };

  if (body.rescore) {
    const it = await prisma.qaIteration.findUnique({
      where: { id },
      select: { id: true, draftFeature: true, session: { select: { projectId: true } } },
    });
    if (!it) return Response.json({ error: "Iteration not found." }, { status: 404 });

    const projectId = it.session.projectId;
    const ctx = await loadProjectQaContext(projectId);
    if (!ctx.hasPack) return Response.json({ projectId, needsPack: true });

    const notReady = await assertOllamaReady();
    if (notReady) return notReady;

    const rubric = await scoreFeature(it.draftFeature, projectId, ctx);
    const updated = await prisma.qaIteration.update({
      where: { id },
      data: { score: rubric },
      select: ITERATION_SELECT,
    });
    return Response.json({ iteration: serializeIteration(updated) });
  }

  if (typeof body.draftFeature === "string" && body.draftFeature.trim()) {
    // Deterministic re-lint of the hand-edited draft; rubric becomes stale.
    const lint = lintFeature(body.draftFeature);
    const updated = await prisma.qaIteration
      .update({
        where: { id },
        data: {
          draftFeature: body.draftFeature,
          lintOk: lint.ok,
          errors: lint.summary.errors,
          warnings: lint.summary.warnings,
          edited: true,
          score: Prisma.DbNull,
        },
        select: ITERATION_SELECT,
      })
      .catch(() => null);
    if (!updated) return Response.json({ error: "Iteration not found." }, { status: 404 });
    return Response.json({ iteration: serializeIteration(updated) });
  }

  return Response.json({ error: "Provide draftFeature or rescore." }, { status: 400 });
}

// DELETE — remove one iteration. If it was the last one, drop the session too.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let sessionId: string;
  try {
    const it = await prisma.qaIteration.delete({ where: { id }, select: { sessionId: true } });
    sessionId = it.sessionId;
  } catch (e) {
    // DELETE is idempotent: an already-gone iteration is a success (the client
    // just filters the row out), matching the session DELETE and the prior
    // contract. Only a genuine DB error is a failure.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ ok: true, sessionDeleted: false });
    }
    return Response.json({ error: "Couldn't delete the iteration." }, { status: 500 });
  }

  const remaining = await prisma.qaIteration.count({ where: { sessionId } });
  if (remaining === 0) {
    // Last iteration removed → drop the now-empty session. Only claim
    // sessionDeleted:true if it actually succeeded.
    try {
      await prisma.qaSession.delete({ where: { id: sessionId } });
      return Response.json({ ok: true, sessionDeleted: true });
    } catch {
      return Response.json({ ok: true, sessionDeleted: false });
    }
  }
  return Response.json({ ok: true, sessionDeleted: false });
}
