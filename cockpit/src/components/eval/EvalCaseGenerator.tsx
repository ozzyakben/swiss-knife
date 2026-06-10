"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { ErrorAlert } from "@/components/ErrorAlert";
import type { CaseDimension, EvalCase, EvalCaseLint } from "@/lib/evalCases";

type GeneratedCase = EvalCase & { duplicateOf: number | null };
type GenerateResult = {
  cases: GeneratedCase[];
  lint: EvalCaseLint;
  dedupe: "done" | "skipped";
  ok: boolean;
};

const DIMENSION_ORDER: CaseDimension[] = ["happy", "boundary", "adversarial", "ambiguous", "out-of-scope"];

export function EvalCaseGenerator() {
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<number, string>>({}); // index -> savedId
  const [accepting, setAccepting] = useState<number | null>(null);
  // The human is the labeler: the model is TOLD to guess on boundary/ambiguous
  // cases, so the label must be correctable before it enters the bench.
  const [verdictOverrides, setVerdictOverrides] = useState<Record<number, "PASS" | "BLOCK">>({});
  // Which rubric will judge the accepted goldens — surfaced up front so an
  // accept isn't a blind write into a bench with no (or the wrong) rubric.
  const [rubric, setRubric] = useState<{ name: string; source: string } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/rubric-designer")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setRubric(d.current ?? null);
      })
      .catch(() => {
        if (alive) setRubric(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function generate() {
    if (!spec.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setAccepted({});
    // Overrides are keyed by case INDEX — kept across a regenerate they'd
    // relabel whatever case lands at that index and corrupt saved goldens.
    setVerdictOverrides({});
    setSecs(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => setSecs(Math.round((Date.now() - startedAt) / 1000)), 500);
    try {
      const res = await fetch("/api/eval-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't generate cases.");
      setResult(data as GenerateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate cases.");
    } finally {
      setBusy(false);
      if (timer.current) clearInterval(timer.current);
    }
  }

  async function accept(idx: number, c: GeneratedCase) {
    if (accepting !== null || accepted[idx]) return;
    setAccepting(idx);
    try {
      const res = await fetch("/api/eval-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept: {
            dimension: c.dimension,
            title: c.title,
            artifact: c.artifact,
            expectedVerdict: verdictOverrides[idx] ?? c.expectedVerdict,
            rationale: c.rationale,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't save the case.");
      setAccepted((m) => ({ ...m, [idx]: data.savedId }));
      toast.success("Accepted as a golden case — the eval bench will use it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the case.");
    } finally {
      setAccepting(null);
    }
  }

  const s = result?.lint.summary;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Eval Case Generator</h1>
      <p className="mt-1 text-muted-foreground">
        Paste a spec; the local model proposes eval cases across five dimensions — happy, boundary,
        adversarial, ambiguous, out-of-scope. A deterministic gate enforces full coverage,
        embeddinggemma flags near-duplicates, and each case you accept becomes a golden case for
        the eval bench. Nothing is saved without your accept.
      </p>

      {rubric !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">
          {rubric ? (
            <>
              Accepted cases will be judged by: <span className="font-medium text-foreground">{rubric.name}</span>{" "}
              ({rubric.source})
            </>
          ) : (
            <>
              No eval rubric for this project yet —{" "}
              <Link href="/tools/rubric-designer" className="underline hover:text-foreground">
                design one
              </Link>{" "}
              or the bench can&apos;t score your goldens.
            </>
          )}
        </p>
      )}

      <VoiceTextarea
        className="mt-6"
        rows={6}
        value={spec}
        placeholder="Paste the spec or rule being tested, e.g. “Tax-exempt sales require a valid exemption certificate on file; the cashier must…”"
        onValueChange={setSpec}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && spec.trim() && !busy) {
            e.preventDefault();
            generate();
          }
        }}
        disabled={busy}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={generate} disabled={busy || !spec.trim()}>
          {busy ? `Generating… ${secs}s` : "Generate cases"}
        </Button>
      </div>

      {error && <ErrorAlert className="mt-4" title="Generation failed" message={error} />}

      {result && s && (
        <div className="mt-6 space-y-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={result.ok ? "secondary" : "destructive"} className="shrink-0">
              {result.ok ? "GATE PASS" : "GATE BLOCK"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {s.total} cases · {DIMENSION_ORDER.map((d) => `${d} ${s.byDimension[d] ?? 0}`).join(" · ")}
            </span>
            {result.dedupe === "skipped" && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                dedupe skipped
              </Badge>
            )}
          </div>

          {result.lint.issues.length > 0 && (
            <div className="space-y-2">
              {result.lint.issues.map((it, i) => (
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

          <div className="space-y-2">
            {result.cases.map((c, idx) => (
              <Card key={idx}>
                <CardContent className="py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="shrink-0">
                      {c.dimension}
                    </Badge>
                    <div
                      className="flex shrink-0 items-center gap-0.5"
                      role="group"
                      aria-label="Expected verdict"
                    >
                      <span className="text-xs text-muted-foreground">expect</span>
                      {(["PASS", "BLOCK"] as const).map((v) => {
                        const current = verdictOverrides[idx] ?? c.expectedVerdict;
                        return (
                          <Button
                            key={v}
                            size="sm"
                            variant={current === v ? "secondary" : "ghost"}
                            className="h-6 px-1.5 text-[11px]"
                            disabled={!!accepted[idx]}
                            onClick={() => setVerdictOverrides((m) => ({ ...m, [idx]: v }))}
                          >
                            {v}
                          </Button>
                        );
                      })}
                    </div>
                    {c.duplicateOf !== null && (
                      <Badge variant="outline" className="shrink-0 text-[10px]" title="Near-duplicate by embedding similarity">
                        ≈ case {c.duplicateOf + 1}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                    <Button
                      size="sm"
                      variant={accepted[idx] ? "secondary" : "default"}
                      disabled={!!accepted[idx] || accepting !== null}
                      onClick={() => accept(idx, c)}
                    >
                      {accepted[idx] ? "Accepted ✓" : accepting === idx ? "Saving…" : "Accept → golden"}
                    </Button>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs">
                    {c.artifact}
                  </pre>
                  <p className="mt-1.5 text-xs text-muted-foreground">{c.rationale}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
