import Link from "next/link";
import { AlertTriangle, CalendarClock, Loader2, Brain, CheckCircle2 } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { dueDayString, localDayString, utcNoonOfLocalDay } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TaskLite = { id: string; title: string };

function TaskLines({ items }: { items: TaskLite[] }) {
  return (
    <ul className="ml-6 mt-1 space-y-0.5">
      {items.map((t) => (
        <li key={t.id} className="truncate text-muted-foreground">
          {t.title}
        </li>
      ))}
    </ul>
  );
}

/**
 * Proactive "Today" panel: surfaces what needs attention without a model call —
 * overdue / due-today / in-progress tasks and pending memory reviews for the
 * active project (+ global). Deterministic and instant by design.
 */
export async function DailyBrief() {
  const projectId = await getActiveProjectId();
  const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
  const todayStr = localDayString();

  // A DB failure must NOT render as a clean green day — settle each query and
  // derive a degraded state instead of swallowing errors into empty arrays.
  const settle = <T,>(p: Promise<T>, fallbackValue: T) =>
    p.then((value) => ({ ok: true, value })).catch(() => ({ ok: false, value: fallbackValue }));

  const [dueSoonR, doingR, pendingR, pendingCountR] = await Promise.all([
    // One query for everything with a due date that could matter today; the
    // overdue/due-today split happens on CALENDAR DAYS (lib/dates.ts), not raw
    // instants — a UTC-midnight-stored task is not "overdue" on its due day.
    // Bounded by DATE (anything representable as ≤ today, legacy rows
    // included), not by row count — a take-N ascending window filled with 50+
    // overdue rows used to silently starve the due-today bucket.
    settle(
      prisma.task.findMany({
        where: { ...scope, status: { not: "done" }, dueDate: { lt: utcNoonOfLocalDay(new Date(), 2) } },
        // desc: today's rows are the LATEST in range, so they can never be cut
        // by the take; overdue then lists nearest-due first.
        orderBy: { dueDate: "desc" },
        take: 200,
        select: { id: true, title: true, dueDate: true },
      }),
      [] as (TaskLite & { dueDate: Date | null })[]
    ),
    settle(
      prisma.task.findMany({
        where: { ...scope, status: "doing" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true },
      }),
      [] as TaskLite[]
    ),
    settle(
      prisma.memoryFact.findMany({
        where: { ...scope, status: "pending", deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, key: true, value: true },
      }),
      [] as { id: string; key: string | null; value: string }[]
    ),
    settle(prisma.memoryFact.count({ where: { ...scope, status: "pending", deletedAt: null } }), 0),
  ]);
  const failed = !(dueSoonR.ok && doingR.ok && pendingR.ok && pendingCountR.ok);
  const [dueSoon, doing, pending, pendingCount] = [
    dueSoonR.value,
    doingR.value,
    pendingR.value,
    pendingCountR.value,
  ] as const;

  const overdue = dueSoon.filter((t) => t.dueDate && dueDayString(t.dueDate) < todayStr).slice(0, 5);
  const dueToday = dueSoon.filter((t) => t.dueDate && dueDayString(t.dueDate) === todayStr).slice(0, 5);

  const clear = overdue.length === 0 && dueToday.length === 0 && doing.length === 0 && pendingCount === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {failed && clear ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" /> Couldn&apos;t load today&apos;s brief — check the database.
          </p>
        ) : clear ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" /> You&apos;re clear — nothing overdue or due today.
          </p>
        ) : (
          <>
            {overdue.length > 0 && (
              <div>
                <Link href="/tools/tasks" className="flex items-center gap-2 font-medium text-destructive hover:underline">
                  <AlertTriangle className="h-4 w-4" /> {overdue.length} overdue
                </Link>
                <TaskLines items={overdue} />
              </div>
            )}
            {dueToday.length > 0 && (
              <div>
                <Link href="/tools/tasks" className="flex items-center gap-2 font-medium hover:underline">
                  <CalendarClock className="h-4 w-4" /> {dueToday.length} due today
                </Link>
                <TaskLines items={dueToday} />
              </div>
            )}
            {doing.length > 0 && (
              <div>
                <Link href="/tools/tasks" className="flex items-center gap-2 font-medium hover:underline">
                  <Loader2 className="h-4 w-4" /> {doing.length} in progress
                </Link>
                <TaskLines items={doing} />
              </div>
            )}
            {pendingCount > 0 && (
              <div>
                <Link href="/tools/memory" className="flex items-center gap-2 font-medium hover:underline">
                  <Brain className="h-4 w-4" /> {pendingCount} memory suggestion{pendingCount > 1 ? "s" : ""} to review
                </Link>
                <ul className="ml-6 mt-1 space-y-0.5">
                  {pending.map((f) => (
                    <li key={f.id} className="truncate text-muted-foreground">
                      {f.key ? `${f.key}: ` : ""}
                      {f.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
