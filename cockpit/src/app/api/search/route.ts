import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SearchResult = {
  type: "Prompt" | "Idea" | "Task" | "Fact" | "Email" | "QA";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

// One deterministic, local-only search across every content type. SQLite LIKE
// (Prisma `contains`) is case-insensitive for ASCII, which is plenty here.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const take = 6;

  const [prompts, ideas, tasks, facts, emails, sessions] = await Promise.all([
    prisma.prompt
      .findMany({
        where: { OR: [{ title: { contains: q } }, { original: { contains: q } }, { optimized: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true },
      })
      .catch(() => []),
    prisma.idea
      .findMany({
        where: { OR: [{ title: { contains: q } }, { topic: { contains: q } }, { content: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, topic: true },
      })
      .catch(() => []),
    prisma.task
      .findMany({
        where: { OR: [{ title: { contains: q } }, { notes: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, status: true },
      })
      .catch(() => []),
    prisma.memoryFact
      .findMany({
        where: { status: "active", deletedAt: null, OR: [{ key: { contains: q } }, { value: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, key: true, value: true },
      })
      .catch(() => []),
    prisma.emailDraft
      .findMany({
        where: { OR: [{ title: { contains: q } }, { brief: { contains: q } }, { body: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, brief: true },
      })
      .catch(() => []),
    prisma.qaSession
      .findMany({
        where: { OR: [{ title: { contains: q } }, { story: { contains: q } }] },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true },
      })
      .catch(() => []),
  ]);

  const results: SearchResult[] = [
    ...prompts.map((p) => ({ type: "Prompt" as const, id: p.id, title: p.title || "Untitled prompt", href: "/tools/prompt-library" })),
    ...ideas.map((i) => ({ type: "Idea" as const, id: i.id, title: i.title || i.topic || "Idea", href: "/tools/brainstorm" })),
    ...tasks.map((t) => ({ type: "Task" as const, id: t.id, title: t.title, subtitle: t.status, href: "/tools/tasks" })),
    ...facts.map((f) => ({
      type: "Fact" as const,
      id: f.id,
      title: f.key || f.value.slice(0, 70),
      subtitle: f.key ? f.value.slice(0, 70) : undefined,
      href: "/tools/memory",
    })),
    ...emails.map((e) => ({ type: "Email" as const, id: e.id, title: e.title || e.brief?.slice(0, 70) || "Email draft", href: "/tools/email-writer" })),
    ...sessions.map((s) => ({ type: "QA" as const, id: s.id, title: s.title, href: "/tools/qa-pipeline" })),
  ];

  return Response.json({ results });
}
