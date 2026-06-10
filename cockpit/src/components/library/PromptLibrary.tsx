"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Copy, Star, Pencil, Trash2, Download, Upload, Sparkles, Plus, Files } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplateRunner } from "@/components/library/TemplateRunner";
import { templateVariableNames } from "@/lib/templates";

export type LibPrompt = {
  id: string;
  title: string;
  original: string;
  optimized: string | null;
  tags: string | null;
  favorite: boolean;
  source: string;
  project?: string | null;
};

export type LibTemplate = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  variables: string;
  body: string;
  builtin: boolean;
};

/** Seed for the create/edit template dialog. No id => create. */
type TemplateSeed = {
  id?: string;
  name: string;
  description: string;
  category: string;
  body: string;
  variables: string;
};

function tagList(tags: string | null): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function PromptLibrary({
  prompts,
  templates,
  initialQuery = "",
}: {
  prompts: LibPrompt[];
  templates: LibTemplate[];
  /** Seed for the search box (the ⌘K search deep link: /tools/prompt-library?q=…). */
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  // useState ignores a new initialQuery once mounted — a ⌘K result picked
  // while already on this page must still update the search box.
  useEffect(() => {
    if (!initialQuery) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven deep-link consume
    setQ(initialQuery);
  }, [initialQuery]);
  const [editing, setEditing] = useState<LibPrompt | null>(null);
  const [useTemplate, setUseTemplate] = useState<LibTemplate | null>(null);
  const [tmplSeed, setTmplSeed] = useState<TemplateSeed | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return prompts;
    return prompts.filter((p) =>
      [p.title, p.original, p.optimized ?? "", p.tags ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [q, prompts]);

  async function patch(id: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/prompts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function remove(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  async function removeTemplate(id: string) {
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Delete failed");
      return;
    }
    toast.success("Template deleted");
    router.refresh();
  }

  function newTemplate() {
    setTmplSeed({ name: "", description: "", category: "", body: "", variables: "" });
  }

  function editTemplate(t: LibTemplate) {
    setTmplSeed({
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      category: t.category ?? "",
      body: t.body,
      variables: t.variables,
    });
  }

  function duplicateTemplate(t: LibTemplate) {
    // No id => creates a new custom template; variables re-derived from the body.
    setTmplSeed({
      name: `Copy of ${t.name}`,
      description: t.description ?? "",
      category: t.category ?? "",
      body: t.body,
      variables: "",
    });
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const res = await fetch("/api/prompts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast.success(`Imported ${data.imported} prompt(s)`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Prompt Library</h1>
      <p className="mt-1 text-muted-foreground">
        Saved prompts and reusable variable templates.
      </p>

      <Tabs defaultValue="prompts" className="mt-6">
        <TabsList>
          <TabsTrigger value="prompts">Saved prompts ({prompts.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="prompts" className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search prompts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex-1" />
            <Button variant="outline" size="sm" asChild>
              <a href="/api/prompts/export" download>
                <Download className="mr-1 h-4 w-4" /> Export
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-1 h-4 w-4" /> Import
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={onImportFile}
                />
              </label>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await fetch("/api/prompts/sync", { method: "POST" });
                const data = await res.json();
                if (!res.ok) {
                  toast.error(data.error || "Sync failed");
                  return;
                }
                toast.success(
                  `Synced ${data.synced} prompt(s): ${data.created} new, ${data.updated} updated` +
                    (data.failed ? `, ${data.failed} failed` : "")
                );
              }}
            >
              Sync to Open WebUI
            </Button>
          </div>

          {filtered.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {prompts.length === 0
                ? "No saved prompts yet. Optimize one, or run a template."
                : "No matches."}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filtered.map((p) => (
                <Card key={p.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 py-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {p.title}
                      {p.project && (
                        <Badge variant="secondary" className="text-[10px]">
                          {p.project}
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Toggle favorite"
                        onClick={() => patch(p.id, { favorite: !p.favorite })}
                      >
                        <Star
                          className={
                            "h-4 w-4 " + (p.favorite ? "fill-yellow-400 text-yellow-400" : "")
                          }
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Copy"
                        onClick={() => {
                          navigator.clipboard.writeText(p.optimized || p.original);
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Edit"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Delete"
                        onClick={() => remove(p.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {p.optimized || p.original}
                    </p>
                    {tagList(p.tags).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tagList(p.tags).map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Reusable prompts with {"{{variables}}"}. Built-ins can be duplicated to customize.
            </p>
            <Button size="sm" onClick={newTemplate}>
              <Plus className="mr-1 h-4 w-4" /> New template
            </Button>
          </div>

          {templates.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No templates yet. Create one to get started.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <Card key={t.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 py-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {t.name}
                      {t.category && <Badge variant="outline">{t.category}</Badge>}
                      {t.builtin && (
                        <Badge variant="secondary" className="text-[10px]">
                          built-in
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex shrink-0 gap-1">
                      {t.builtin ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Duplicate template"
                          onClick={() => duplicateTemplate(t)}
                        >
                          <Files className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Edit template"
                            onClick={() => editTemplate(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Delete template"
                            onClick={() => removeTemplate(t.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {t.description && (
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setUseTemplate(t)}>
                      <Sparkles className="mr-1 h-4 w-4" /> Use
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit prompt</DialogTitle>
            <DialogDescription>Update the title and tags.</DialogDescription>
          </DialogHeader>
          {editing && (
            <EditForm
              prompt={editing}
              onSave={async (title, tags) => {
                const ok = await patch(editing.id, { title, tags });
                if (ok) {
                  toast.success("Saved");
                  setEditing(null);
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!useTemplate} onOpenChange={(o) => !o && setUseTemplate(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto overflow-x-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{useTemplate?.name}</DialogTitle>
            {useTemplate?.description && (
              <DialogDescription>{useTemplate.description}</DialogDescription>
            )}
          </DialogHeader>
          {useTemplate && (
            <TemplateRunner template={useTemplate} savedLabel="Saved to library" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!tmplSeed} onOpenChange={(o) => !o && setTmplSeed(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tmplSeed?.id ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              Use {"{{variables}}"} in the body; they become fill-in fields when you run it.
            </DialogDescription>
          </DialogHeader>
          {tmplSeed && (
            <TemplateForm
              key={tmplSeed.id ?? "new"}
              seed={tmplSeed}
              onSave={async (vals) => {
                const isEdit = !!tmplSeed.id;
                const res = await fetch(
                  isEdit ? `/api/templates/${tmplSeed.id}` : "/api/templates",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...vals, kind: "prompt" }),
                  }
                );
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  toast.error(data.error || "Save failed");
                  return;
                }
                toast.success(isEdit ? "Template updated" : "Template created");
                setTmplSeed(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateForm({
  seed,
  onSave,
}: {
  seed: TemplateSeed;
  onSave: (vals: {
    name: string;
    description: string;
    category: string;
    body: string;
    variables: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(seed.name);
  const [description, setDescription] = useState(seed.description);
  const [category, setCategory] = useState(seed.category);
  const [body, setBody] = useState(seed.body);
  const [variables, setVariables] = useState(seed.variables);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const derived = templateVariableNames(body);
  const valid = name.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tmpl-name">Name</Label>
        <Input id="tmpl-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tmpl-desc">Description</Label>
        <Input
          id="tmpl-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tmpl-category">Category</Label>
        <Input
          id="tmpl-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Optional group"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tmpl-body">Body</Label>
        <Textarea
          id="tmpl-body"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Summarize {{text}} into {{count}} bullet points."
        />
        <p className="text-xs text-muted-foreground">
          {derived.length > 0
            ? `Variables: ${derived.map((n) => `{{${n}}}`).join(", ")}`
            : "Add {{variables}} to create fill-in fields."}
        </p>
      </div>

      <div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowAdvanced((s) => !s)}
        >
          {showAdvanced ? "Hide" : "Advanced"}: variable definitions (JSON)
        </button>
        {showAdvanced && (
          <Textarea
            className="mt-2 font-mono text-xs"
            rows={4}
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            placeholder='[{"name":"text","type":"textarea","required":true}]'
          />
        )}
      </div>

      <DialogFooter>
        <Button
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              name: name.trim(),
              description: description.trim(),
              category: category.trim(),
              body,
              // Advanced JSON overrides; otherwise the server derives from the body.
              variables: showAdvanced ? variables : "",
            });
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function EditForm({
  prompt,
  onSave,
}: {
  prompt: LibPrompt;
  onSave: (title: string, tags: string) => void;
}) {
  const [title, setTitle] = useState(prompt.title);
  const [tags, setTags] = useState(prompt.tags ?? "");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
        <Input
          id="edit-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="email, draft"
        />
      </div>
      <DialogFooter>
        <Button onClick={() => onSave(title.trim(), tags.trim())} disabled={!title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
