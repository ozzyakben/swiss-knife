"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/** Export everything to JSON / restore from a JSON backup. All local. */
export function DataBackup() {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const json = JSON.parse(await file.text());
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const imported = (data.imported ?? {}) as Record<string, number>;
      const skipped = (data.skipped ?? {}) as Record<string, number>;
      const total = Object.values(imported).reduce((a, b) => a + b, 0);
      const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
      if (skippedTotal > 0) {
        console.warn("Import skipped rows (per model):", skipped);
        toast.warning(`Imported ${total}, skipped ${skippedTotal} (see console)`);
      } else {
        toast.success(`Imported ${total} record(s)`);
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Backup &amp; restore</h2>
      <p className="text-xs text-muted-foreground">
        Everything stays on this machine. Export a full JSON backup, or restore one on a new
        machine (idempotent — restoring your own export is safe).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href="/api/export" download>
            Export all data
          </a>
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? "Importing…" : "Import backup"}
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      </div>
    </div>
  );
}
