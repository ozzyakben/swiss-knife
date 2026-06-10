"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { ErrorAlert } from "@/components/ErrorAlert";
import type { RubricLint, RubricSpec } from "@/lib/rubric";

type Separation = {
  pass: { verdict: string; score: number | null };
  block: { verdict: string; score: number | null };
  ok: boolean;
} | null;

type DesignResult = {
  spec: RubricSpec;
  notes: string[];
  lint: RubricLint;
  separation: Separation;
  body: string;
  ok: boolean;
};

type Current = { name: string; source: "designed" | "pack"; updatedAt: string } | null;

export function RubricDesigner() {
  const [bar, setBar] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load (inlined per the repo pattern: async + cancellation guard).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/rubric-designer");
        const data = await res.json();
        if (active && res.ok) setCurrent(data.current ?? null);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function design() {
    if (!bar.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSavedSlug(null);
    setSecs(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => setSecs(Math.round((Date.now() - startedAt) / 1000)), 500);
    try {
      const res = await fetch("/api/rubric-designer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bar }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't design the rubric.");
      setResult(data as DesignResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't design the rubric.");
    } finally {
      setBusy(false);
      if (timer.current) clearInterval(timer.current);
    }
  }

  async function save() {
    if (!result?.ok || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rubric-designer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: result.spec, save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't save the rubric.");
      setSavedSlug(data.slug);
      setCurrent({ name: data.name, source: "designed", updatedAt: new Date().toISOString() });
      toast.success("Saved — this is now the active project's rubric (QA pipeline + bench).");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the rubric.");
    } finally {
      setSaving(false);
    }
  }

  const lint = result?.lint;
  const sep = result?.separation;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Eval Rubric Designer</h1>
      <p className="mt-1 text-muted-foreground">
        Describe the bar; the local model designs a weighted rubric. A deterministic gate checks the
        math (weights sum to 100, score bands tile 0–100 monotonically) and a live separation check
        proves it scores a should-pass sample PASS and a should-fail sample BLOCK — through the same
        scoring path the QA pipeline and eval bench use.
      </p>

      {current && (
        <p className="mt-2 text-sm text-muted-foreground">
          Active rubric for this project: <span className="font-medium">{current.name}</span>{" "}
          <Badge variant="outline" className="ml-1 text-[10px]">
            {current.source}
          </Badge>
        </p>
      )}

      <VoiceTextarea
        className="mt-6"
        rows={6}
        value={bar}
        placeholder="What artifact is being judged, and what separates good from bad? e.g. “API error responses: actionable message, right status code, no internals leaked…”"
        onValueChange={setBar}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && bar.trim() && !busy) {
            e.preventDefault();
            design();
          }
        }}
        disabled={busy}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={design} disabled={busy || !bar.trim()}>
          {busy ? `Designing… ${secs}s` : "Design rubric"}
        </Button>
      </div>

      {error && <ErrorAlert className="mt-4" title="Design failed" message={error} />}

      {result && lint && (
        <div className="mt-6 space-y-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge
              variant={result.ok ? "secondary" : "destructive"}
              className="shrink-0 whitespace-nowrap"
            >
              {result.ok ? "GATE PASS" : "GATE BLOCK"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {lint.summary.criteria} criteria · weights {lint.summary.weightTotal}/100 ·{" "}
              {lint.summary.bands} bands
            </span>
            <span className="flex-1" />
            <Button size="sm" onClick={save} disabled={!result.ok || saving || !!savedSlug}>
              {savedSlug ? "Saved" : saving ? "Saving…" : "Save as project rubric"}
            </Button>
          </div>

          {savedSlug && (
            <p className="text-xs text-muted-foreground">
              This rubric now scores the QA pipeline and the eval bench —{" "}
              <Link href="/tools/qa-pipeline" className="underline hover:text-foreground">
                run the eval bench
              </Link>{" "}
              to check agreement against your goldens.
            </p>
          )}

          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold">{result.spec.title}</h2>
              <p className="text-sm text-muted-foreground">for: {result.spec.artifactType}</p>
              <div className="mt-3 space-y-2">
                {result.spec.criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Badge variant="secondary" className="mt-0.5 shrink-0 whitespace-nowrap tabular-nums">
                      {c.weight} pts
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-sm text-muted-foreground">{c.guidance}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[...result.spec.bands]
                  .sort((a, b) => a.min - b.min)
                  .map((b, i) => (
                    <Badge
                      key={i}
                      variant={b.verdict === "PASS" ? "secondary" : "destructive"}
                      className="shrink-0 whitespace-nowrap tabular-nums"
                    >
                      {b.min}–{b.max} {b.label} → {b.verdict}
                    </Badge>
                  ))}
              </div>
            </CardContent>
          </Card>

          {(result.notes.length > 0 || lint.issues.length > 0) && (
            <div className="space-y-2">
              {result.notes.map((n, i) => (
                <Card key={`n${i}`}>
                  <CardContent className="flex items-start gap-3 py-3">
                    <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                      FIXED
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm">{n}</span>
                  </CardContent>
                </Card>
              ))}
              {lint.issues.map((it, i) => (
                <Card key={i}>
                  <CardContent className="flex items-start gap-3 py-3">
                    <Badge
                      variant={it.severity === "ERROR" ? "destructive" : "outline"}
                      className="mt-0.5 shrink-0 text-[10px]"
                    >
                      {it.severity}
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm">{it.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {sep && (
            <Card>
              <CardContent className="py-3">
                <p className="text-sm font-medium">
                  Separation check{" "}
                  <Badge
                    variant={sep.ok ? "secondary" : "destructive"}
                    className="ml-1 shrink-0 whitespace-nowrap text-[10px]"
                  >
                    {sep.ok ? "separates" : "does not separate"}
                  </Badge>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  should-PASS sample → {sep.pass.verdict}
                  {typeof sep.pass.score === "number" ? ` · ${sep.pass.score}/100` : ""} ·
                  should-BLOCK sample → {sep.block.verdict}
                  {typeof sep.block.score === "number" ? ` · ${sep.block.score}/100` : ""}
                </p>
              </CardContent>
            </Card>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Samples + rendered rubric template
            </summary>
            <div className="mt-2 space-y-2">
              <Card>
                <CardContent className="py-3">
                  <p className="text-xs font-medium text-muted-foreground">should-PASS sample</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{result.spec.passSample}</pre>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3">
                  <p className="text-xs font-medium text-muted-foreground">should-BLOCK sample</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{result.spec.blockSample}</pre>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3">
                  <p className="text-xs font-medium text-muted-foreground">template body (consumed by QA pipeline + bench)</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{result.body}</pre>
                </CardContent>
              </Card>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
