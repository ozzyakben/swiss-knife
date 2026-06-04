import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.emailDraft.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Draft not found." }, { status: 404 });
  }
}
