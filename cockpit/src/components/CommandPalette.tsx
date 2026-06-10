"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VoiceButton } from "@/components/tools/VoiceButton";
import { NAV_ITEMS } from "@/lib/nav";
import { useIsMac } from "@/hooks/useIsMac";
import type { SearchResult } from "@/app/api/search/route";

// "Jump to" destinations DERIVED from the nav registry (lib/nav.tsx) — the
// palette used to hand-copy this list and drifted from the sidebar twice.
// Labels, order, and keywords now have exactly one home.
const NAV: { label: string; href: string; keywords?: string }[] = NAV_ITEMS.map((i) => ({
  label: i.label,
  href: i.href,
  keywords: i.keywords,
}));

// One-keystroke actions (badge "Run"), filtered like NAV entries.
type ActionId = "theme" | "reindex" | "new-qa" | "standup" | "wrapup" | "switch-project";
const ACTIONS: { id: ActionId; label: string; keywords: string }[] = [
  { id: "theme", label: "Toggle theme", keywords: "dark light mode appearance" },
  { id: "switch-project", label: "Switch project…", keywords: "active workspace scope" },
  { id: "reindex", label: "Reindex memory embeddings", keywords: "memory vectors embeddings" },
  { id: "new-qa", label: "New QA session", keywords: "story gherkin qa pipeline" },
  { id: "standup", label: "Run standup routine", keywords: "daily routine morning summary" },
  { id: "wrapup", label: "Run wrap-up routine", keywords: "daily routine evening summary" },
];

type ProjectLite = { id: string; name: string };

export function CommandPalette() {
  const IS_MAC = useIsMac();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"default" | "projects">("default");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // One reset path for EVERY open/close — Radix only fires onOpenChange for
  // internally-initiated changes (Esc, overlay click); the ⌘K/⌘P handlers and
  // run paths are programmatic and would otherwise leak active/answer/query
  // state into the next open.
  const resetTo = useCallback((nextMode: "default" | "projects") => {
    setMode(nextMode);
    setQ("");
    setActive(0);
    setAnswer(null);
    setResults([]);
  }, []);

  // Global ⌘K / Ctrl+K toggle, ⌘P / Ctrl+P for the project switcher, plus a
  // custom event so other UI can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        resetTo("default");
        setOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        resetTo("projects");
        setOpen(true);
      }
    };
    const onOpen = () => {
      resetTo("default");
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("swissknife:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("swissknife:command", onOpen);
    };
  }, [resetTo]);

  // Focus the search field whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The project list loads when the palette opens (cheap, always fresh).
  useEffect(() => {
    if (!open) return;
    let activeReq = true;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (activeReq && res.ok) setProjects((data.projects ?? []).map((p: ProjectLite) => ({ id: p.id, name: p.name })));
      } catch {
        /* the switch-project list just stays empty */
      }
    })();
    return () => {
      activeReq = false;
    };
  }, [open]);

  // Debounced cross-entity search; only fires once the term is long enough.
  // The stale flag stops a slow earlier response from overwriting results for
  // the current term (same pattern as the projects fetch above).
  useEffect(() => {
    if (!open || mode !== "default") return;
    const term = q.trim();
    if (term.length < 2) return;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (!stale) setResults(data.results ?? []);
      } catch {
        if (!stale) setResults([]);
      }
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, open, mode]);

  const navMatches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return NAV;
    return NAV.filter((n) => `${n.label} ${n.keywords ?? ""}`.toLowerCase().includes(term));
  }, [q]);

  const actionMatches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return ACTIONS;
    return ACTIONS.filter((a) => `${a.label} ${a.keywords}`.toLowerCase().includes(term));
  }, [q]);

  type Item =
    | { kind: "nav"; label: string; badge: string; href: string; sub?: string }
    | { kind: "result"; label: string; badge: string; href: string; sub?: string }
    | { kind: "ask" | "add"; label: string; badge: string; href: string }
    | { kind: "action"; label: string; badge: string; id: ActionId }
    | { kind: "project"; label: string; badge: string; projectId: string | null };

  const items = useMemo<Item[]>(() => {
    const term = q.trim();

    if (mode === "projects") {
      const all: Item[] = [
        { kind: "project", label: "No project — global", badge: "Switch", projectId: null },
        ...projects.map((p) => ({ kind: "project" as const, label: p.name, badge: "Switch", projectId: p.id })),
      ];
      if (!term) return all;
      return all.filter((p) => p.label.toLowerCase().includes(term.toLowerCase()));
    }

    // Stale results stay in state but are hidden until the term is long enough.
    const live = term.length >= 2 ? results : [];
    const base: Item[] = [
      ...navMatches.map((n) => ({ kind: "nav" as const, label: n.label, badge: "Go", href: n.href })),
      ...actionMatches.map((a) => ({ kind: "action" as const, label: a.label, badge: "Run", id: a.id })),
      ...live.map((r) => ({ kind: "result" as const, label: r.title, sub: r.subtitle, badge: r.type, href: r.href })),
    ];
    // Fallthrough actions: ask Gemma a one-shot question, or file the text as the
    // right kind (task/fact/idea) — both from anywhere, no mouse.
    if (term.length >= 3) {
      return [
        ...base,
        { kind: "ask" as const, label: `Ask “${term}”`, badge: "Ask", href: "" },
        { kind: "add" as const, label: `Add “${term}”…`, badge: "New", href: "" },
      ];
    }
    return base;
  }, [navMatches, actionMatches, results, q, mode, projects]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = useCallback(() => {
    setOpen(false);
    resetTo("default");
  }, [resetTo]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [router, close]
  );

  const quickAdd = useCallback(
    async (text: string) => {
      close();
      // Immediate feedback: the classify call runs on the local model and can
      // take seconds on a cold load — never leave the user wondering.
      const toastId = toast.loading("Adding…");
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
          : `Added ${data.kind}: ${data.title}`;
        toast.success(label, {
          id: toastId,
          action: {
            label: "Undo",
            onClick: () => void fetch(data.deleteUrl, { method: "DELETE" }).then(() => router.refresh()),
          },
        });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add", { id: toastId });
      }
    },
    [router, close]
  );

  const ask = useCallback(async (question: string) => {
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setAnswer(data.text || "(no answer)");
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : "Failed");
    } finally {
      setAsking(false);
    }
  }, []);

  const switchProject = useCallback(
    async (projectId: string | null, label: string) => {
      close();
      try {
        const res = await fetch("/api/projects/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) throw new Error("Couldn't switch project.");
        toast.success(`Active project: ${label}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't switch project.");
      }
    },
    [router, close]
  );

  const runRoutine = useCallback(
    async (slug: "standup" | "wrapup") => {
      close();
      try {
        // Routines are token-authed (headless Shortcut recipe); fetch the same
        // token the capture endpoint uses — all on this machine.
        const tokenRes = await fetch("/api/capture/token");
        const { token } = await tokenRes.json();
        const res = await fetch(`/api/routines/${slug}`, {
          method: "POST",
          headers: { "x-capture-token": token ?? "" },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Routine failed.");
        toast.success(`${slug === "standup" ? "Standup" : "Wrap-up"} captured to Ideas.`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Routine failed.");
      }
    },
    [router, close]
  );

  const performAction = useCallback(
    (id: ActionId) => {
      switch (id) {
        case "theme": {
          const next = resolvedTheme === "dark" ? "light" : "dark";
          setTheme(next);
          toast.success(`Theme: ${next}`);
          close();
          break;
        }
        case "switch-project":
          // The input keeps focus — the palette just re-enters in project mode.
          resetTo("projects");
          break;
        case "reindex":
          close();
          void fetch("/api/memory/reindex", { method: "POST" })
            .then(async (r) => {
              const d = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(d?.error || "Reindex failed.");
              toast.success("Memory embeddings reindexed.");
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : "Reindex failed."));
          break;
        case "new-qa":
          go("/tools/qa-pipeline");
          break;
        case "standup":
          void runRoutine("standup");
          break;
        case "wrapup":
          void runRoutine("wrapup");
          break;
      }
    },
    [resolvedTheme, setTheme, close, go, runRoutine, resetTo]
  );

  const run = useCallback(
    (it: Item) => {
      if (it.kind === "add") quickAdd(q.trim());
      else if (it.kind === "ask") ask(q.trim());
      else if (it.kind === "action") performAction(it.id);
      else if (it.kind === "project") switchProject(it.projectId, it.label);
      else go(it.href);
    },
    [go, quickAdd, ask, q, performAction, switchProject]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) run(it);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetTo("default");
        else setActive(0);
      }}
    >
      <DialogContent
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        showClose={false}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setAnswer(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              mode === "projects"
                ? "Switch to project…"
                : "Search prompts, tasks, facts, QA… or jump to a tool"
            }
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <VoiceButton onText={(t) => setQ(t)} />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            {mode === "projects" ? (IS_MAC ? "⌘P" : "Ctrl P") : IS_MAC ? "⌘K" : "Ctrl K"}
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {mode === "projects"
                ? "No matching project."
                : q.trim().length < 2
                  ? "Type to search across everything."
                  : "No matches."}
            </p>
          ) : (
            items.map((it, i) => (
              <button
                key={`${it.kind}-${i}`}
                data-i={i}
                onClick={() => run(it)}
                onMouseMove={() => setActive(i)}
                className={
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm " +
                  (i === active ? "bg-accent text-accent-foreground" : "")
                }
              >
                <span className="flex-1 truncate">
                  {it.label}
                  {it.kind === "result" && it.sub ? <span className="text-muted-foreground"> — {it.sub}</span> : null}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{it.badge}</span>
              </button>
            ))
          )}
        </div>

        {(asking || answer) && (
          <div className="max-h-48 overflow-y-auto border-t border-border p-3 text-sm">
            {asking ? (
              <p className="text-muted-foreground">Thinking…</p>
            ) : (
              <p className="whitespace-pre-wrap">{answer}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> open
          </span>
          <span>{IS_MAC ? "⌘P" : "Ctrl P"} projects</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
