"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { FEATURED_TOOLS } from "@/lib/nav";
import { usePersisted } from "@/hooks/usePersisted";

/**
 * The dashboard tool grid, favorites-first: the same star you set in the
 * sidebar floats those tools to the top of the grid (the grid used to bury
 * daily anchors among occasional tools in fixed registry order).
 */
export function DashboardToolGrid() {
  const [favJson] = usePersisted("sk:nav:favorites", "[]");

  const tools = useMemo(() => {
    let favs: Set<string>;
    try {
      const a = JSON.parse(favJson);
      favs = new Set<string>(Array.isArray(a) ? a : []);
    } catch {
      favs = new Set<string>();
    }
    if (favs.size === 0) return FEATURED_TOOLS;
    return [...FEATURED_TOOLS.filter((t) => favs.has(t.href)), ...FEATURED_TOOLS.filter((t) => !favs.has(t.href))];
  }, [favJson]);

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href} className="group">
            <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-accent/40">
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-tight">{t.label}</div>
                  <div className="mt-1 text-xs leading-snug text-muted-foreground">{t.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
