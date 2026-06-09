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

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const status of STATUSES) {
    const ids = Array.isArray(columns[status]) ? columns[status] : [];
    ids.forEach((id, index) => {
      updates.push(
        prisma.task.update({
          where: { id },
          data: { status, order: index, completedAt: status === "done" ? new Date() : null },
        })
      );
    });
  }

  // Atomic: the whole board layout commits or none of it does. A failed write
  // (e.g. a task deleted elsewhere) now surfaces as a 500 instead of a silent
  // partial save reported as success — the client resyncs from the DB.
  try {
    await prisma.$transaction(updates);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Couldn't save the board layout." }, { status: 500 });
  }
}
