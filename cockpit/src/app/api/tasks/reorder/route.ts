import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["todo", "doing", "done"] as const;

/**
 * Persist a full board layout after a drag. Body: { columns: { todo: id[], doing: id[], done: id[] } }.
 * Each task gets its column's status and its index as the order; completedAt is
 * set when in done and cleared otherwise.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { columns?: Record<string, string[]> };
  const columns = body.columns;
  if (!columns || typeof columns !== "object") {
    return Response.json({ error: "Expected { columns }." }, { status: 400 });
  }

  // Drop ids that no longer exist (e.g. a task deleted in another tab) so a
  // benign race doesn't roll back the whole drag; the remaining real moves still
  // persist atomically.
  const allIds = STATUSES.flatMap((s) => (Array.isArray(columns[s]) ? columns[s] : []));
  const known = new Set(
    (await prisma.task.findMany({ where: { id: { in: allIds } }, select: { id: true } })).map((t) => t.id)
  );

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const status of STATUSES) {
    const ids = (Array.isArray(columns[status]) ? columns[status] : []).filter((id) => known.has(id));
    ids.forEach((id, index) => {
      updates.push(
        prisma.task.update({
          where: { id },
          data: { status, order: index, completedAt: status === "done" ? new Date() : null },
        })
      );
    });
  }

  // Atomic: the real moves all commit or none do. A genuine DB error surfaces as
  // a 500 (the client shows an error toast) instead of a silent partial save
  // reported as success.
  try {
    await prisma.$transaction(updates);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Couldn't save the board layout." }, { status: 500 });
  }
}
