"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { downloadText } from "@/lib/download";

type Report = {
  title: string;
  repro: string[];
  expected: string;
  actual: string;
  severity: string;
  environment: string | null;
  missing: string[];
  savedId?: string;
};

function toMarkdown(r: Report): string {
  return [
    `# ${r.title}`,
    `**Severity:** ${r.severity}${r.environment ? ` · **Environment:** ${r.environment}` : ""}`,
    ``,
    `## Steps to reproduce`,
    ...r.repro.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## Expected`,
    r.expected,
    ``,
    `## Actual`,
    r.actual,
    ``,
  ].join("\n");
}

export function BugReportTool() {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  async function run(save: boolean) {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, save }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setReport(data);
      if (save && data.savedId) toast.success("Bug report saved");
      else if (save && data.missing?.length)
        toast.error(`Can't save — missing: ${data.missing.join(", ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Bug Report Writer</h1>
      <p className="mt-1 text-muted-foreground">
        Paste a rough note. Gemma drafts a structured report (repro, expected, actual, severity) using
        your project vocabulary, and gates it on completeness before saving.
      </p>

      <VoiceTextarea
        className="mt-6"
        rows={5}
        value={note}
        onValueChange={setNote}
        placeholder="e.g. POS partial ROA payment errors when amount is less than balance — should accept and apply oldest-invoice-first…"
        disabled={busy}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && note.trim() && !busy) run(false);
        }}
      />
      <div className="mt-3 flex gap-2">
        <Button onClick={() => run(false)} disabled={busy || !note.trim()}>
          {busy ? "Drafting…" : "Draft report"}
        </Button>
        <Button variant="outline" onClick={() => run(true)} disabled={busy || !note.trim()}>
          Draft &amp; save
        </Button>
      </div>

      {report && (
        <Card className="mt-6">
          <CardContent className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">{report.title}</span>
              <Badge
                variant={
                  report.severity === "critical" || report.severity === "high" ? "destructive" : "secondary"
                }
                className="capitalize"
              >
                {report.severity}
              </Badge>
              {report.environment && (
                <Badge variant="outline" className="text-[10px]">
                  {report.environment}
                </Badge>
              )}
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(toMarkdown(report));
                    toast.success("Copied");
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" /> Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => downloadText("bug-report.md", toMarkdown(report), "text/markdown")}>
                  Export
                </Button>
              </div>
            </div>

            {report.missing.length > 0 && (
              <p className="rounded-md border border-dashed border-destructive/40 p-2 text-destructive">
                Incomplete — missing: {report.missing.join(", ")}. Add detail and re-draft to save.
              </p>
            )}

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Steps to reproduce</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {report.repro.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expected</h3>
              <p className="mt-0.5">{report.expected}</p>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual</h3>
              <p className="mt-0.5">{report.actual}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
