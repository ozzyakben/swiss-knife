import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { embedDocuments, serializeVector } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const facts = await prisma.memoryFact
    .findMany({ where: { deletedAt: null }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] })
    .catch(() => []);
  return Response.json({ facts });
}

export async function POST(req: Request) {
  const { key, value } = (await req.json().catch(() => ({}))) as { key?: string; value?: string };
  if (!value || typeof value !== "string" || !value.trim()) {
    return Response.json({ error: "A fact needs a value." }, { status: 400 });
  }
  const projectId = await getActiveProjectId();
  // Embed at create (best-effort) so manual facts relevance-rank immediately
  // instead of waiting for a manual Reindex; null degrades to the reindex path.
  let embedding: string | null = null;
  try {
    const [v] = await embedDocuments([value.trim()]);
    embedding = serializeVector(v);
  } catch {
    embedding = null;
  }
  const fact = await prisma.memoryFact.create({
    data: {
      key: typeof key === "string" && key.trim() ? key.trim() : null,
      value: value.trim(),
      source: "manual",
      status: "active",
      projectId,
      embedding,
    },
  });
  return Response.json({ fact });
}
