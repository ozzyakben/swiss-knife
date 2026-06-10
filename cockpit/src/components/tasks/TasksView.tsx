"use client";

import { useEffect, useState } from "react";
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
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDueDay } from "@/lib/dates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePersisted } from "@/hooks/usePersisted";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  projectId?: string | null;
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

export function TasksView({
  initialTasks,
  activeProject,
  initialQuery = "",
}: {
  initialTasks: Task[];
  /** The active project (from the sidebar switcher); enables project scoping. */
  activeProject?: { id: string; name: string } | null;
  /** Seed for the search box (the ⌘K search deep link: /tools/tasks?q=…). */
  initialQuery?: string;
}) {
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
  const [query, setQuery] = useState(initialQuery);
  const [priorityRaw, setPriorityFilter] = usePersisted("sk:tasks:priority", "all");
  const [moduleRaw, setModuleFilter] = usePersisted("sk:tasks:module", "all");
  const [view, setView] = usePersisted("sk:tasks:view", "board");
  // Scope to the active project by default — the page used to show every
  // project's tasks while DailyBrief/creates scoped, so switching projects
  // changed nothing here. "All projects" is one click and persisted.
  const [scopeRaw, setScope] = usePersisted("sk:tasks:scope", "project");
  const scope: "project" | "all" = scopeRaw === "all" ? "all" : "project";

  // A ⌘K deep link must actually reveal its target: useState ignores a new
  // initialQuery once mounted, and /api/search matches across ALL projects, so
  // lift the persisted filters/scope that could mask the result.
  useEffect(() => {
    if (!initialQuery) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven deep-link consume
    setQuery(initialQuery);
    setPriorityFilter("all");
    setModuleFilter("all");
    setScope("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usePersisted setters are not memoized
  }, [initialQuery]);

  const clearFilters = () => {
    setQuery("");
    setPriorityFilter("all");
    setModuleFilter("all");
  };

  // Bulk selection (list view): ops reuse the per-row PATCH/DELETE endpoints.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

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
    // Project scope mirrors DailyBrief: the active project's tasks + global ones.
    if (activeProject && scope === "project" && t.projectId && t.projectId !== activeProject.id) return false;
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
  const inScope = (t: Task) =>
    !activeProject || scope === "all" || !t.projectId || t.projectId === activeProject.id;
  const totalCount = allTasks.filter(inScope).length;
  const filteredCount = filtered.todo.length + filtered.doing.length + filtered.done.length;

  // Bulk ops act ONLY on selected tasks that are currently visible — a
  // selection made before a filter change must not let "Delete N" remove
  // tasks the user can't see (and deleted rows are pruned from the set).
  const visibleIds = new Set(STATUSES.flatMap((s) => filtered[s]).map((t) => t.id));
  const activeSelection = [...selected].filter((id) => visibleIds.has(id));

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
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setBoard((prev) => ({
      todo: prev.todo.filter((t) => t.id !== id),
      doing: prev.doing.filter((t) => t.id !== id),
      done: prev.done.filter((t) => t.id !== id),
    }));
    // Optimistic, but a failure must not be silent — the row would reappear on
    // reload with no explanation (bulkDelete and setStatus already surface this).
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't delete the task — reload to resync.");
    }
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Bulk status/priority over the per-row PATCH; optimistic, failures surfaced. */
  async function bulkPatch(data: { status?: Status; priority?: Priority }) {
    const ids = activeSelection;
    if (ids.length === 0) return;
    setSelected(new Set());
    const idSet = new Set(ids);
    setBoard((prev) => {
      const all = [...prev.todo, ...prev.doing, ...prev.done];
      const apply = (t: Task): Task => (idSet.has(t.id) ? { ...t, ...data } : t);
      if (!data.status) {
        return { todo: prev.todo.map(apply), doing: prev.doing.map(apply), done: prev.done.map(apply) };
      }
      const status = data.status;
      const picked = all.filter((t) => idSet.has(t.id)).map((t) => ({ ...t, ...data, status }));
      const next: Board = {
        todo: prev.todo.filter((t) => !idSet.has(t.id)),
        doing: prev.doing.filter((t) => !idSet.has(t.id)),
        done: prev.done.filter((t) => !idSet.has(t.id)),
      };
      next[status] = [...next[status], ...picked];
      return next;
    });
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })
          .then((r) => r.ok)
          .catch(() => false)
      )
    );
    const failed = results.filter((ok) => !ok).length;
    if (failed) toast.error(`${failed} task${failed === 1 ? "" : "s"} didn't update — reload to resync.`);
  }

  /** Bulk delete over the per-row DELETE; failures surfaced (unlike single delete). */
  async function bulkDelete() {
    const ids = activeSelection;
    if (ids.length === 0) return;
    setSelected(new Set());
    const idSet = new Set(ids);
    setBoard((prev) => ({
      todo: prev.todo.filter((t) => !idSet.has(t.id)),
      doing: prev.doing.filter((t) => !idSet.has(t.id)),
      done: prev.done.filter((t) => !idSet.has(t.id)),
    }));
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/tasks/${id}`, { method: "DELETE" })
          .then((r) => r.ok)
          .catch(() => false)
      )
    );
    const failed = results.filter((ok) => !ok).length;
    if (failed) toast.error(`${failed} task${failed === 1 ? "" : "s"} didn't delete — reload to resync.`);
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
        {activeProject && (
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-44" aria-label="Project scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">{activeProject.name} + global</SelectItem>
              <SelectItem value="all">All projects</SelectItem>
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
          {activeSelection.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-sm">{activeSelection.length} selected</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set(STATUSES.flatMap((s) => filtered[s]).map((t) => t.id)))}
              >
                Select all {filteredCount}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <span className="mx-1 h-4 w-px bg-border" />
              {STATUSES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => void bulkPatch({ status: s })}>
                  → {s}
                </Button>
              ))}
              <Select onValueChange={(v) => void bulkPatch({ priority: v as Priority })}>
                <SelectTrigger className="h-8 w-32" aria-label="Bulk set priority">
                  <SelectValue placeholder="Priority…" />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="destructive" onClick={() => setConfirmBulkDelete(true)}>
                Delete {activeSelection.length}
              </Button>
            </div>
          )}
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
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Select ${t.title}`}
                  />
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={(e) => setStatus(t.id, e.target.checked ? "done" : "todo")}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Mark ${t.title} done`}
                  />
                  <span
                    className={
                      "min-w-0 flex-1 truncate text-sm " +
                      (t.status === "done" ? "text-muted-foreground line-through" : "")
                    }
                  >
                    {t.title}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t.status}
                  </Badge>
                  <button
                    type="button"
                    className={cn(badgeVariants({ variant: "secondary" }), "shrink-0 cursor-pointer text-[10px]")}
                    title={`Filter by ${t.priority} priority`}
                    onClick={() => setPriorityFilter(t.priority)}
                  >
                    {t.priority}
                  </button>
                  {t.dueDate && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      due {formatDueDay(t.dueDate)}
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
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${activeSelection.length} task${activeSelection.length === 1 ? "" : "s"}?`}
        description="This permanently deletes the selected tasks — there's no trash for tasks."
        onConfirm={() => void bulkDelete()}
      />
    </div>
  );
}
