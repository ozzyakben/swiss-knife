import { prisma } from "@/lib/db";
import { Brainstorm } from "@/components/brainstorm/Brainstorm";
import { RecentItems } from "@/components/RecentItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BrainstormPage() {
  const [techniqueRows, ideaRows] = await Promise.all([
    prisma.template
      .findMany({ where: { kind: "technique", archived: false }, orderBy: { name: "asc" } })
      .catch(() => []),
    prisma.idea.findMany({ orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
  ]);

  const techniques = techniqueRows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    variables: t.variables,
  }));

  const ideas = ideaRows.map((i) => ({
    id: i.id,
    title: i.title || i.topic || "Idea",
    badges: i.techniqueKind ? [i.techniqueKind] : [],
    body: i.content,
  }));

  return (
    <div className="max-w-3xl">
      <Brainstorm techniques={techniques} />
      <RecentItems heading="Recent ideas" items={ideas} deleteBase="/api/ideas" />
    </div>
  );
}
