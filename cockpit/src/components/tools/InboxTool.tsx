"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";

const isGherkin = (t: string) => /^\s*(Feature|Scenario|Scenario Outline|Example):/m.test(t);

/**
 * One capture surface: drop a text/.feature/.md file or paste a blob, and route
 * it. Gherkin goes to the QA pipeline; anything else is chatJson-classified into
 * a task/fact/idea via quick-add. The net-new bit over the palette is file drop.
 */
export function InboxTool() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

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
    toast.success(`Loaded ${file.name}`);
  }

  function sendToLint() {
    navigator.clipboard.writeText(text);
    toast.success("Copied — paste it into Gherkin Lint");
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
      toast.success(`Filed as ${data.kind}: ${data.title}`, {
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
        Drop a file or paste anything. Gherkin goes to the QA pipeline; everything else is sorted
        into a task, fact, or idea automatically.
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
          onValueChange={setText}
          placeholder="Drop a .feature / .txt / .md / .csv here, or paste text…"
          textareaClassName="border-0 focus-visible:ring-0"
          disabled={busy}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isGherkin(text) ? (
          <Button onClick={sendToLint} disabled={busy}>
            <Upload className="mr-1 h-4 w-4" /> Open in Gherkin Lint
          </Button>
        ) : (
          <Button onClick={fileIt} disabled={busy || !text.trim()}>
            {busy ? "Filing…" : "File it"}
          </Button>
        )}
        {isGherkin(text) && (
          <span className="text-xs text-muted-foreground">Looks like a .feature — lint it.</span>
        )}
      </div>
    </div>
  );
}
