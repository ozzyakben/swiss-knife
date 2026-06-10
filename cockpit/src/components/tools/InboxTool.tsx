"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { GHERKIN_PREFILL_KEY } from "@/lib/gherkinPrefill";

const isGherkin = (t: string) => /^\s*(Feature|Scenario|Scenario Outline|Example):/m.test(t);

type LintIssue = { severity: "ERROR" | "WARN"; line: number; message: string };
type LintResult = { issues: LintIssue[]; summary: { errors: number; warnings: number; scenarios: number }; ok: boolean };

/**
 * One capture surface: drop a text/.feature/.md file or paste a blob, and route
 * it. Gherkin lints right here (free, deterministic) with a prefilled handoff
 * to Gherkin Lint; anything else is chatJson-classified into a task/fact/idea
 * via quick-add. The net-new bit over the palette is file drop.
 */
export function InboxTool() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [lint, setLint] = useState<LintResult | null>(null);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/^(text\/|application\/json)/.test(file.type) && !/\.(feature|md|txt|csv)$/i.test(file.name)) {
      toast.error("Drop a text, .feature, .md, or .csv file (images → the Image tool).");
      return;
    }
    setText(await file.text());
    setLint(null);
    toast.success(`Loaded ${file.name}`);
  }

  // Lint in place — the lib is deterministic and free, so no bouncing the user
  // through the clipboard (the old handoff landed on an EMPTY lint page).
  async function lintHere() {
    setBusy(true);
    try {
      const res = await fetch("/api/gherkin-lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lint failed");
      setLint(data as LintResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lint failed");
    } finally {
      setBusy(false);
    }
  }

  function openInLint() {
    sessionStorage.setItem(GHERKIN_PREFILL_KEY, text);
    router.push("/tools/gherkin-lint");
  }

  async function fileIt() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const label = data.pending
        ? `Fact queued for review: ${data.title}`
        : `Filed as ${data.kind}: ${data.title}`;
      toast.success(label, {
        action: { label: "Undo", onClick: () => void fetch(data.deleteUrl, { method: "DELETE" }) },
      });
      setText("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Smart Inbox</h1>
      <p className="mt-1 text-muted-foreground">
        Drop a file or paste anything. Gherkin lints right here; everything else is sorted into a
        task, fact, or idea automatically.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={
          "mt-6 rounded-lg border-2 border-dashed p-1 " + (over ? "border-foreground bg-accent" : "border-border")
        }
      >
        <VoiceTextarea
          rows={10}
          value={text}
          onValueChange={(v) => {
            setText(v);
            // The verdict and line numbers describe the text they linted —
            // editing invalidates both.
            setLint(null);
          }}
          placeholder="Drop a .feature / .txt / .md / .csv here, or paste text…"
          textareaClassName="border-0 focus-visible:ring-0"
          disabled={busy}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isGherkin(text) ? (
          <>
            <Button onClick={lintHere} disabled={busy}>
              {busy ? "Linting…" : "Lint it"}
            </Button>
            <Button variant="outline" onClick={openInLint} disabled={busy}>
              <Upload className="mr-1 h-4 w-4" /> Open in Gherkin Lint
            </Button>
            <span className="text-xs text-muted-foreground">Looks like a .feature.</span>
          </>
        ) : (
          <Button onClick={fileIt} disabled={busy || !text.trim()}>
            {busy ? "Filing…" : "File it"}
          </Button>
        )}
      </div>

      {lint && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <Badge variant={lint.ok ? "secondary" : "destructive"}>{lint.ok ? "PASS" : "BLOCK"}</Badge>
            <span className="text-sm text-muted-foreground">
              {lint.summary.errors} error{lint.summary.errors === 1 ? "" : "s"}, {lint.summary.warnings}{" "}
              warning{lint.summary.warnings === 1 ? "" : "s"} · {lint.summary.scenarios} scenario
              {lint.summary.scenarios === 1 ? "" : "s"}
            </span>
          </div>
          {lint.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {lint.issues.slice(0, 8).map((it, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge variant={it.severity === "ERROR" ? "destructive" : "outline"} className="mt-0.5 text-[10px]">
                    {it.severity}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">L{it.line}</span>
                  <span className="min-w-0 flex-1">{it.message}</span>
                </li>
              ))}
              {lint.issues.length > 8 && (
                <li className="text-xs text-muted-foreground">
                  +{lint.issues.length - 8} more — open in Gherkin Lint for the full list.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
