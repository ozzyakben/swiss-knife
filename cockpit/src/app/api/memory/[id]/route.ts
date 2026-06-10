import { prisma } from "@/lib/db";
import { applyMerge } from "@/lib/memoryLoop";
import { embedDocuments, serializeVector } from "@/lib/embeddings";
import { normalizeCategory } from "@/lib/memory";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS = ["active", "pending", "dismissed", "archived"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    pinned?: boolean;
    value?: string;
    key?: string;
    category?: string;
    projectId?: string | null;
    restore?: boolean;
  };

  // Restore from Trash: clear the soft-delete marker.
  if (body.restore) {
    try {
      const fact = await prisma.memoryFact.update({ where: { id }, data: { deletedAt: null } });
      return Response.json({ fact });
    } catch {
      return Response.json({ error: "Fact not found." }, { status: 404 });
    }
  }

  // Accepting a merge proposal applies the consolidated wording to the surviving
  // active fact and drops the proposal. This is the only path that edits an
  // existing active fact, and it runs only on an explicit accept.
  if (body.status === "active") {
    // deletedAt:null — a trashed proposal was already rejected by the human;
    // accepting it would edit an active fact and hard-delete a restorable row.
    const fact = await prisma.memoryFact
      .findFirst({ where: { id, deletedAt: null }, select: { id: true, value: true, mergedIntoId: true, projectId: true } })
      .catch(() => null);
    if (fact?.mergedIntoId) {
      try {
        await applyMerge(fact.id, fact.mergedIntoId, fact.value);
        await logActivity({
          entity: "fact",
          action: "merge-accepted",
          summary: fact.value.slice(0, 120),
          projectId: fact.projectId,
        });
        return Response.json({ merged: true, targetId: fact.mergedIntoId });
      } catch {
        return Response.json({ error: "Merge target no longer exists." }, { status: 404 });
      }
    }
  }

  const data: Record<string, unknown> = {};
  if (STATUS.includes(body.status ?? "")) data.status = body.status;
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.value === "string") {
    const value = body.value.trim();
    // POST rejects empty facts; PATCH must too — a blanked value would also
    // skip the re-embed below and keep ranking the fact by its old meaning.
    if (!value) return Response.json({ error: "Value can't be empty." }, { status: 400 });
    data.value = value;
  }
  if (typeof body.key === "string") data.key = body.key.trim() || null;
  if (typeof body.category === "string") data.category = normalizeCategory(body.category);
  if ("projectId" in body) {
    if (body.projectId === null) {
      data.projectId = null;
    } else if (typeof body.projectId === "string") {
      const exists = await prisma.project
        .findUnique({ where: { id: body.projectId }, select: { id: true } })
        .catch(() => null);
      if (!exists) return Response.json({ error: "Project not found." }, { status: 400 });
      data.projectId = body.projectId;
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  // An edited fact must rank by its NEW meaning: re-embed on value change.
  // On embed failure store null so Reindex (which only scans embedding:null)
  // can pick it up later — never leave the stale vector in place.
  if (typeof data.value === "string" && data.value) {
    try {
      const [v] = await embedDocuments([data.value]);
      data.embedding = serializeVector(v);
    } catch {
      data.embedding = null;
    }
  }

  // "accepted" must mean the pending → active flip specifically — the Archived
  // section's restore button also sends {status:"active"}.
  let wasPending = false;
  if (data.status === "active") {
    const prev = await prisma.memoryFact.findUnique({ where: { id }, select: { status: true } }).catch(() => null);
    wasPending = prev?.status === "pending";
  }

  // Guard against soft-deleted rows: a generic PATCH must not silently
  // re-status a fact that's sitting in the Trash (only `restore` targets those).
  const updated = await prisma.memoryFact
    .updateMany({ where: { id, deletedAt: null }, data })
    .catch(() => ({ count: 0 }));
  if (updated.count === 0) {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }
  const fact = await prisma.memoryFact.findUnique({ where: { id } });
  // A pending → active flip is the human accept — the loop's key event.
  if (data.status === "active" && wasPending && fact) {
    await logActivity({
      entity: "fact",
      action: "accepted",
      summary: fact.value.slice(0, 120),
      projectId: fact.projectId,
    });
  }
  return Response.json({ fact });
}

// Soft-delete by default (moves to Trash, restorable). `?purge=true` removes it
// permanently — used by the Trash "delete forever" action.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const purge = new URL(req.url).searchParams.get("purge") === "true";
  try {
    if (purge) {
      await prisma.memoryFact.delete({ where: { id } });
    } else {
      await prisma.memoryFact.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }
}
