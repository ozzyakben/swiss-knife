"use client";

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { Upload, Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { useIsMac } from "@/hooks/useIsMac";
import { AiOutput } from "@/components/tools/AiOutput";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert } from "@/components/ErrorAlert";

export default function ImagePage() {
  const isMac = useIsMac();
  const pasteKey = isMac ? "⌘V" : "Ctrl+V";
  const [image, setImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { output, status, error, isRunning, elapsedMs, run, stop } = useAiTool({
    endpoint: "/api/vision",
    buildBody: () => ({ prompt, image }),
  });
  const secs = Math.round(elapsedMs / 1000);

  function loadFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(typeof reader.result === "string" ? reader.result : null);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    loadFile(e.target.files?.[0]);
    e.target.value = "";
  }

  // macOS screenshots land on the clipboard (⌃⇧⌘4) — paste is the canonical
  // entry for this tool, not the file picker.
  function onPaste(e: ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      loadFile(item.getAsFile());
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    loadFile(e.dataTransfer.files?.[0]);
  }

  // The image + prompt that produced the current answer — save persists THIS
  // pairing, not whatever was swapped in after the run.
  const lastRun = useRef<{ image: string; prompt: string } | null>(null);

  async function handleRun() {
    if (!image) {
      toast.error("Attach an image first");
      return;
    }
    setSaved(false);
    lastRun.current = { image, prompt };
    await run("");
  }

  // Keep the answer: image + response become an Idea (like quick-capture).
  async function saveAsIdea() {
    if (!output || !lastRun.current) return;
    setSaving(true);
    try {
      const snap = lastRun.current;
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: snap.prompt.trim().slice(0, 80) || "Image note",
          topic: snap.prompt.trim() || "image capture",
          content: output,
          image: snap.image,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save.");
      }
      setSaved(true);
      toast.success("Saved as an idea");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl" onPaste={onPaste}>
      <h1 className="text-2xl font-semibold tracking-tight">Image</h1>
      <p className="mt-1 text-muted-foreground">
        Ask local Gemma about an image — paste a screenshot ({pasteKey}), drop a file, or upload.
        Nothing leaves your machine.
      </p>

      <div className="mt-6 space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={
            "rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground " +
            (over ? "border-foreground bg-accent" : "border-border")
          }
        >
          {image ? (
            // Local data-URL preview; next/image isn't needed for a transient upload.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="Upload preview" className="mx-auto max-h-64 rounded-md border border-border" />
          ) : (
            <p>Paste ({pasteKey}), drop an image here, or use the button below.</p>
          )}
        </div>

        <Button variant="outline" asChild>
          <label className="cursor-pointer">
            <Upload className="mr-1 h-4 w-4" /> {image ? "Change image" : "Upload image"}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
          </label>
        </Button>

        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && image && !isRunning) {
              e.preventDefault();
              handleRun();
            }
          }}
          placeholder="What do you want to know about this image? (default: describe it)"
          disabled={isRunning}
        />

        <div className="flex gap-2">
          <Button onClick={handleRun} disabled={isRunning || !image}>
            {isRunning ? `Looking… ${secs}s` : "Ask"}
          </Button>
          {isRunning && (
            <Button variant="ghost" onClick={stop}>
              <Square className="mr-1 h-4 w-4" /> Stop
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorAlert className="mt-4" title="Run failed" message={error} />}
      <AiOutput output={output} status={status} label="Answer" />

      {output && status === "done" && (
        <div className="mt-3">
          <Button variant="outline" onClick={saveAsIdea} disabled={saving || saved}>
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save as idea"}
          </Button>
        </div>
      )}
    </div>
  );
}
