import Link from "next/link";
import { AlertTriangle, CalendarClock, Loader2, Brain, CheckCircle2 } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

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
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const [overdue, dueToday, doing, pendingFacts] = await Promise.all([
    prisma.task
      .findMany({
        where: { ...scope, status: { not: "done" }, dueDate: { lt: today } },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { id: true, title: true },
      })
      .catch(() => [] as TaskLite[]),
    prisma.task
      .findMany({
        where: { ...scope, status: { not: "done" }, dueDate: { gte: today, lt: tomorrow } },
        orderBy: { priority: "desc" },
        take: 5,
        select: { id: true, title: true },
      })
      .catch(() => [] as TaskLite[]),
    prisma.task
      .findMany({
        where: { ...scope, status: "doing" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true },
      })
      .catch(() => [] as TaskLite[]),
    prisma.memoryFact.count({ where: { ...scope, status: "pending" } }).catch(() => 0),
  ]);

  const clear = overdue.length === 0 && dueToday.length === 0 && doing.length === 0 && pendingFacts === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {clear ? (
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
            {pendingFacts > 0 && (
              <Link href="/tools/memory" className="flex items-center gap-2 font-medium hover:underline">
                <Brain className="h-4 w-4" /> {pendingFacts} memory suggestion{pendingFacts > 1 ? "s" : ""} to review
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
