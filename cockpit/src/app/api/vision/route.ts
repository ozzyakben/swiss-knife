import { assertOllamaReady } from "@/lib/health";
import { streamChatWithImages } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { DEFAULT_VISION_PROMPT } from "@/lib/vision";
import { ERROR_SENTINEL } from "@/lib/ai/sentinel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Gate on the model this route actually runs: the VISION model. Probing the
  // chat model let "chat=12b-mlx, e4b not pulled" pass and die mid-stream.
  const { baseUrl, temperature, visionModel } = await getEffectiveConfig();
  const notReady = await assertOllamaReady(visionModel);
  if (notReady) return notReady;

  const { prompt, image } = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    image?: string;
  };

  if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
    return Response.json({ error: "Attach an image first." }, { status: 400 });
  }
  const text = prompt?.trim() || DEFAULT_VISION_PROMPT;
  const encoder = new TextEncoder();
  // Propagate a client disconnect to the upstream vision fetch so a cancelled
  // request stops generating (mirrors streamTextResponse).
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* client already gone */
        }
      };
      try {
        for await (const token of streamChatWithImages(text, [image], {
          model: visionModel,
          baseUrl,
          temperature,
          signal: ac.signal,
        })) {
          controller.enqueue(encoder.encode(token));
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          const msg = err instanceof Error ? err.message : "vision failed";
          safeEnqueue(`\n${ERROR_SENTINEL} ${msg}`);
        }
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      ac.abort();
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
