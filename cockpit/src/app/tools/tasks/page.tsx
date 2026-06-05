import { prisma } from "@/lib/db";
import { TasksView, type Task } from "@/components/tasks/TasksView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const rows = await prisma.task
    .findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { project: { select: { name: true } } },
    })
    .catch(() => []);

  const tasks: Task[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    module: t.module,
    status: t.status as Task["status"],
    priority: t.priority as Task["priority"],
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    order: t.order,
    projectName: t.project?.name ?? null,
  }));

  return <TasksView initialTasks={tasks} />;
}
