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
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus, Trash2, Pencil, Search, X } from "lucide-react";
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
import { usePersisted } from "@/hooks/usePersisted";
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
  module: string | null;
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
  const [newModule, setNewModule] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);

  // ---- search + filter (client-side, instant — like the Memory page) ----
  // Priority/module filters and the board/list tab survive reloads
  // (localStorage); the search box stays ephemeral by design.
  const [query, setQuery] = useState("");
  const [priorityRaw, setPriorityFilter] = usePersisted("sk:tasks:priority", "all");
  const [moduleRaw, setModuleFilter] = usePersisted("sk:tasks:module", "all");
  const [view, setView] = usePersisted("sk:tasks:view", "board");
  const clearFilters = () => {
    setQuery("");
    setPriorityFilter("all");
    setModuleFilter("all");
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const allTasks = [...board.todo, ...board.doing, ...board.done];
  const activeTask = allTasks.find((t) => t.id === activeId) ?? null;

  // Distinct modules present (e.g. LBMH training modules), for the module filter.
  const modules = [...new Set(allTasks.filter((t) => t.module).map((t) => t.module as string))].sort();
  // Stored values are validated against what exists NOW — a stale persisted
  // module (or garbage) degrades to "all" instead of silently hiding tasks.
  const priorityFilter: "all" | Priority =
    priorityRaw === "low" || priorityRaw === "medium" || priorityRaw === "high" ? priorityRaw : "all";
  const moduleFilter =
    moduleRaw === "all" || moduleRaw === "none" || modules.includes(moduleRaw) ? moduleRaw : "all";
  const q = query.trim().toLowerCase();
  const isFiltering = q !== "" || priorityFilter !== "all" || moduleFilter !== "all";
  const matches = (t: Task): boolean => {
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (moduleFilter === "none" && t.module) return false;
    if (moduleFilter !== "all" && moduleFilter !== "none" && t.module !== moduleFilter) return false;
    if (q && !(t.title.toLowerCase().includes(q) || (t.notes ?? "").toLowerCase().includes(q))) return false;
    return true;
  };
  // A display-only filter: drag-and-drop still operates on the full `board`
  // state, so reordering a visible card persists correctly against the whole
  // column. Clearing the filter brings every task back.
  const filtered: Board = {
    todo: board.todo.filter(matches),
    doing: board.doing.filter(matches),
    done: board.done.filter(matches),
  };
  const totalCount = allTasks.length;
  const filteredCount = filtered.todo.length + filtered.doing.length + filtered.done.length;

  // ---- mutations ----
  async function addTask() {
    const t = title.trim();
    if (!t) return;
    const priority = newPriority;
    const dueDate = newDue || null;
    const taskModule = newModule.trim() || null;
    setTitle("");
    setNewDue("");
    setNewModule("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, priority, dueDate, module: taskModule }),
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
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update the task — reload to resync.");
    }
  }

  async function persist(next: Board) {
    const columns = {
      todo: next.todo.map((t) => t.id),
      doing: next.doing.map((t) => t.id),
      done: next.done.map((t) => t.id),
    };
    try {
      const res = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save the new order — reload to resync.");
    }
  }

  // ---- drag and drop ----
  function findContainer(id: string, b: Board): Status | null {
    if (STATUSES.includes(id as Status)) return id as Status;
    return STATUSES.find((s) => b[s].some((t) => t.id === id)) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Moves are committed on drop (onDragEnd), not while hovering. Reordering the
  // board during onDragOver makes the `over` target flicker at a column boundary,
  // which re-fires onDragOver → setState in a loop ("Maximum update depth
  // exceeded"). The dragged card follows the cursor via DragOverlay and the
  // hovered column highlights (BoardColumn `isOver`), so the feedback stays clear.
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
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
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
        <Input
          value={newModule}
          onChange={(e) => setNewModule(e.target.value)}
          placeholder="Module (optional)"
          aria-label="Module"
          list="task-module-options"
          className="w-44"
        />
        <Button onClick={addTask} disabled={!title.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      {/* Shared module suggestions for the add box + edit dialog — existing
          modules autocomplete, and you can type a new one (it then appears in
          the filter). */}
      <datalist id="task-module-options">
        {modules.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <div className="mt-3">
        <TaskAiTools
          onTasksCreated={(ts) => setBoard((prev) => ({ ...prev, todo: [...prev.todo, ...ts] }))}
        />
      </div>

      {/* Search + filters — narrow the board/list to find a task fast. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or notes…"
            aria-label="Search tasks"
            className="pl-8"
          />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-32" aria-label="Filter by priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            <SelectItem value="high">high</SelectItem>
            <SelectItem value="medium">medium</SelectItem>
            <SelectItem value="low">low</SelectItem>
          </SelectContent>
        </Select>
        {modules.length > 0 && (
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-48" aria-label="Filter by module">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              <SelectItem value="none">No module</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isFiltering && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {isFiltering ? `${filteredCount} of ${totalCount}` : `${totalCount} task${totalCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <Tabs value={view === "list" ? "list" : "board"} onValueChange={setView} className="mt-4">
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
            onDragEnd={onDragEnd}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {COLUMNS.map((c) => (
                <BoardColumn
                  key={c.id}
                  id={c.id}
                  label={c.label}
                  tasks={filtered[c.id]}
                  onEdit={setEditing}
                  onDelete={deleteTask}
                  onFilterModule={setModuleFilter}
                  onFilterPriority={setPriorityFilter}
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
          ) : filteredCount === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks match your search or filters.</p>
          ) : (
            <div className="space-y-1.5">
              {STATUSES.flatMap((s) => filtered[s]).map((t) => (
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
                  <Badge
                    variant="secondary"
                    className="cursor-pointer text-[10px]"
                    title={`Filter by ${t.priority} priority`}
                    onClick={() => setPriorityFilter(t.priority)}
                  >
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

      <EditTaskDialog task={editing} modules={modules} onClose={() => setEditing(null)} onSaved={replaceTask} />
    </div>
  );
}
