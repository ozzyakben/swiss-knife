"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VoiceButton } from "@/components/tools/VoiceButton";
import type { SearchResult } from "@/app/api/search/route";

// Static "jump to" destinations. The palette filters these by the query and
// shows them above live content matches.
const NAV: { label: string; href: string; keywords?: string }[] = [
  { label: "Dashboard", href: "/", keywords: "home brief today" },
  { label: "Prompt Optimizer", href: "/tools/prompt-optimizer", keywords: "sharpen" },
  { label: "Prompt Library", href: "/tools/prompt-library", keywords: "templates" },
  { label: "Email Writer", href: "/tools/email-writer", keywords: "compose reply" },
  { label: "Brainstorming", href: "/tools/brainstorm", keywords: "ideas techniques" },
  { label: "Image", href: "/tools/image", keywords: "vision photo" },
  { label: "Tasks", href: "/tools/tasks", keywords: "todo kanban board" },
  { label: "Gherkin Lint", href: "/tools/gherkin-lint", keywords: "bdd feature" },
  { label: "QA Pipeline", href: "/tools/qa-pipeline", keywords: "story rubric test" },
  { label: "Memory", href: "/tools/memory", keywords: "facts glossary" },
  { label: "Projects", href: "/tools/projects", keywords: "hub" },
  { label: "Settings", href: "/settings", keywords: "model theme health" },
];

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K toggle, plus a custom event so other UI can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("swissknife:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("swissknife:command", onOpen);
    };
  }, []);

  // Focus the search field whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced cross-entity search; only fires once the term is long enough.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const navMatches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return NAV;
    return NAV.filter((n) => `${n.label} ${n.keywords ?? ""}`.toLowerCase().includes(term));
  }, [q]);

  const items = useMemo(() => {
    const term = q.trim();
    // Stale results stay in state but are hidden until the term is long enough.
    const live = term.length >= 2 ? results : [];
    const base = [
      ...navMatches.map((n) => ({ kind: "nav" as const, label: n.label, badge: "Go", href: n.href })),
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
  }, [navMatches, results, q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQ("");
      router.push(href);
    },
    [router]
  );

  const quickAdd = useCallback(
    async (text: string) => {
      setOpen(false);
      setQ("");
      try {
        const res = await fetch("/api/quick-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        toast.success(`Added ${data.kind}: ${data.title}`, {
          action: {
            label: "Undo",
            onClick: () => void fetch(data.deleteUrl, { method: "DELETE" }).then(() => router.refresh()),
          },
        });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add");
      }
    },
    [router]
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

  const run = useCallback(
    (it: { kind: string; href: string }) => {
      if (it.kind === "add") quickAdd(q.trim());
      else if (it.kind === "ask") ask(q.trim());
      else go(it.href);
    },
    [go, quickAdd, ask, q]
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
        setActive(0);
        setAnswer(null);
        if (!o) setQ("");
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
            placeholder="Search prompts, tasks, facts, QA… or jump to a tool"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <VoiceButton onText={(t) => setQ(t)} />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            {IS_MAC ? "⌘K" : "Ctrl K"}
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q.trim().length < 2 ? "Type to search across everything." : "No matches."}
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
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
