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
      buildBody={(prompt) => ({ prompt })}
      onSaveResult={async (optimized, original) => {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ original, optimized }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Couldn't save the prompt.");
        }
      }}
    />
  );
}
