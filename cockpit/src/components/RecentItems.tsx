"use client";

import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type RecentItem = { id: string; title: string; badges?: string[]; body: string };

/** A simple "recent saved items" list with copy + delete. Refreshes the server component on delete. */
export function RecentItems({
  heading,
  items,
  deleteBase,
}: {
  heading: string;
  items: RecentItem[];
  deleteBase: string;
}) {
  const router = useRouter();
  if (items.length === 0) return null;

  async function remove(id: string) {
    const res = await fetch(`${deleteBase}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-muted-foreground">{heading}</h2>
      <div className="mt-2 space-y-2">
        {items.map((it) => (
          <Card key={it.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 py-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                {it.title}
                {it.badges?.map((b) => (
                  <Badge key={b} variant="outline" className="text-[10px]">
                    {b}
                  </Badge>
                ))}
              </CardTitle>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Copy"
                  onClick={() => {
                    navigator.clipboard.writeText(it.body);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Delete"
                  onClick={() => remove(it.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {it.body}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
