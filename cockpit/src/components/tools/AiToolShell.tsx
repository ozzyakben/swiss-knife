"use client";

import { useRef, useState } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { AiOutput } from "@/components/tools/AiOutput";
import { ErrorAlert } from "@/components/ErrorAlert";

export type AiToolShellProps = {
  title: string;
  description?: string;
  endpoint: string;
  placeholder?: string;
  runLabel?: string;
  outputLabel?: string;
  /** Build the POST body for a run. */
  buildBody: (input: string) => unknown;
  /**
   * Save-AFTER-run: shown once a result exists, persists exactly what's on
   * screen. (The old "Run & save" re-ran the model, so the saved text was
   * never the text the user reviewed — and cost a second generation.)
   */
  onSaveResult?: (output: string, input: string) => Promise<void>;
  saveLabel?: string;
  savedMessage?: string;
};

/**
 * Shared shell for single-input AI tools: input, Run/Stop, streamed output with
 * copy, and an optional save-the-visible-result button. Richer tools compose
 * useAiTool + AiOutput directly with their own inputs.
 */
export function AiToolShell({
  title,
  description,
  endpoint,
  placeholder,
  runLabel = "Run",
  outputLabel = "Output",
  buildBody,
  onSaveResult,
  saveLabel = "Save to library",
  savedMessage = "Saved to library",
}: AiToolShellProps) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The input that produced the current output — save persists THIS pairing,
  // not whatever is in the box now (editable again after the run finishes).
  const lastRunInput = useRef("");
  const { output, status, error, isRunning, elapsedMs, run, stop } = useAiTool({
    endpoint,
    buildBody: (i) => buildBody(i),
  });
  const secs = Math.round(elapsedMs / 1000);

  async function handleRun() {
    setSaved(false);
    lastRunInput.current = input;
    await run(input);
  }

  async function handleSave() {
    if (!onSaveResult || !output) return;
    setSaving(true);
    try {
      await onSaveResult(output, lastRunInput.current);
      setSaved(true);
      toast.success(savedMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-muted-foreground">{description}</p>}

      <VoiceTextarea
        className="mt-6"
        rows={6}
        value={input}
        placeholder={placeholder}
        onValueChange={setInput}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && input.trim() && !isRunning) {
            e.preventDefault();
            handleRun();
          }
        }}
        disabled={isRunning}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={handleRun} disabled={isRunning || !input.trim()}>
          {isRunning ? `Running… ${secs}s` : runLabel}
        </Button>
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <ErrorAlert className="mt-4" title="Run failed" message={error} />}

      <AiOutput output={output} status={status} label={outputLabel} />

      {onSaveResult && status === "done" && output && (
        <div className="mt-3">
          <Button variant="outline" onClick={handleSave} disabled={saving || saved}>
            {saved ? "Saved ✓" : saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
