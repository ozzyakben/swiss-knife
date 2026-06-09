"use client";

import { Search } from "lucide-react";

/** Sidebar affordance that opens the global command palette (also bound to ⌘K). */
export function CommandHint() {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("swissknife:command"))}
      className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
