"use client";

import { useEffect, useState } from "react";
import { Menu, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Below md: a slim top bar with a hamburger that opens the sidebar content as
 * a left drawer. The content itself is server-rendered and passed in, so this
 * stays a thin shell (state + overlay only).
 */
export function MobileSidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-2">
        <Button variant="ghost" size="sm" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Wrench className="h-[18px] w-[18px] text-muted-foreground" />
          Swiss Knife
        </span>
      </div>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <aside
            aria-label="Mobile navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-lg"
          >
            <div className="flex justify-end px-2 pt-2">
              <Button variant="ghost" size="sm" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            {/* The content is server-rendered, so close-on-navigate is handled
                by delegation: any link click inside the drawer closes it. */}
            <div
              className="flex min-h-0 flex-1 flex-col"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              {children}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
