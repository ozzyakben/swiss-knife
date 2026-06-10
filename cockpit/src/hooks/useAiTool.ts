"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ERROR_SENTINEL } from "@/lib/ai/sentinel";

export type AiToolStatus = "idle" | "streaming" | "done" | "error";

export type UseAiToolOptions = {
  endpoint: string;
  buildBody: (input: string, extra?: Record<string, unknown>) => unknown;
};

export type UseAiToolReturn = {
  output: string;
  status: AiToolStatus;
  error: string | null;
  isRunning: boolean;
  /** Milliseconds elapsed on the current/last run — surfaces cold-load latency. */
  elapsedMs: number;
  /** Returns true on a clean completion (used to flash "saved"). */
  run: (input: string, extra?: Record<string, unknown>) => Promise<boolean>;
  stop: () => void;
  reset: () => void;
};

export function useAiTool({ endpoint, buildBody }: UseAiToolOptions): UseAiToolReturn {
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<AiToolStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Abort any in-flight stream when the view unmounts: navigating away used to
  // leave the single local engine generating to completion for nobody (the
  // server's cancel() propagation only fires on an explicit reader abort).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const run = useCallback(
    async (input: string, extra?: Record<string, unknown>): Promise<boolean> => {
      setOutput("");
      setError(null);
      setStatus("streaming");
      setElapsedMs(0);
      const startedAt = Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(input, extra)),
          signal: ctrl.signal,
        });

        // Non-streaming error path (validation 400, health 503): JSON { error }.
        if (!res.ok || !res.body) {
          let msg = `Request failed (${res.status})`;
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch {
            /* keep default message */
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          // The server may inject an in-band error after partial output.
          if (acc.includes(ERROR_SENTINEL)) {
            const [text, err] = acc.split(ERROR_SENTINEL);
            setOutput(text);
            throw new Error(err?.trim() || "Stream error");
          }
          setOutput(acc);
        }
        setStatus("done");
        return true;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setStatus("idle");
          return false;
        }
        setError(e instanceof Error ? e.message : "Something went wrong");
        setStatus("error");
        return false;
      } finally {
        abortRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    },
    [endpoint, buildBody]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setOutput("");
    setError(null);
    setStatus("idle");
    setElapsedMs(0);
  }, []);

  return { output, status, error, isRunning: status === "streaming", elapsedMs, run, stop, reset };
}
