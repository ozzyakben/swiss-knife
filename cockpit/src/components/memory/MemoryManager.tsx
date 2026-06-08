"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Pin,
  Trash2,
  Check,
  X,
  Sparkles,
  Plus,
  Pencil,
  RefreshCw,
  Merge,
  Search,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Fact = {
  id: string;
  key: string | null;
  value: string;
  source: string;
  status: string;
  pinned: boolean;
  category: string | null;
  projectId: string | null;
  projectName: string | null;
  indexed: boolean;
  mergedIntoId: string | null;
  mergedIntoValue: string | null;
};

type PreviewFact = {
  id: string;
  key: string | null;
  value: string;
  category: string | null;
  pinned: boolean;
  score: number | null;
};

const ALL = "__all__";
const NONE = "__none__";

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <Badge variant="outline" className="text-[10px] capitalize">
      {category}
    </Badge>
  );
}

export function MemoryManager({
  facts,
  projects,
  activeProjectId,
}: {
  facts: Fact[];
  projects: { id: string; name: string }[];
  activeProjectId: string | null;
}) {
  const activeProjectName = projects.find((p) => p.id === activeProjectId)?.name ?? null;
  const router = useRouter();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterProject, setFilterProject] = useState(ALL);
  const [reindexing, setReindexing] = useState(false);

  // Inline edit (one fact at a time).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Relevance inspector.
  const [previewQ, setPreviewQ] = useState("");
  const [preview, setPreview] = useState<PreviewFact[] | null>(null);
  const [previewRanked, setPreviewRanked] = useState(true);
  const [previewBusy, setPreviewBusy] = useState(false);

  const [showArchived, setShowArchived] = useState(false);

  const inFilter = (f: Fact) =>
    filterProject === ALL ||
    (filterProject === NONE ? f.projectId === null : f.projectId === filterProject);

  const visible = facts.filter(inFilter);
  const pendingNew = visible.filter((f) => f.status === "pending" && !f.mergedIntoId);
  const pendingMerge = visible.filter((f) => f.status === "pending" && f.mergedIntoId);
  const active = visible.filter((f) => f.status === "active");
  const archived = visible.filter((f) => f.status === "archived");
  const indexedCount = active.filter((f) => f.indexed).length;

  async function add() {
    if (!value.trim()) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) return toast.error("Failed to add");
    setKey("");
    setValue("");
    router.refresh();
  }

  async function patch(id: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return toast.error("Failed");
    router.refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Failed");
    router.refresh();
  }

  async function acceptMerge(id: string) {
    const res = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    if (!res.ok) return toast.error("Failed");
    toast.success("Merged into the existing fact");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) return;
    await patch(id, { value: editValue.trim() });
    setEditingId(null);
    setEditValue("");
  }

  async function learn() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memory/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const parts = [`${data.created} new`];
      if (data.merges) parts.push(`${data.merges} merge proposal${data.merges > 1 ? "s" : ""}`);
      if (data.skipped) parts.push(`${data.skipped} already queued`);
      toast.success(`Captured: ${parts.join(", ")} — review below`);
      setText("");
      setSuggestOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reindex() {
    setReindexing(true);
    try {
      const res = await fetch("/api/memory/reindex", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(
        data.indexed > 0 ? `Indexed ${data.indexed} fact(s) for relevance` : "All facts already indexed"
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setReindexing(false);
    }
  }

  async function runPreview() {
    if (!previewQ.trim()) return;
    setPreviewBusy(true);
    try {
      // Mirror what the tools inject: the ACTIVE project + global facts. The list
      // filter above is only a view filter and doesn't change tool context.
      const params = new URLSearchParams({
        query: previewQ,
        projectId: activeProjectId ?? "",
        limit: "12",
      });
      const res = await fetch(`/api/memory/context?${params}`);
      const data = await res.json();
      setPreview(data.facts ?? []);
      setPreviewRanked(Boolean(data.ranked));
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewBusy(false);
    }
  }

  function startEdit(f: Fact) {
    setEditingId(f.id);
    setEditValue(f.value);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">🧠 Memory</h1>
      <p className="mt-1 text-muted-foreground">
        Facts about you and your work, woven into the email, brainstorming, task, and QA tools. The
        model proposes; you approve. Facts are ranked by relevance to each task.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Key (optional)"
          className="max-w-[160px]"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a fact…"
          className="max-w-md"
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <Button onClick={add} disabled={!value.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
        <Button variant="outline" onClick={() => setSuggestOpen(true)}>
          <Sparkles className="mr-1 h-4 w-4" /> Suggest from text
        </Button>
        <Button variant="outline" onClick={reindex} disabled={reindexing} title="Embed facts so they can be ranked by relevance">
          <RefreshCw className={"mr-1 h-4 w-4 " + (reindexing ? "animate-spin" : "")} />
          {reindexing ? "Indexing…" : "Reindex"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Project</span>
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="h-8 w-48" aria-label="Filter by project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                <SelectItem value={NONE}>No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {indexedCount}/{active.length} active facts indexed for relevance
        </span>
      </div>

      {/* Relevance inspector — the facts a tool would see for a given task. */}
      <div className="mt-6 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Relevance preview</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Type a task to see which facts rank highest — the same ranking the tools use
          {activeProjectName ? ` for ${activeProjectName}` : ""} (active project + global facts).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={previewQ}
            onChange={(e) => setPreviewQ(e.target.value)}
            placeholder="e.g. Write a Gherkin scenario for a tax-exempt POS sale"
            className="max-w-lg"
            onKeyDown={(e) => {
              if (e.key === "Enter") runPreview();
            }}
          />
          <Button variant="secondary" onClick={runPreview} disabled={previewBusy || !previewQ.trim()}>
            {previewBusy ? "Ranking…" : "Preview"}
          </Button>
        </div>

        {preview && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              {previewRanked
                ? "Ranked by relevance (cosine similarity)."
                : "Recency fallback — Reindex the facts to enable relevance ranking."}
            </p>
            {preview.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No facts in scope.</p>
            ) : (
              <ol className="mt-2 space-y-1">
                {preview.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
                    {f.score !== null && (
                      <Badge variant="secondary" className="w-12 justify-center text-[10px] tabular-nums">
                        {Math.round(Math.max(0, f.score) * 100)}%
                      </Badge>
                    )}
                    {f.pinned && <Pin className="h-3 w-3 text-yellow-500" />}
                    <span className="flex-1">{f.key ? `${f.key}: ` : ""}{f.value}</span>
                    <CategoryBadge category={f.category} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      {/* Merge proposals — consolidate a duplicate into an existing fact. */}
      {pendingMerge.length > 0 && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Merge className="h-4 w-4" /> Merge proposals — review
          </h2>
          <div className="mt-2 space-y-2">
            {pendingMerge.map((f) => (
              <Card key={f.id}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      merge
                    </Badge>
                    <CategoryBadge category={f.category} />
                    {f.projectName && (
                      <Badge variant="outline" className="text-[10px]">
                        {f.projectName}
                      </Badge>
                    )}
                    <div className="ml-auto flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Accept merge"
                        onClick={() => acceptMerge(f.id)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Dismiss merge"
                        onClick={() => remove(f.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {f.mergedIntoValue && (
                    <p className="text-xs text-muted-foreground line-through">{f.mergedIntoValue}</p>
                  )}
                  <p className="text-sm">{f.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* New candidate facts to review. */}
      {pendingNew.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-muted-foreground">Suggested — review</h2>
          <div className="mt-2 space-y-2">
            {pendingNew.map((f) => (
              <Card key={f.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <Badge variant="secondary" className="text-[10px]">
                    ai
                  </Badge>
                  <CategoryBadge category={f.category} />
                  {editingId === f.id ? (
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(f.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="flex-1 text-sm">{f.value}</span>
                  )}
                  {f.projectName && (
                    <Badge variant="outline" className="text-[10px]">
                      {f.projectName}
                    </Badge>
                  )}
                  {editingId === f.id ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Save edit" onClick={() => saveEdit(f.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit fact" onClick={() => startEdit(f)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Accept fact"
                    onClick={() => patch(f.id, { status: "active" })}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Dismiss fact"
                    onClick={() => remove(f.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">Active facts ({active.length})</h2>
        {active.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No facts yet. Add one or suggest from text.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {active.map((f) => (
              <Card key={f.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  {f.key && (
                    <Badge variant="outline" className="text-[10px]">
                      {f.key}
                    </Badge>
                  )}
                  <CategoryBadge category={f.category} />
                  {editingId === f.id ? (
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(f.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="flex-1 text-sm">{f.value}</span>
                  )}
                  {f.projectName && (
                    <Badge variant="outline" className="text-[10px]">
                      {f.projectName}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {f.source}
                  </Badge>
                  {editingId === f.id ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Save edit" onClick={() => saveEdit(f.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit fact" onClick={() => startEdit(f)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={"h-7 w-7 " + (f.pinned ? "text-yellow-500" : "")}
                    aria-label="Pin fact"
                    onClick={() => patch(f.id, { pinned: !f.pinned })}
                  >
                    <Pin className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete fact"
                    onClick={() => remove(f.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {archived.length > 0 && (
        <div className="mt-8">
          <button
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowArchived((s) => !s)}
          >
            Archived ({archived.length}) {showArchived ? "▾" : "▸"}
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map((f) => (
                <Card key={f.id}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <CategoryBadge category={f.category} />
                    <span className="flex-1 text-sm text-muted-foreground">{f.value}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Restore fact"
                      onClick={() => patch(f.id, { status: "active" })}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Delete fact"
                      onClick={() => remove(f.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Learn from text</DialogTitle>
            <DialogDescription>
              Gemma extracts durable facts, categorizes them, and flags duplicates of what you
              already know. You review and accept.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste notes, an email, a bio, a glossary…"
            disabled={busy}
          />
          <DialogFooter>
            <Button onClick={learn} disabled={busy || !text.trim()}>
              {busy ? "Learning…" : "Learn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
