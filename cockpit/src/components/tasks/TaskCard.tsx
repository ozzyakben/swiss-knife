"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2, GripVertical, Pencil } from "lucide-react";

import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDueDay } from "@/lib/dates";
import type { Task } from "./TasksView";

const PRIORITY_VARIANT = {
  low: "secondary",
  medium: "outline",
  high: "destructive",
} as const;

export function TaskCard({
  task,
  onEdit,
  onDelete,
  onFilterModule,
  onFilterPriority,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  /** Badges become filter chips when these are provided. */
  onFilterModule?: (module: string) => void;
  onFilterPriority?: (priority: Task["priority"]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-border bg-background p-2.5 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab text-muted-foreground"
          aria-label="Drag handle"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {task.module &&
              (onFilterModule ? (
                <button
                  type="button"
                  className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer border-primary/40 text-[10px] font-medium")}
                  title={`Filter by module “${task.module}”`}
                  onClick={() => onFilterModule(task.module as string)}
                >
                  {task.module}
                </button>
              ) : (
                <Badge variant="outline" className="border-primary/40 text-[10px] font-medium">
                  {task.module}
                </Badge>
              ))}
            {onFilterPriority ? (
              <button
                type="button"
                className={cn(badgeVariants({ variant: PRIORITY_VARIANT[task.priority] }), "cursor-pointer text-[10px]")}
                title={`Filter by ${task.priority} priority`}
                onClick={() => onFilterPriority(task.priority)}
              >
                {task.priority}
              </button>
            ) : (
              <Badge variant={PRIORITY_VARIANT[task.priority]} className="text-[10px]">
                {task.priority}
              </Badge>
            )}
            {task.projectName && (
              <Badge variant="secondary" className="text-[10px]">
                {task.projectName}
              </Badge>
            )}
            {task.dueDate && (
              <span className="text-[11px] text-muted-foreground">
                due {formatDueDay(task.dueDate)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Edit task"
            onClick={() => onEdit(task)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Delete task"
            onClick={() => onDelete(task.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
