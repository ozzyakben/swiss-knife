// Named routines: multi-step chains over existing data, fired headlessly (e.g.
// by a scheduled macOS Shortcut hitting /api/routines/[slug] with the capture
// token). Each writes its result as a dated Idea and an activity-log row, so a
// scheduled run has somewhere to land.

import { prisma } from "@/lib/db";
import { chat } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { logActivity } from "@/lib/activity";

export const ROUTINES = ["standup", "wrapup"] as const;
export type RoutineSlug = (typeof ROUTINES)[number];

export function isRoutine(s: string): s is RoutineSlug {
  return (ROUTINES as readonly string[]).includes(s);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function bullets<T>(rows: T[], pick: (r: T) => string | null): string {
  const lines = rows.map(pick).filter(Boolean);
  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : "- (none)";
}

export async function runRoutine(slug: RoutineSlug): Promise<{ title: string; text: string; ideaId: string }> {
  const cfg = await getEffectiveConfig();
  const opts = { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.3 };
  const today = startOfDay(new Date());

  let title: string;
  let system: string;
  let prompt: string;

  if (slug === "standup") {
    const tasks = await prisma.task.findMany({ orderBy: [{ order: "asc" }] });
    const section = (status: string) => bullets(tasks.filter((t) => t.status === status), (t) => t.title);
    system =
      "Write a brief daily standup from a task board: three short sections — 'In progress', 'Up next' (top 3), 'Recently done'. Concise, no preamble.";
    prompt = `Doing:\n${section("doing")}\n\nTo do:\n${section("todo")}\n\nDone:\n${section("done")}`;
    title = `Standup ${ymd(today)}`;
  } else {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const [done, sessions, captures] = await Promise.all([
      prisma.task.findMany({ where: { completedAt: { gte: today, lt: tomorrow } }, select: { title: true } }),
      prisma.qaSession.findMany({ where: { updatedAt: { gte: today, lt: tomorrow } }, select: { title: true } }),
      prisma.activityLog.findMany({
        where: { createdAt: { gte: today, lt: tomorrow } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { summary: true },
      }),
    ]);
    system =
      "Write a short end-of-day wrap-up as 'Shipped X, queued Y, blocked on Z' from today's activity. 2-4 sentences, concrete, no preamble.";
    prompt = `Completed today:\n${bullets(done, (t) => t.title)}\n\nQA sessions touched:\n${bullets(
      sessions,
      (s) => s.title
    )}\n\nCaptures:\n${bullets(captures, (c) => c.summary)}`;
    title = `End of day ${ymd(today)}`;
  }

  const text = (await chat([{ role: "system", content: system }, { role: "user", content: prompt }], opts)).trim();
  const idea = await prisma.idea.create({ data: { topic: title, title, content: text } });
  await logActivity({ entity: "idea", action: slug, summary: title });
  return { title, text, ideaId: idea.id };
}
