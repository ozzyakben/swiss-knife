"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { AiOutput } from "@/components/tools/AiOutput";
import { ErrorAlert } from "@/components/ErrorAlert";
import { downloadText } from "@/lib/download";
import type { AdrLintResult } from "@/lib/adrLint";

type AdrRow = {
  id: string;
  title: string;
  status: string;
  lintOk: boolean;
  errors: number;
  warnings: number;
  markdown: string;
  createdAt: string;
};

const STATUSES = ["proposed", "accepted", "rejected", "deprecated", "superseded"];

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "adr";
}

export function AdrWriter() {
  const [note, setNote] = useState("");
  const [lint, setLint] = useState<AdrLintResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [adrs, setAdrs] = useState<AdrRow[]>([]);

  const { output, status, error, isRunning, elapsedMs, run, stop } = useAiTool({
    endpoint: "/api/adr-writer",
    buildBody: (input) => ({ note: input }),
  });
  const secs = Math.round(elapsedMs / 1000);

  const loadAdrs = useCallback(async () => {
    try {
      const res = await fetch("/api/adr");
      const data = await res.json();
      if (res.ok) setAdrs(data.adrs ?? []);
    } catch {
      /* list stays as-is */
    }
  }, []);

  // Initial load (inlined per the repo pattern: async + cancellation guard, so
  // no setState runs synchronously in the effect body).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/adr");
        const data = await res.json();
        if (active && res.ok) setAdrs(data.adrs ?? []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Gate the finished draft (deterministic + free, mirrors the Gherkin flow).
  useEffect(() => {
    if (status !== "done" || !output.trim()) return;
    let cancelled = false;
    fetch("/api/adr-lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: output }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.summary) setLint(d as AdrLintResult);
      })
      .catch(() => {
        /* the draft is still shown; the gate just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [status, output]);

  async function handleRun() {
    setLint(null);
    setSavedId(null);
    await run(note);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/adr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, markdown: output }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't save the ADR.");
      setSavedId(data.adr.id);
      toast.success("ADR saved");
      loadAdrs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the ADR.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, newStatus: string) {
    const res = await fetch(`/api/adr/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't update the status.");
    loadAdrs();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/adr/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't delete the ADR.");
    loadAdrs();
  }

  const s = lint?.summary;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">ADR Writer</h1>
      <p className="mt-1 text-muted-foreground">
        Turn a decision note into a MADR Architecture Decision Record — drafted by the local model,
        gated by a deterministic lint: real alternatives, an explicit outcome, and at least one
        honest negative consequence.
      </p>

      <VoiceTextarea
        className="mt-6"
        rows={6}
        value={note}
        placeholder="Describe the decision: the problem, the options you weighed, what you picked and why…"
        onValueChange={setNote}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && note.trim() && !isRunning) {
            e.preventDefault();
            handleRun();
          }
        }}
        disabled={isRunning}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {/* also disabled while saving: a save landing after a new draft started
            would mark the NEW draft as already saved */}
        <Button onClick={handleRun} disabled={isRunning || saving || !note.trim()}>
          {isRunning ? `Running… ${secs}s` : "Draft ADR"}
        </Button>
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <ErrorAlert className="mt-4" title="Draft failed" message={error} />}

      <AiOutput output={output} status={status} label="ADR draft" />

      {lint && s && status === "done" && (
        <div className="mt-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge
              variant={lint.ok ? "secondary" : "destructive"}
              className="shrink-0 whitespace-nowrap"
            >
              {lint.ok ? "GATE PASS" : "GATE BLOCK"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {s.errors} error{s.errors === 1 ? "" : "s"}, {s.warnings} warning
              {s.warnings === 1 ? "" : "s"} · {s.options} option{s.options === 1 ? "" : "s"} ·{" "}
              {s.negativeConsequences} negative consequence{s.negativeConsequences === 1 ? "" : "s"}
            </span>
            <span className="flex-1" />
            <Button size="sm" onClick={handleSave} disabled={saving || !!savedId}>
              {savedId ? "Saved" : saving ? "Saving…" : "Save ADR"}
            </Button>
          </div>

          {lint.issues.length > 0 && (
            <div className="mt-3 space-y-2">
              {lint.issues.map((it, i) => (
                <Card key={i}>
                  <CardContent className="flex items-start gap-3 py-3">
                    <Badge
                      variant={it.severity === "ERROR" ? "destructive" : "outline"}
                      className="mt-0.5 shrink-0 text-[10px]"
                    >
                      {it.severity}
                    </Badge>
                    <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      L{it.line}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">{it.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {adrs.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Saved ADRs</h2>
          <div className="mt-3 space-y-2">
            {adrs.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={a.lintOk ? "secondary" : "destructive"}
                    className="shrink-0 whitespace-nowrap text-[10px]"
                  >
                    {a.lintOk ? "gate ✓" : `${a.errors} error${a.errors === 1 ? "" : "s"}`}
                  </Badge>
                  <Select value={a.status} onValueChange={(v) => changeStatus(a.id, v)}>
                    <SelectTrigger className="h-8 w-[130px] shrink-0" aria-label="ADR status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((st) => (
                        <SelectItem key={st} value={st}>
                          {st}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Export ADR"
                    title="Download as Markdown"
                    onClick={() => downloadText(`${slugify(a.title)}.md`, a.markdown, "text/markdown")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete ADR"
                    onClick={() => remove(a.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
