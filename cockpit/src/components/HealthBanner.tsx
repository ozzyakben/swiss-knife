"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type Health =
  | { ok: true; model: string; baseUrl: string }
  | {
      ok: false;
      reason: "ollama_down" | "model_missing";
      model: string;
      baseUrl: string;
      detail?: string;
    };

/**
 * Shows a banner when the local engine is unavailable (Ollama down or the
 * model not pulled). Polls /api/health. Pass `initial` from a server component
 * to avoid a first-render flash; pass `showWhenOk` to also confirm readiness.
 */
export function HealthBanner({
  initial,
  showWhenOk = false,
}: {
  initial?: Health;
  showWhenOk?: boolean;
}) {
  const [health, setHealth] = useState<Health | null>(initial ?? null);
  const wasDownRef = useRef(initial ? !initial.ok : false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as Health;
        if (!active) return;
        setHealth(data);
        // The poll auto-recovers; confirm the moment the engine comes back.
        if (data.ok && wasDownRef.current) toast.success("Engine reconnected");
        wasDownRef.current = !data.ok;
      } catch {
        /* leave the last known state */
      }
    };
    if (!initial) load();
    const id = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [initial]);

  if (!health) return null;

  if (health.ok) {
    if (!showWhenOk) return null;
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Engine ready</AlertTitle>
        <AlertDescription>
          {health.model} via {health.baseUrl}
        </AlertDescription>
      </Alert>
    );
  }

  const isDown = health.reason === "ollama_down";
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{isDown ? "Engine offline" : "Model not pulled"}</AlertTitle>
      <AlertDescription>
        {isDown
          ? "Ollama isn't running. Start it with `ollama serve` — this clears automatically once it's back."
          : `The model "${health.model}" isn't pulled yet. Run: ollama pull ${health.model} — this clears once it's ready.`}
      </AlertDescription>
    </Alert>
  );
}
