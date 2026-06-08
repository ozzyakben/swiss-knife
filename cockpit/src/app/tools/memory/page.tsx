import { prisma } from "@/lib/db";
import { MemoryManager } from "@/components/memory/MemoryManager";
import { archiveStaleFacts } from "@/lib/memoryLoop";
import { getActiveProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  // Decay runs on load (auto-archive policy): conservative + reversible.
  await archiveStaleFacts().catch(() => 0);

  const activeProjectId = await getActiveProjectId();
  const [rows, projects] = await Promise.all([
    prisma.memoryFact
      .findMany({
        where: { status: { not: "dismissed" } },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        include: {
          project: { select: { name: true } },
          mergedInto: { select: { value: true } },
        },
      })
      .catch(() => []),
    prisma.project
      .findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      .catch(() => []),
  ]);

  // Map server rows → client DTOs. The embedding blob stays server-side; the
  // client only needs to know whether a fact is indexed.
  const facts = rows.map((f) => ({
    id: f.id,
    key: f.key,
    value: f.value,
    source: f.source,
    status: f.status,
    pinned: f.pinned,
    category: f.category,
    projectId: f.projectId,
    projectName: f.project?.name ?? null,
    indexed: Boolean(f.embedding),
    mergedIntoId: f.mergedIntoId,
    mergedIntoValue: f.mergedInto?.value ?? null,
  }));

  return <MemoryManager facts={facts} projects={projects} activeProjectId={activeProjectId} />;
}
