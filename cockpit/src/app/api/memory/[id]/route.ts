import { prisma } from "@/lib/db";
import { applyMerge } from "@/lib/memoryLoop";

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
  };

  // Accepting a merge proposal applies the consolidated wording to the surviving
  // active fact and drops the proposal. This is the only path that edits an
  // existing active fact, and it runs only on an explicit accept.
  if (body.status === "active") {
    const fact = await prisma.memoryFact
      .findUnique({ where: { id }, select: { id: true, value: true, mergedIntoId: true } })
      .catch(() => null);
    if (fact?.mergedIntoId) {
      try {
        await applyMerge(fact.id, fact.mergedIntoId, fact.value);
        return Response.json({ merged: true, targetId: fact.mergedIntoId });
      } catch {
        return Response.json({ error: "Merge target no longer exists." }, { status: 404 });
      }
    }
  }

  const data: Record<string, unknown> = {};
  if (STATUS.includes(body.status ?? "")) data.status = body.status;
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.value === "string") data.value = body.value.trim();
  if (typeof body.key === "string") data.key = body.key.trim() || null;

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const fact = await prisma.memoryFact.update({ where: { id }, data });
    return Response.json({ fact });
  } catch {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.memoryFact.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Fact not found." }, { status: 404 });
  }
}
