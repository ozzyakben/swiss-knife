import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full local-data export: every content model to one JSON file. Settings is
// omitted on purpose (it holds the capture token + OWUI key). Re-importable via
// POST /api/import (upsert by id). The whole pitch is "your data stays on your
// machine" — this is the escape hatch for a new Mac or an engine upgrade.
export async function GET() {
  const [prompts, templates, emails, ideas, tasks, facts, qaSessions, projects, bugs, goldens, adrs] =
    await Promise.all([
      prisma.prompt.findMany(),
      prisma.template.findMany(),
      prisma.emailDraft.findMany(),
      prisma.idea.findMany(),
      prisma.task.findMany(),
      // Trash (soft-deleted) facts are not part of a backup — match every other
      // read site's deletedAt:null contract so deleted data doesn't resurface.
      prisma.memoryFact.findMany({ where: { deletedAt: null } }),
      prisma.qaSession.findMany({ include: { iterations: true } }),
      prisma.project.findMany(),
      prisma.bugReport.findMany(),
      prisma.goldenCase.findMany(),
      prisma.adr.findMany(),
    ]);

  const body = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      prompts: prompts.length,
      templates: templates.length,
      emails: emails.length,
      ideas: ideas.length,
      tasks: tasks.length,
      facts: facts.length,
      qaSessions: qaSessions.length,
      projects: projects.length,
      bugs: bugs.length,
      goldens: goldens.length,
      adrs: adrs.length,
    },
    data: { prompts, templates, emails, ideas, tasks, facts, qaSessions, projects, bugs, goldens, adrs },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="swiss-knife-export.json"`,
    },
  });
}
