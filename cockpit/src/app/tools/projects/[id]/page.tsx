import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { ProjectHubEditor } from "@/components/projects/ProjectHubEditor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {items.slice(0, 8).map((t, i) => (
              <li key={i} className="line-clamp-1">
                • {t}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Previews are take:8 (what Section renders); headers show TRUE totals from
  // _count — the old code rendered a capped array length as the total and
  // loaded every row (all 222 pack tasks) to display eight.
  const project = await prisma.project
    .findUnique({
      where: { id },
      include: {
        prompts: { orderBy: { createdAt: "desc" }, take: 8 },
        tasks: { orderBy: { order: "asc" }, take: 8 },
        ideas: { orderBy: { createdAt: "desc" }, take: 8 },
        emails: { orderBy: { createdAt: "desc" }, take: 8 },
        // Active facts only — pending/archived/dismissed and soft-deleted
        // (Trash) rows must not resurface here (the 12-site deletedAt contract).
        facts: { where: { status: "active", deletedAt: null }, orderBy: { createdAt: "desc" }, take: 8 },
        _count: {
          select: {
            prompts: true,
            tasks: true,
            ideas: true,
            emails: true,
            facts: { where: { status: "active", deletedAt: null } },
          },
        },
      },
    })
    .catch(() => null);

  if (!project) notFound();

  return (
    <div className="max-w-4xl">
      <ProjectHubEditor
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          owuiUrl: project.owuiUrl,
        }}
      />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title={`Prompts (${project._count.prompts})`} items={project.prompts.map((p) => p.title)} />
        <Section
          title={`Tasks (${project._count.tasks})`}
          items={project.tasks.map((t) => `${t.title} · ${t.status}`)}
        />
        <Section title={`Ideas (${project._count.ideas})`} items={project.ideas.map((i) => i.title || i.topic)} />
        <Section
          title={`Drafts (${project._count.emails})`}
          items={project.emails.map((e) => e.title || "Untitled draft")}
        />
        <Section title={`Memory (${project._count.facts})`} items={project.facts.map((f) => f.value)} />
      </div>
    </div>
  );
}
