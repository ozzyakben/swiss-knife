"use client";

import { useRef, useState } from "react";
import { Square } from "lucide-react";

import { useAiTool } from "@/hooks/useAiTool";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AiOutput } from "@/components/tools/AiOutput";
import { ErrorAlert } from "@/components/ErrorAlert";
import type { ClaimIssue, ComplexityScan } from "@/lib/complexity";

type Verdict = { timeBigO: string; spaceBigO: string; hotspots: { line: number; note: string }[] };
type Result = { verdict: Verdict; scan: ComplexityScan; warnings: ClaimIssue[]; ok: boolean };

/**
 * Opt-in Big-O estimate inside Code Review (the old standalone Complexity
 * Analyzer, folded in). Two explicit steps, each its own model call: the
 * schema-locked verdict (audited by the deterministic growth scan), then an
 * optional streamed derivation — never auto-run, cold 12B loads are minutes.
 */
export function BigOSection({ code, disabled }: { code: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The snippet the verdict describes — the derivation runs on THIS snapshot,
  // not whatever is in the editor by then (stale verdict + new code would
  // produce a confidently wrong walkthrough).
  const analyzedCode = useRef("");

  const derivation = useAiTool({
    endpoint: "/api/complexity-derivation",
    buildBody: (input, extra) => ({
      code: input,
      timeBigO: extra?.timeBigO,
      spaceBigO: extra?.spaceBigO,
    }),
  });

  async function analyze() {
    if (!code.trim() || busy || derivation.isRunning) return;
    setBusy(true);
    setError(null);
    setResult(null);
    derivation.reset();
    setSecs(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => setSecs(Math.round((Date.now() - startedAt) / 1000)), 500);
    try {
      const res = await fetch("/api/complexity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't analyze the snippet.");
      analyzedCode.current = code;
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't analyze the snippet.");
    } finally {
      setBusy(false);
      if (timer.current) clearInterval(timer.current);
    }
  }

  const scan = result?.scan;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Big-O estimate</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={analyze}
          disabled={disabled || busy || derivation.isRunning || !code.trim()}
        >
          {busy ? `Estimating… ${secs}s` : "Estimate Big-O"}
        </Button>
        {result && !derivation.output && !derivation.isRunning && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              derivation.run(analyzedCode.current, {
                timeBigO: result.verdict.timeBigO,
                spaceBigO: result.verdict.spaceBigO,
              })
            }
          >
            Derive step-by-step
          </Button>
        )}
        {derivation.isRunning && (
          <Button size="sm" variant="ghost" onClick={derivation.stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Schema-locked model estimate, audited by a deterministic growth scan — a super-linear claim
        over code with no loops/recursion/sort gets flagged, not trusted.
      </p>

      {error && <ErrorAlert className="mt-3" title="Estimate failed" message={error} />}

      {result && scan && (
        <div className="mt-3 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary" className="shrink-0 font-mono">
              time {result.verdict.timeBigO}
            </Badge>
            <Badge variant="secondary" className="shrink-0 font-mono">
              space {result.verdict.spaceBigO}
            </Badge>
            <Badge variant={result.ok ? "outline" : "destructive"} className="shrink-0">
              {result.ok ? "scan-consistent" : "questionable claim"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              loop depth {scan.maxLoopDepth} · recursion {scan.hasRecursion ? "yes" : "no"} · sort{" "}
              {scan.hasSort ? "yes" : "no"}
            </span>
          </div>

          {result.warnings.length > 0 && (
            <div className="space-y-2">
              {result.warnings.map((w, i) => (
                <Card key={i}>
                  <CardContent className="flex items-start gap-3 py-3">
                    <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                      WARN
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm">{w.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {result.verdict.hotspots.length > 0 && (
            <Card>
              <CardContent className="py-3">
                <p className="text-xs font-medium text-muted-foreground">Hotspots</p>
                <div className="mt-2 space-y-1.5">
                  {result.verdict.hotspots.map((h, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                        L{h.line}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">{h.note}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <AiOutput output={derivation.output} status={derivation.status} label="Derivation" />
      {derivation.error && (
        <ErrorAlert className="mt-3" title="Derivation failed" message={derivation.error} />
      )}
    </div>
  );
}
