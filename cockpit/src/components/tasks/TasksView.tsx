"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BoardColumn } from "./BoardColumn";
import { TaskCard } from "./TaskCard";
import { TaskAiTools } from "./TaskAiTools";
import { EditTaskDialog } from "./EditTaskDialog";

export type Status = "todo" | "doing" | "done";
export type Priority = "low" | "medium" | "high";
export type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  order: number;
  projectName?: string | null;
};

type Board = Record<Status, Task[]>;

const COLUMNS: { id: Status; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];
const STATUSES: Status[] = ["todo", "doing", "done"];

function group(tasks: Task[]): Board {
  const b: Board = { todo: [], doing: [], done: [] };
  for (const t of [...tasks].sort((a, z) => a.order - z.order)) b[t.status].push(t);
  return b;
}

export function TasksView({ initialTasks }: { initialTasks: Task[] }) {
  const [board, setBoard] = useState<Board>(() => group(initialTasks));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newDue, setNewDue] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const allTasks = [...board.todo, ...board.doing, ...board.done];
  const activeTask = allTasks.find((t) => t.id === activeId) ?? null;

  // ---- mutations ----
  async function addTask() {
    const t = title.trim();
    if (!t) return;
    const priority = newPriority;
    const dueDate = newDue || null;
    setTitle("");
    setNewDue("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, priority, dueDate }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to add");
      return;
    }
    setBoard((prev) => ({ ...prev, todo: [...prev.todo, data.task as Task] }));
  }

  /** Replace a task in place after an edit (status is unchanged by the dialog). */
  function replaceTask(updated: Task) {
    setBoard((prev) => {
      const repl = (arr: Task[]) => arr.map((t) => (t.id === updated.id ? updated : t));
      return { todo: repl(prev.todo), doing: repl(prev.doing), done: repl(prev.done) };
    });
  }

  async function deleteTask(id: string) {
    setBoard((prev) => ({
      todo: prev.todo.filter((t) => t.id !== id),
      doing: prev.doing.filter((t) => t.id !== id),
      done: prev.done.filter((t) => t.id !== id),
    }));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function setStatus(id: string, status: Status) {
    setBoard((prev) => {
      const all = [...prev.todo, ...prev.doing, ...prev.done];
      const task = all.find((t) => t.id === id);
      if (!task) return prev;
      const next: Board = {
        todo: prev.todo.filter((t) => t.id !== id),
        doing: prev.doing.filter((t) => t.id !== id),
        done: prev.done.filter((t) => t.id !== id),
      };
      next[status] = [...next[status], { ...task, status }];
      return next;
    });
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  async function persist(next: Board) {
    const columns = {
      todo: next.todo.map((t) => t.id),
      doing: next.doing.map((t) => t.id),
      done: next.done.map((t) => t.id),
    };
    await fetch("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns }),
    }).catch(() => {});
  }

  // ---- drag and drop ----
  function findContainer(id: string, b: Board): Status | null {
    if (STATUSES.includes(id as Status)) return id as Status;
    return STATUSES.find((s) => b[s].some((t) => t.id === id)) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const aId = String(active.id);
    const oId = String(over.id);
    setBoard((prev) => {
      const ac = findContainer(aId, prev);
      const oc = findContainer(oId, prev);
      if (!ac || !oc || ac === oc) return prev;
      const activeItems = prev[ac];
      const overItems = prev[oc];
      const ai = activeItems.findIndex((t) => t.id === aId);
      if (ai < 0) return prev;
      const moved = activeItems[ai];
      const oi = overItems.findIndex((t) => t.id === oId);
      const insertAt = oi >= 0 ? oi : overItems.length;
      return {
        ...prev,
        [ac]: activeItems.filter((t) => t.id !== aId),
        [oc]: [...overItems.slice(0, insertAt), { ...moved, status: oc }, ...overItems.slice(insertAt)],
      };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const aId = String(active.id);
    const oId = String(over.id);
    setBoard((prev) => {
      const ac = findContainer(aId, prev);
      const oc = findContainer(oId, prev);
      if (!ac || !oc) return prev;
      let next: Board = prev;
      if (ac === oc) {
        const items = prev[ac];
        const from = items.findIndex((t) => t.id === aId);
        const to = items.findIndex((t) => t.id === oId);
        const reordered = from !== -1 && to !== -1 && from !== to ? arrayMove(items, from, to) : items;
        next = { ...prev, [ac]: reordered };
      } else {
        const activeItems = prev[ac];
        const overItems = prev[oc];
        const from = activeItems.findIndex((t) => t.id === aId);
        if (from < 0) return prev;
        const moved = activeItems[from];
        const oi = overItems.findIndex((t) => t.id === oId);
        const insertAt = oi >= 0 ? oi : overItems.length;
        next = {
          ...prev,
          [ac]: activeItems.filter((t) => t.id !== aId),
          [oc]: [...overItems.slice(0, insertAt), { ...moved, status: oc }, ...overItems.slice(insertAt)],
        };
      }
      void persist(next);
      return next;
    });
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">✅ Tasks</h1>
      <p className="mt-1 text-muted-foreground">
        Plan as a list or a board. Drag cards to reorder and move across columns.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          onKeyDown={(e) => {
            if (e.key === "Enter") addTask();
          }}
          className="w-full max-w-xs"
        />
        <Select value={newPriority} onValueChange={(v) => setNewPriority(v as Priority)}>
          <SelectTrigger className="w-28" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">low</SelectItem>
            <SelectItem value="medium">medium</SelectItem>
            <SelectItem value="high">high</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={newDue}
          onChange={(e) => setNewDue(e.target.value)}
          aria-label="Due date"
          className="w-40"
        />
        <Button onClick={addTask} disabled={!title.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      <div className="mt-3">
        <TaskAiTools
          onTasksCreated={(ts) => setBoard((prev) => ({ ...prev, todo: [...prev.todo, ...ts] }))}
        />
      </div>

      <Tabs defaultValue="board" className="mt-6">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <DndContext
            id="task-board"
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {COLUMNS.map((c) => (
                <BoardColumn
                  key={c.id}
                  id={c.id}
                  label={c.label}
                  tasks={board[c.id]}
                  onEdit={setEditing}
                  onDelete={deleteTask}
                />
              ))}
            </div>
            <DragOverlay>
              {activeTask ? (
                <div className="rounded-md border border-border bg-background p-2.5 text-sm shadow-lg">
                  {activeTask.title}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {allTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet. Add one above.</p>
          ) : (
            <div className="space-y-1.5">
              {STATUSES.flatMap((s) => board[s]).map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={(e) => setStatus(t.id, e.target.checked ? "done" : "todo")}
                    className="h-4 w-4"
                    aria-label={`Mark ${t.title} done`}
                  />
                  <span
                    className={
                      "flex-1 text-sm " + (t.status === "done" ? "text-muted-foreground line-through" : "")
                    }
                  >
                    {t.title}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {t.status}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {t.priority}
                  </Badge>
                  {t.dueDate && (
                    <span className="text-[11px] text-muted-foreground">
                      due {new Date(t.dueDate).toLocaleDateString()}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Edit task"
                    onClick={() => setEditing(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete task"
                    onClick={() => deleteTask(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EditTaskDialog task={editing} onClose={() => setEditing(null)} onSaved={replaceTask} />
    </div>
  );
}
