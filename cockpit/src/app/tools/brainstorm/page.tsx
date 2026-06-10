import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { Brainstorm } from "@/components/brainstorm/Brainstorm";
import { RecentItems } from "@/components/RecentItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BrainstormPage({
  searchParams,
}: {
  searchParams: Promise<{ ideaId?: string }>;
}) {
  const { ideaId } = await searchParams;
  const projectId = await getActiveProjectId();
  // Active project + global, like every other scoped surface — with five
  // producers writing Ideas this was becoming a mixed global feed.
  const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
  const [techniqueRows, ideaRows] = await Promise.all([
    prisma.template
      .findMany({ where: { kind: "technique", archived: false }, orderBy: { name: "asc" } })
      .catch(() => []),
    prisma.idea
      .findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { project: { select: { name: true } } },
      })
      .catch(() => []),
  ]);

  // The ⌘K deep link may point at an idea outside the recent slice (or another
  // project) — fetch it explicitly so the link never lands on a list without it.
  let ideaList = ideaRows;
  if (ideaId && !ideaRows.some((r) => r.id === ideaId)) {
    const extra = await prisma.idea
      .findUnique({ where: { id: ideaId }, include: { project: { select: { name: true } } } })
      .catch(() => null);
    if (extra) ideaList = [extra, ...ideaList];
  }

  const techniques = techniqueRows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    variables: t.variables,
  }));

  const ideas = ideaList.map((i) => ({
    id: i.id,
    title: i.title || i.topic || "Idea",
    badges: i.techniqueKind ? [i.techniqueKind] : [],
    body: i.content,
    project: i.project?.name ?? null,
    editValues: { title: i.title ?? "", content: i.content, tags: i.tags ?? "" },
  }));

  return (
    <div className="max-w-3xl">
      <Brainstorm techniques={techniques} />
      <RecentItems
        heading="Recent ideas"
        items={ideas}
        deleteBase="/api/ideas"
        editBase="/api/ideas"
        searchable
        highlightId={ideaId ?? null}
        editFields={[
          { key: "title", label: "Title" },
          { key: "content", label: "Content", multiline: true },
          { key: "tags", label: "Tags (comma-separated)" },
        ]}
      />
    </div>
  );
}
