import Link from "next/link";
import { Button } from "@/components/ui/button";

// Global 404 — covers unmatched routes and any notFound() call (e.g. a deleted
// project at /tools/projects/[id]), keeping the themed app shell instead of the
// unstyled default Next 404.
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Not found</h2>
        <p className="text-sm text-muted-foreground">That page or item doesn&apos;t exist.</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
