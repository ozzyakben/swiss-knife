"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { AiOutput } from "@/components/tools/AiOutput";
import { ErrorAlert } from "@/components/ErrorAlert";
import { BigOSection } from "@/components/code/BigOSection";
import type { SmellResult } from "@/lib/codeSmells";

export function CodeReviewer() {
  const [code, setCode] = useState("");
  const [scan, setScan] = useState<SmellResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const { output, status, error, isRunning, elapsedMs, run, stop, reset } = useAiTool({
    endpoint: "/api/code-review",
    buildBody: (input) => ({ code: input }),
  });
  const secs = Math.round(elapsedMs / 1000);

  async function handleReview() {
    if (!code.trim()) return;
    setScan(null);
    reset();
    setScanning(true);
    let result: SmellResult | null = null;
    try {
      const res = await fetch("/api/code-smells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Scan failed");
      result = data as SmellResult;
      setScan(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
      return;
    } finally {
      setScanning(false);
    }
    // The scan is the gate; the model only explains what it found. A clean
    // scan skips the model entirely (free, instant).
    if (result.issues.length > 0) await run(code);
  }

  const s = scan?.summary;
  const busy = scanning || isRunning;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Code Review</h1>
      <p className="mt-1 text-muted-foreground">
        Paste TS/JS code or a unified diff. A deterministic scanner finds the smells — cyclomatic
        complexity, deep nesting, long parameter lists, magic numbers, duplicated blocks — and the
        local model explains the findings with targeted fixes.
      </p>

      <VoiceTextarea
        className="mt-6"
        rows={14}
        value={code}
        placeholder="Paste TS/JS code or a unified diff…"
        onValueChange={setCode}
        textareaClassName="font-mono text-sm"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && code.trim() && !busy) {
            e.preventDefault();
            handleReview();
          }
        }}
        disabled={busy}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={handleReview} disabled={busy || !code.trim()}>
          {scanning ? "Scanning…" : isRunning ? `Explaining… ${secs}s` : "Review"}
        </Button>
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <ErrorAlert className="mt-4" title="Explanation failed" message={error} />}

      {scan && s && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            {/* Three states: BLOCK (errors), PASS · N warnings, clean PASS — a
                green "GATE PASS" above a list of warnings read contradictory. */}
            <Badge
              variant={!scan.ok ? "destructive" : s.warnings > 0 ? "outline" : "secondary"}
              className="shrink-0 whitespace-nowrap"
            >
              {!scan.ok ? "GATE BLOCK" : s.warnings > 0 ? `PASS · ${s.warnings} warning${s.warnings === 1 ? "" : "s"}` : "GATE PASS"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {s.errors} error{s.errors === 1 ? "" : "s"}, {s.warnings} warning
              {s.warnings === 1 ? "" : "s"} · {s.functions} function{s.functions === 1 ? "" : "s"} ·{" "}
              {s.lines} line{s.lines === 1 ? "" : "s"}
            </span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {s.mode}
            </Badge>
          </div>

          {scan.issues.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Clean — no smells found.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {scan.issues.map((it, i) => (
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
                    <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                      {it.rule}
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm">{it.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <AiOutput output={output} status={status} label="Review notes" />

      {/* The old standalone Complexity Analyzer, folded in as an opt-in pass
          over the same paste — one destination for code questions. */}
      <BigOSection code={code} disabled={busy} />
    </div>
  );
}
