import { streamChat, type ChatMessage } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getMemoryContext } from "@/lib/memory";
import { ERROR_SENTINEL } from "@/lib/ai/sentinel";

export { ERROR_SENTINEL };

type StreamTextArgs = {
  messages: ChatMessage[];
  /** Override the chat model (e.g. a vision-capable model for image input). */
  model?: string;
  /** Per-call override; defaults to the effective settings temperature. */
  temperature?: number;
  /** Called once with the full assembled text after the stream completes (e.g. to save). */
  onComplete?: (fullText: string) => Promise<void> | void;
  /** Prepend active memory facts as a leading system message. */
  injectMemory?: boolean;
  /** Scope injected memory to this project's facts (plus global). Resolve in handler scope. */
  memoryProjectId?: string | null;
  /** Relevance anchor: rank injected facts against this text (else recency). */
  memoryQuery?: string | null;
};

export function streamTextResponse({
  messages,
  model,
  temperature,
  onComplete,
  injectMemory,
  memoryProjectId,
  memoryQuery,
}: StreamTextArgs): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const cfg = await getEffectiveConfig();
        let msgs = messages;
        if (injectMemory) {
          const mem = await getMemoryContext({
            projectId: memoryProjectId ?? null,
            query: memoryQuery ?? null,
          });
          if (mem) msgs = [{ role: "system", content: mem }, ...messages];
        }
        for await (const token of streamChat(msgs, {
          temperature: temperature ?? cfg.temperature,
          model: model ?? cfg.model,
          baseUrl: cfg.baseUrl,
        })) {
          full += token;
          controller.enqueue(encoder.encode(token));
        }
        if (onComplete) await onComplete(full);
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream failed";
        controller.enqueue(encoder.encode(`\n${ERROR_SENTINEL} ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
