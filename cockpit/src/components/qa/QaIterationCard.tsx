"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { analyzeCoverage } from "@/lib/gherkinLint";
import { downloadText } from "@/lib/download";
import type { Iteration } from "@/components/qa/types";

type Props = {
  iteration: Iteration;
  /** True when this is the session's only iteration — deleting it deletes the session. */
  isOnly?: boolean;
  onEditDraft: (id: string, draftFeature: string) => Promise<void>;
  onRescore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function QaIterationCard({ iteration: it, isOnly = false, onEditDraft, onRescore, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.draftFeature);
  const [busy, setBusy] = useState<"save" | "rescore" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!draft.trim() || draft === it.draftFeature) {
      setEditing(false);
      return;
    }
    setBusy("save");
    try {
      await onEditDraft(it.id, draft);
      setEditing(false);
    } finally {
      setBusy(null);
    }
  }

  async function rescore() {
    setBusy("rescore");
    try {
      await onRescore(it.id);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await onDelete(it.id);
    } finally {
      setBusy(null);
    }
  }

  const lint = it.lint;
  const rubric = it.rubric;
  const coverage = analyzeCoverage(it.draftFeature);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0">
        <span className="text-sm font-semibold">Iteration {it.order}</span>
        {it.instruction && (
          <Badge variant="outline" className="font-normal" title={it.instruction}>
            refine: {it.instruction.length > 40 ? it.instruction.slice(0, 38) + "…" : it.instruction}
          </Badge>
        )}
        {it.edited && <Badge variant="outline">edited</Badge>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Badge variant={lint.ok ? "secondary" : "destructive"}>
            lint {lint.ok ? "PASS" : "BLOCK"}
          </Badge>
          <Badge
            variant={
              !rubric || rubric.verdict === "UNKNOWN"
                ? "outline"
                : rubric.verdict === "PASS"
                  ? "secondary"
                  : "destructive"
            }
          >
            rubric {rubric ? rubric.verdict : "STALE"}
            {rubric && typeof rubric.score === "number" ? ` · ${rubric.score}/100` : ""}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Draft */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Drafted .feature
            </h3>
            {!editing && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadText(`iteration-${it.order}.feature`, it.draftFeature, "text/plain")}
                  title="Download as a .feature file"
                >
                  Export .feature
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(it.draftFeature);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              <Textarea
                rows={Math.min(20, Math.max(8, draft.split("\n").length + 1))}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="font-mono text-xs"
                disabled={busy === "save"}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={busy === "save"}>
                  {busy === "save" ? "Saving…" : "Save & re-lint"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(it.draftFeature);
                    setEditing(false);
                  }}
                  disabled={busy === "save"}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">
              {it.draftFeature}
            </pre>
          )}
        </section>

        {/* Lint */}
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lint
          </h3>
          <p className="text-sm text-muted-foreground">
            {lint.summary.errors} error{lint.summary.errors === 1 ? "" : "s"}, {lint.summary.warnings}{" "}
            warning{lint.summary.warnings === 1 ? "" : "s"} · {lint.summary.scenarios} scenario
            {lint.summary.scenarios === 1 ? "" : "s"}
          </p>
          {lint.issues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Clean — no issues found.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {lint.issues.map((iss, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-border p-2">
                  <Badge
                    variant={iss.severity === "ERROR" ? "destructive" : "outline"}
                    className="mt-0.5 text-[10px]"
                  >
                    {iss.severity}
                  </Badge>
                  <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">L{iss.line}</span>
                  <span className="flex-1 text-sm">{iss.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Coverage */}
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coverage
          </h3>
          <p className="text-sm text-muted-foreground">
            {coverage.scenarios} scenario{coverage.scenarios === 1 ? "" : "s"} · {coverage.intents.valid} valid ·{" "}
            {coverage.intents.invalid} invalid · {coverage.intents.security} security
          </p>
          {coverage.gaps.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {coverage.gaps.map((g, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-dashed border-border p-2">
                  <Badge variant="outline" className="mt-0.5 text-[10px]">
                    GAP
                  </Badge>
                  <span className="flex-1 text-sm">{g}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Rubric */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Rubric score
            </h3>
            <Button size="sm" variant="ghost" onClick={rescore} disabled={busy === "rescore"}>
              {busy === "rescore" ? "Scoring…" : rubric ? "Re-score" : "Score now"}
            </Button>
          </div>
          {rubric ? (
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm text-foreground">
              {rubric.raw}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not scored since the last edit. Re-score to check it against the rubric.
            </p>
          )}
        </section>

        <div className="flex justify-end border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy === "delete"}>
            {busy === "delete" ? "Deleting…" : "Delete iteration"}
          </Button>
        </div>

        {/* Deleting the ONLY iteration cascades into deleting the whole session —
            the dialog says so instead of letting that surprise the user. */}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={isOnly ? "Delete the whole session?" : `Delete iteration ${it.order}?`}
          description={
            isOnly
              ? "This is the only iteration — deleting it deletes the session and its story too."
              : "The draft, lint result, and score of this iteration are removed."
          }
          confirmLabel={isOnly ? "Delete session" : "Delete iteration"}
          onConfirm={remove}
        />
      </CardContent>
    </Card>
  );
}
