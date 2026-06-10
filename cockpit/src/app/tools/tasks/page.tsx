import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { TasksView, type Task } from "@/components/tasks/TasksView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DB columns are free-form strings; normalize (don't blind-cast) so an
// unexpected value can't key the Kanban board into an undefined column.
const STATUSES = ["todo", "doing", "done"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;
const asStatus = (s: string): Task["status"] =>
  (STATUSES as readonly string[]).includes(s) ? (s as Task["status"]) : "todo";
const asPriority = (p: string): Task["priority"] =>
  (PRIORITIES as readonly string[]).includes(p) ? (p as Task["priority"]) : "medium";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const activeProjectId = await getActiveProjectId();
  const [rows, activeProjectRow] = await Promise.all([
    prisma.task
      .findMany({
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { project: { select: { name: true } } },
      })
      .catch(() => []),
    activeProjectId
      ? prisma.project
          .findUnique({ where: { id: activeProjectId }, select: { id: true, name: true } })
          .catch(() => null)
      : null,
  ]);

  const tasks: Task[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    module: t.module,
    status: asStatus(t.status),
    priority: asPriority(t.priority),
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    order: t.order,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
  }));

  return <TasksView initialTasks={tasks} activeProject={activeProjectRow} initialQuery={q ?? ""} />;
}
