"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type RecentItem = {
  id: string;
  title: string;
  badges?: string[];
  body: string;
  /** Project name, shown as a badge when the item is project-scoped. */
  project?: string | null;
  /** Current values for the editable fields (keyed by EditField.key). */
  editValues?: Record<string, string>;
};

export type EditField = { key: string; label: string; multiline?: boolean };

/**
 * A "recent saved items" list with copy + delete, and optional inline edit.
 * Pass `editBase` (PATCH target, e.g. "/api/ideas") and `editFields` to enable
 * an edit dialog; each item supplies its current values via `editValues`.
 */
export function RecentItems({
  heading,
  items,
  deleteBase,
  editBase,
  editFields,
  searchable = false,
  highlightId = null,
}: {
  heading: string;
  items: RecentItem[];
  deleteBase: string;
  editBase?: string;
  editFields?: EditField[];
  /** Show a client-side search box over title + body + badges. */
  searchable?: boolean;
  /** Ring + scroll to this item (the ⌘K search deep link). */
  highlightId?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RecentItem | null>(null);
  const [query, setQuery] = useState("");
  // Scroll to the highlighted item ONCE — an inline callback ref re-fires on
  // every render and would keep yanking the scroll position back.
  const scrolledTo = useRef<string | null>(null);
  const canEdit = !!editBase && !!editFields && editFields.length > 0;

  if (items.length === 0) return null;

  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          it.body.toLowerCase().includes(q) ||
          (it.badges ?? []).some((b) => b.toLowerCase().includes(q))
      )
    : items;

  async function remove(id: string) {
    const res = await fetch(`${deleteBase}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{heading}</h2>
        {searchable && items.length > 3 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            aria-label={`Search ${heading.toLowerCase()}`}
            className="h-8 max-w-[200px]"
          />
        )}
      </div>
      {visible.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No matches.</p>
      )}
      <div className="mt-2 space-y-2">
        {visible.map((it) => (
          <Card
            key={it.id}
            ref={
              it.id === highlightId
                ? (el) => {
                    if (el && scrolledTo.current !== it.id) {
                      scrolledTo.current = it.id;
                      el.scrollIntoView({ block: "center" });
                    }
                  }
                : undefined
            }
            className={it.id === highlightId ? "ring-2 ring-ring" : undefined}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 py-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                {it.title}
                {it.project && (
                  <Badge variant="secondary" className="text-[10px]">
                    {it.project}
                  </Badge>
                )}
                {it.badges?.map((b) => (
                  <Badge key={b} variant="outline" className="text-[10px]">
                    {b}
                  </Badge>
                ))}
              </CardTitle>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Copy"
                  onClick={() => {
                    navigator.clipboard.writeText(it.body);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Edit"
                    onClick={() => setEditing(it)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Delete"
                  onClick={() => remove(it.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {it.body}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {canEdit && (
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit</DialogTitle>
              <DialogDescription>Update the saved item.</DialogDescription>
            </DialogHeader>
            {editing && (
              <EditItemForm
                key={editing.id}
                item={editing}
                fields={editFields!}
                onSave={async (values) => {
                  const res = await fetch(`${editBase}/${editing.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(values),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    toast.error(data.error || "Update failed");
                    return;
                  }
                  toast.success("Saved");
                  setEditing(null);
                  router.refresh();
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EditItemForm({
  item,
  fields,
  onSave,
}: {
  item: RecentItem;
  fields: EditField[];
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = item.editValues?.[f.key] ?? "";
    return init;
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={`edit-${f.key}`}>{f.label}</Label>
          {f.multiline ? (
            <Textarea
              id={`edit-${f.key}`}
              rows={6}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          ) : (
            <Input
              id={`edit-${f.key}`}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <DialogFooter>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(values);
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </div>
  );
}
