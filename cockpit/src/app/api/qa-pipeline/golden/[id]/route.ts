import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relabel a golden case — the human is the labeler, and a mislabeled golden
// permanently skews the bench's agreement %.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { expectedVerdict } = (await req.json().catch(() => ({}))) as { expectedVerdict?: string };
  if (!["PASS", "BLOCK"].includes(expectedVerdict ?? "")) {
    return Response.json({ error: "expectedVerdict must be PASS or BLOCK." }, { status: 400 });
  }
  try {
    const c = await prisma.goldenCase.update({
      where: { id },
      data: { expectedVerdict: expectedVerdict as string },
      select: { id: true, expectedVerdict: true },
    });
    return Response.json(c);
  } catch (e) {
    // Only "no such row" is a 404; a real DB error mid-relabel must not read
    // as the case not existing (a silently failed relabel skews the bench).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Golden case not found." }, { status: 404 });
    }
    return Response.json({ error: "Couldn't relabel the golden case." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.goldenCase.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    // Already gone is idempotent success; a real DB error is not.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Couldn't delete the golden case." }, { status: 500 });
  }
}
