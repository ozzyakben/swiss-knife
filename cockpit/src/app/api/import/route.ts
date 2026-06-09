import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & { id: string };
type Upsertable = {
  upsert: (a: { where: { id: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => Promise<unknown>;
};

async function upsertAll(model: Upsertable, rows: Row[] | undefined): Promise<number> {
  let n = 0;
  for (const r of rows ?? []) {
    const { id, ...rest } = r;
    try {
      await model.upsert({ where: { id }, update: rest, create: r });
      n += 1;
    } catch {
      // Skip rows that don't fit (e.g. a dangling foreign key); import is best-effort.
    }
  }
  return n;
}

// Restore a prior export. Idempotent: upserts by id, so re-importing your own
// export is a no-op. Projects go first so content foreign keys resolve.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { data?: Record<string, Row[]> } | null;
  const data = body?.data;
  if (!data) return Response.json({ error: "Not a valid export file." }, { status: 400 });

  const m = prisma as unknown as Record<string, Upsertable>;
  const imported: Record<string, number> = {};
  imported.projects = await upsertAll(m.project, data.projects);
  imported.templates = await upsertAll(m.template, data.templates);
  imported.prompts = await upsertAll(m.prompt, data.prompts);
  imported.emails = await upsertAll(m.emailDraft, data.emails);
  imported.ideas = await upsertAll(m.idea, data.ideas);
  imported.tasks = await upsertAll(m.task, data.tasks);
  imported.facts = await upsertAll(m.memoryFact, data.facts);
  imported.bugs = await upsertAll(m.bugReport, data.bugs);
  imported.goldens = await upsertAll(m.goldenCase, data.goldens);

  let qa = 0;
  let iters = 0;
  for (const s of data.qaSessions ?? []) {
    const { iterations, id, ...session } = s as Row & { iterations?: Row[] };
    try {
      await m.qaSession.upsert({ where: { id }, update: session, create: { id, ...session } });
      qa += 1;
    } catch {
      continue;
    }
    iters += await upsertAll(m.qaIteration, iterations);
  }
  imported.qaSessions = qa;
  imported.iterations = iters;

  return Response.json({ ok: true, imported });
}
