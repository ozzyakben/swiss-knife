"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiOutput } from "@/components/tools/AiOutput";

export type AiToolShellProps = {
  title: string;
  description?: string;
  endpoint: string;
  placeholder?: string;
  runLabel?: string;
  outputLabel?: string;
  /** Build the POST body. `save` is true when the save button was used. */
  buildBody: (input: string, opts: { save: boolean }) => unknown;
  enableSave?: boolean;
  saveLabel?: string;
  savedMessage?: string;
};

/**
 * Shared shell for single-input AI tools: input, Run/Stop, streamed output with
 * copy, and an optional run-and-save button. Richer tools compose useAiTool +
 * AiOutput directly with their own inputs.
 */
export function AiToolShell({
  title,
  description,
  endpoint,
  placeholder,
  runLabel = "Run",
  outputLabel = "Output",
  buildBody,
  enableSave = false,
  saveLabel = "Run & save",
  savedMessage = "Saved to library",
}: AiToolShellProps) {
  const [input, setInput] = useState("");
  const { output, status, error, isRunning, elapsedMs, run, stop } = useAiTool({
    endpoint,
    buildBody: (i, extra) => buildBody(i, { save: Boolean(extra?.save) }),
  });
  const secs = Math.round(elapsedMs / 1000);

  async function handleRun(save: boolean) {
    const ok = await run(input, { save });
    if (ok && save) toast.success(savedMessage);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="mt-1 text-muted-foreground">{description}</p>}

      <Textarea
        className="mt-6"
        rows={6}
        value={input}
        placeholder={placeholder}
        onChange={(e) => setInput(e.target.value)}
        disabled={isRunning}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => handleRun(false)} disabled={isRunning || !input.trim()}>
          {isRunning ? `Running… ${secs}s` : runLabel}
        </Button>
        {enableSave && (
          <Button
            variant="outline"
            onClick={() => handleRun(true)}
            disabled={isRunning || !input.trim()}
          >
            {saveLabel}
          </Button>
        )}
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">⚠ {error}</p>}

      <AiOutput output={output} status={status} label={outputLabel} />
    </div>
  );
}
