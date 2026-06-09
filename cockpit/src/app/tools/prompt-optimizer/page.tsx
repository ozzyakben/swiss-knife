"use client";

import { AiToolShell } from "@/components/tools/AiToolShell";

export default function PromptOptimizerPage() {
  return (
    <AiToolShell
      title="Prompt Optimizer"
      description="Rewrite a rough prompt into a sharp one using local Gemma."
      endpoint="/api/optimize"
      placeholder="Paste a rough prompt here..."
      runLabel="Optimize"
      outputLabel="Optimized prompt"
      enableSave
      saveLabel="Optimize & save to library"
      buildBody={(prompt, { save }) => ({ prompt, save })}
    />
  );
}
