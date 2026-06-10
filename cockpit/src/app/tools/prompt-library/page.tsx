import { prisma } from "@/lib/db";
import { PromptLibrary } from "@/components/library/PromptLibrary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PromptLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [promptRows, templateRows] = await Promise.all([
    prisma.prompt
      .findMany({
        orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
        include: { project: { select: { name: true } } },
      })
      .catch(() => []),
    prisma.template
      .findMany({ where: { kind: "prompt", archived: false }, orderBy: { name: "asc" } })
      .catch(() => []),
  ]);

  const prompts = promptRows.map((p) => ({
    id: p.id,
    title: p.title,
    original: p.original,
    optimized: p.optimized,
    tags: p.tags,
    favorite: p.favorite,
    source: p.source,
    project: p.project?.name ?? null,
  }));

  const templates = templateRows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    variables: t.variables,
    body: t.body,
    builtin: t.builtin,
  }));

  return <PromptLibrary prompts={prompts} templates={templates} initialQuery={q ?? ""} />;
}
