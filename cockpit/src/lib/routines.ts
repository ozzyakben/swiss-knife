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

export const STANDUP_SYSTEM =
  "Write a brief daily standup from a task board: three short sections — 'In progress', 'Up next' (top 3), 'Recently done'. Concise, no preamble.";

// An empty board is a normal user state, not a failure — routes map this
// message to a 400, anything else to a 500.
export const EMPTY_BOARD_ERROR = "No tasks to summarize yet.";

/**
 * The one standup board builder (shared by the streamed /api/tasks/standup and
 * the headless routine). Scoped to a project when given, bounded per section,
 * and 'done' limited to the last 7 days — an unbounded all-projects dump of a
 * 222-task pack diluted the light model into a useless summary.
 */
export async function buildStandupBoard(projectId: string | null): Promise<string | null> {
  const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [doing, todo, done] = await Promise.all([
    prisma.task.findMany({
      where: { ...scope, status: "doing" },
      orderBy: [{ order: "asc" }],
      take: 15,
      select: { title: true },
    }),
    prisma.task.findMany({
      where: { ...scope, status: "todo" },
      orderBy: [{ order: "asc" }],
      take: 15,
      select: { title: true },
    }),
    prisma.task.findMany({
      where: { ...scope, status: "done", completedAt: { gte: weekAgo } },
      orderBy: [{ completedAt: "desc" }],
      take: 15,
      select: { title: true },
    }),
  ]);
  if (doing.length + todo.length + done.length === 0) return null;
  return `Doing:\n${bullets(doing, (t) => t.title)}\n\nTo do:\n${bullets(
    todo,
    (t) => t.title
  )}\n\nDone (last 7 days):\n${bullets(done, (t) => t.title)}`;
}

export async function runRoutine(
  slug: RoutineSlug,
  projectId: string | null = null
): Promise<{ title: string; text: string; ideaId: string }> {
  const cfg = await getEffectiveConfig();
  const opts = { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.3 };
  const today = startOfDay(new Date());

  let title: string;
  let system: string;
  let prompt: string;

  if (slug === "standup") {
    const board = await buildStandupBoard(projectId);
    if (!board) throw new Error(EMPTY_BOARD_ERROR);
    system = STANDUP_SYSTEM;
    prompt = board;
    title = `Standup ${ymd(today)}`;
  } else {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    // Same scope as the standup board: the resulting Idea is stamped with
    // projectId, so the content must be active-project + global — unscoped
    // queries filed other projects' completions under the active one.
    const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
    const [done, sessions, captures] = await Promise.all([
      prisma.task.findMany({ where: { ...scope, completedAt: { gte: today, lt: tomorrow } }, select: { title: true } }),
      prisma.qaSession.findMany({ where: { ...scope, updatedAt: { gte: today, lt: tomorrow } }, select: { title: true } }),
      prisma.activityLog.findMany({
        where: { ...scope, createdAt: { gte: today, lt: tomorrow } },
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
  const idea = await prisma.idea.create({ data: { topic: title, title, content: text, projectId } });
  await logActivity({ entity: "idea", action: slug, summary: title, projectId });
  return { title, text, ideaId: idea.id };
}
