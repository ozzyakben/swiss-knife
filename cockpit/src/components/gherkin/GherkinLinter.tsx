"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Issue = { severity: "ERROR" | "WARN"; line: number; message: string };
type Result = {
  issues: Issue[];
  summary: { errors: number; warnings: number; scenarios: number };
  ok: boolean;
};

const EXAMPLE = `Feature: Point of Sale — cash sale
  A walk-in customer buys in-stock items and pays cash.

  @valid @smoke @ui
  Scenario: a completed cash sale prints a receipt
    Given an open Cash Drawer [drawer]
    And a Cart [cart] holding one in-stock item
    When the cashier tenders the exact cash amount
    Then the sale is invoiced against [drawer]
    And a receipt prints for [cart]`;

export function GherkinLinter() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function lint() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gherkin-lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lint failed");
      setResult(data as Result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lint failed");
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Gherkin Lint</h1>
      <p className="mt-1 text-muted-foreground">
        Check a .feature for BDD hygiene: standard tags, one event per scenario, business-level
        language (no UI/selector/SQL leakage), and the {"{Type} [name]"} entity convention. Runs
        locally; no model needed.
      </p>

      <div className="mt-6">
        <VoiceTextarea
          rows={12}
          value={text}
          onValueChange={setText}
          placeholder="Paste a .feature file…"
          textareaClassName="font-mono text-sm"
          disabled={busy}
        />
        <div className="mt-2 flex gap-2">
          <Button onClick={lint} disabled={busy || !text.trim()}>
            {busy ? "Linting…" : "Lint"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setText(EXAMPLE);
              setResult(null);
            }}
            disabled={busy}
          >
            Load example
          </Button>
        </div>
      </div>

      {result && s && (
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <Badge variant={result.ok ? "secondary" : "destructive"}>{result.ok ? "PASS" : "BLOCK"}</Badge>
            <span className="text-sm text-muted-foreground">
              {s.errors} error{s.errors === 1 ? "" : "s"}, {s.warnings} warning
              {s.warnings === 1 ? "" : "s"} · {s.scenarios} scenario{s.scenarios === 1 ? "" : "s"}
            </span>
          </div>

          {result.issues.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Clean — no issues found.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {result.issues.map((it, i) => (
                <Card key={i}>
                  <CardContent className="flex items-start gap-3 py-3">
                    <Badge
                      variant={it.severity === "ERROR" ? "destructive" : "outline"}
                      className="mt-0.5 text-[10px]"
                    >
                      {it.severity}
                    </Badge>
                    <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">L{it.line}</span>
                    <span className="flex-1 text-sm">{it.message}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
