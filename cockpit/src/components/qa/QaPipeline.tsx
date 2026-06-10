"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QaSessionView } from "@/components/qa/QaSessionView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import type { Iteration, Session, SessionSummary } from "@/components/qa/types";

type BenchResult = { id: string; expected: string; got: string; agree: boolean; story: string };
type Golden = { id: string; story: string; expectedVerdict: string };

const EXAMPLE = `As a cashier, I want to make a walk-in cash sale of in-stock items tax-exempt at the point of sale, so a tax-exempt customer is charged correctly.
The sale must record the tax-exemption reason, and an over-tender must return the right change.`;

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function QaPipeline({ initialSessionId = null }: { initialSessionId?: string | null }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState<Session | null>(null);
  const [input, setInput] = useState("");
  const [busyNew, setBusyNew] = useState(false);
  const [needsPack, setNeedsPack] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [benchBusy, setBenchBusy] = useState(false);
  const [bench, setBench] = useState<{
    total: number;
    agree: number;
    agreementPct: number | null;
    results?: BenchResult[];
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SessionSummary | null>(null);
  const [goldens, setGoldens] = useState<Golden[] | null>(null);

  async function runBench() {
    setBenchBusy(true);
    try {
      const data = await jsonFetch("/api/qa-pipeline/bench", { method: "POST" });
      if (data.needsPack) {
        toast.error("This project has no QA pack.");
        return;
      }
      setBench(data);
      toast.success(
        data.total === 0
          ? "No golden cases yet — save one from a session first."
          : `Bench: ${data.agree}/${data.total} agree (${data.agreementPct}%)`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bench failed");
    } finally {
      setBenchBusy(false);
    }
  }

  // ── Golden-case manager (the bench's input set; human-labeled) ────────────
  async function toggleGoldens() {
    if (goldens) {
      setGoldens(null);
      return;
    }
    try {
      const data = await jsonFetch("/api/qa-pipeline/golden");
      setGoldens(data.cases as Golden[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load goldens");
    }
  }

  async function relabelGolden(id: string, expectedVerdict: "PASS" | "BLOCK") {
    try {
      await jsonFetch(`/api/qa-pipeline/golden/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVerdict }),
      });
      setGoldens((gs) => gs?.map((g) => (g.id === id ? { ...g, expectedVerdict } : g)) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Relabel failed");
    }
  }

  async function deleteGolden(id: string) {
    try {
      await jsonFetch(`/api/qa-pipeline/golden/${id}`, { method: "DELETE" });
      setGoldens((gs) => gs?.filter((g) => g.id !== id) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const loadList = useCallback(async () => {
    try {
      const data = await jsonFetch("/api/qa-pipeline");
      setSessions(data.sessions as SessionSummary[]);
    } catch {
      // A failed list load is non-fatal; leave whatever we have.
    }
  }, []);

  // Initial load (inlined per the repo pattern: async + cancellation guard, so
  // no setState runs synchronously in the effect body). A ⌘K deep link
  // (?session=…) opens that session directly.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await jsonFetch("/api/qa-pipeline");
        if (active) setSessions(data.sessions as SessionSummary[]);
        if (active && initialSessionId) {
          const s = await jsonFetch(`/api/qa-pipeline/${initialSessionId}`).catch(() => null);
          if (active && s?.session) setActive(s.session as Session);
        }
      } catch {
        /* non-fatal */
      } finally {
        if (active) setLoadingList(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [initialSessionId]);

  // Replace one iteration inside the active session.
  const replaceIteration = (it: Iteration) =>
    setActive((s) =>
      s ? { ...s, iterations: s.iterations.map((x) => (x.id === it.id ? it : x)) } : s
    );

  async function startRun() {
    if (!input.trim()) return;
    setBusyNew(true);
    setNeedsPack(false);
    try {
      const data = await jsonFetch("/api/qa-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (data.needsPack) {
        setNeedsPack(true);
        return;
      }
      setActive(data.session as Session);
      setInput("");
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusyNew(false);
    }
  }

  async function openSession(id: string) {
    try {
      const data = await jsonFetch(`/api/qa-pipeline/${id}`);
      setActive(data.session as Session);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open session");
    }
  }

  async function deleteSessionById(id: string) {
    try {
      await jsonFetch(`/api/qa-pipeline/${id}`, { method: "DELETE" });
      setSessions((list) => list.filter((s) => s.id !== id));
      setActive((s) => (s?.id === id ? null : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // ── Session-view callbacks (operate on `active`) ──────────────────────────
  async function refine(instruction: string) {
    if (!active) return;
    try {
      const data = await jsonFetch(`/api/qa-pipeline/${active.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      if (data.needsPack) {
        toast.error("This project no longer has a QA pack.");
        return;
      }
      const it = data.iteration as Iteration;
      setActive((s) => (s ? { ...s, iterations: [...s.iterations, it] } : s));
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refine failed");
      throw e;
    }
  }

  async function editDraft(id: string, draftFeature: string) {
    try {
      const data = await jsonFetch(`/api/qa-pipeline/iteration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftFeature }),
      });
      replaceIteration(data.iteration as Iteration);
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Edit failed");
      throw e;
    }
  }

  async function rescore(id: string) {
    try {
      const data = await jsonFetch(`/api/qa-pipeline/iteration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescore: true }),
      });
      if (data.needsPack) {
        toast.error("This project no longer has a QA pack.");
        return;
      }
      replaceIteration(data.iteration as Iteration);
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-score failed");
      throw e;
    }
  }

  async function deleteIteration(id: string) {
    try {
      const data = await jsonFetch(`/api/qa-pipeline/iteration/${id}`, { method: "DELETE" });
      if (data.sessionDeleted) {
        const sid = active?.id;
        setActive(null);
        if (sid) setSessions((list) => list.filter((s) => s.id !== sid));
        return;
      }
      setActive((s) => (s ? { ...s, iterations: s.iterations.filter((x) => x.id !== id) } : s));
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      throw e;
    }
  }

  async function runImport() {
    if (!importText.trim()) return;
    setImportBusy(true);
    try {
      const data = await jsonFetch("/api/qa-pipeline/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      setInput(data.story);
      setNeedsPack(false);
      setImportOpen(false);
      setImportText("");
      toast.success("Ticket converted to a story — review and run");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  async function rename(title: string) {
    if (!active) return;
    try {
      await jsonFetch(`/api/qa-pipeline/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setActive((s) => (s ? { ...s, title } : s));
      setSessions((list) => list.map((s) => (s.id === active.id ? { ...s, title } : s)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
      throw e;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (active) {
    return (
      <div className="max-w-3xl">
        <QaSessionView
          session={active}
          onBack={() => {
            setActive(null);
            loadList();
          }}
          onRefine={refine}
          onEditDraft={editDraft}
          onRescore={rescore}
          onDeleteIteration={deleteIteration}
          onRename={rename}
          onDeleteSession={() => deleteSessionById(active.id)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">QA Pipeline</h1>
      <p className="mt-1 text-muted-foreground">
        Paste a user story. The active project supplies the QA context (Gherkin standards, eval
        rubric, glossary); this drafts a <code>.feature</code>, runs the deterministic lint, and
        scores it. Then refine it across iterations — by follow-up or by hand — and the run is saved.
      </p>

      <div className="mt-6">
        <VoiceTextarea
          rows={6}
          value={input}
          onValueChange={setInput}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && input.trim() && !busyNew) {
              e.preventDefault();
              startRun();
            }
          }}
          placeholder="Paste a user story / requirement…"
          disabled={busyNew}
        />
        <div className="mt-2 flex gap-2">
          <Button onClick={startRun} disabled={busyNew || !input.trim()}>
            {busyNew ? "Running…" : "Run"}
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={busyNew}>
            Import from ticket
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setInput(EXAMPLE);
              setNeedsPack(false);
            }}
            disabled={busyNew}
          >
            Load example
          </Button>
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from a ticket</DialogTitle>
            <DialogDescription>
              Paste a raw Jira/GitHub issue or requirement. Gemma extracts a clean user story and
              acceptance criteria into the box for you to review before running.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste the ticket title, description, acceptance criteria…"
            disabled={importBusy}
          />
          <DialogFooter>
            <Button onClick={runImport} disabled={importBusy || !importText.trim()}>
              {importBusy ? "Converting…" : "Extract story"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {needsPack && (
        <Card className="mt-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">This project has no QA pack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The active project is missing its Gherkin-authoring and eval-rubric templates (and
              glossary facts). If you have a project pack locally, seed it and switch to that
              project:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">
              npm run seed:lbmh
            </pre>
            <p>
              No pack? Packs are private and not in the repo — but Gherkin Lint and the Rubric
              Designer work standalone, no pack needed.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Eval bench</h2>
        <Button size="sm" variant="outline" onClick={runBench} disabled={benchBusy}>
          {benchBusy ? "Running…" : "Run eval bench"}
        </Button>
        <Button size="sm" variant="ghost" onClick={toggleGoldens}>
          {goldens ? "Hide goldens" : "Manage goldens"}
        </Button>
        {bench && bench.agreementPct !== null && (
          <span className="text-sm text-muted-foreground">
            {bench.agree}/{bench.total} goldens agree ·{" "}
            <span className={bench.agreementPct >= 80 ? "text-green-600" : "text-destructive"}>
              {bench.agreementPct}%
            </span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Save a session as a golden (story + verdict), then re-run the rubric over all goldens to catch
        drift after a prompt or model change.
      </p>

      {/* Per-case results: a drop in agreement is only actionable if you can see
          WHICH golden disagreed — and an engine ERROR must not read as drift. */}
      {bench && bench.results && bench.results.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Golden</th>
                <th className="px-2 py-1.5 text-left font-medium">Expected</th>
                <th className="px-2 py-1.5 text-left font-medium">Got</th>
              </tr>
            </thead>
            <tbody>
              {bench.results.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="max-w-[280px] truncate px-2 py-1.5">{r.story}</td>
                  <td className="px-2 py-1.5">{r.expected}</td>
                  <td className="px-2 py-1.5">
                    <Badge
                      variant={r.agree ? "secondary" : r.got === "ERROR" || r.got === "UNKNOWN" ? "outline" : "destructive"}
                      className="text-[10px]"
                    >
                      {r.got === "ERROR" ? "ERROR (engine)" : r.got}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {goldens && (
        <div className="mt-3 space-y-2">
          {goldens.length === 0 ? (
            <EmptyState title="No golden cases yet" hint="Save one from a session or accept eval cases." />
          ) : (
            goldens.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{g.story}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {(["PASS", "BLOCK"] as const).map((v) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={g.expectedVerdict === v ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => g.expectedVerdict !== v && relabelGolden(g.id, v)}
                    >
                      {v}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => deleteGolden(g.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">Saved sessions</h2>
        {loadingList ? (
          <LoadingState className="mt-2" />
        ) : sessions.length === 0 ? (
          <EmptyState
            className="mt-2"
            title="No saved sessions yet"
            hint="Run a story above to start one."
          />
        ) : (
          <div className="mt-2 space-y-2">
            {sessions.map((s) => (
              <Card key={s.id} className="transition-colors hover:border-foreground/30">
                <CardContent className="flex items-center gap-3 py-3">
                  <button onClick={() => openSession(s.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {s.iterationCount} iteration{s.iterationCount === 1 ? "" : "s"}
                      </span>
                      {s.latest && (
                        <Badge variant={s.latest.lintOk ? "secondary" : "destructive"} className="text-[10px]">
                          lint {s.latest.lintOk ? "PASS" : "BLOCK"}
                        </Badge>
                      )}
                      {s.latest?.verdict && (
                        <Badge
                          variant={s.latest.verdict === "PASS" ? "secondary" : s.latest.verdict === "BLOCK" ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          rubric {s.latest.verdict}
                        </Badge>
                      )}
                    </div>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(s)}>
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Same cascade as the in-session delete — same confirmation gate. */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`Delete "${confirmDelete?.title ?? ""}"?`}
        description="The story and every iteration in this session are deleted. This can't be undone."
        onConfirm={() => {
          if (confirmDelete) deleteSessionById(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
