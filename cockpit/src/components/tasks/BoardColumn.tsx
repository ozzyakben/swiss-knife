"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { TaskCard } from "./TaskCard";
import type { Task } from "./TasksView";

export function BoardColumn({
  id,
  label,
  tasks,
  onEdit,
  onDelete,
  onFilterModule,
  onFilterPriority,
}: {
  id: string;
  label: string;
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onFilterModule?: (module: string) => void;
  onFilterPriority?: (priority: Task["priority"]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-muted/30 p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={
          "flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1 transition-colors " +
          (isOver ? "bg-accent/50" : "")
        }
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onEdit={onEdit}
              onDelete={onDelete}
              onFilterModule={onFilterModule}
              onFilterPriority={onFilterPriority}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
