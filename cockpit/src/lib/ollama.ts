// Thin client for the local Ollama OpenAI-compatible endpoint.
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type ChatOptions = {
  temperature?: number;
  /** Override the configured model (e.g. from app settings). */
  model?: string;
  /** Override the configured OpenAI-compatible base URL. */
  baseUrl?: string;
  /** Allow cancellation from the caller. */
  signal?: AbortSignal;
};

function completionsUrl(baseUrl?: string) {
  return `${baseUrl ?? BASE}/chat/completions`;
}

function body(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: opts.model ?? MODEL,
    messages,
    temperature: opts.temperature ?? 0.4,
    stream,
  });
}

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer ollama", // required by the protocol but unused by Ollama
};

/** One-shot, non-streaming completion. Returns the full message text. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  const res = await fetch(completionsUrl(opts.baseUrl), {
    method: "POST",
    headers: HEADERS,
    body: body(messages, opts, false),
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming completion. Yields content deltas as they arrive.
 * SSE framing (the `data:` lines, buffering across network reads, the
 * `[DONE]` terminator) is handled here so callers just `for await` tokens.
 */
export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(completionsUrl(opts.baseUrl), {
    method: "POST",
    headers: HEADERS,
    body: body(messages, opts, true),
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE lines are newline-delimited; a single `data:` line can straddle
      // two reads, so only consume complete lines from the buffer.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta: string = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) yield delta;
        } catch {
          // Ignore malformed partial frames defensively.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Vision ───────────────────────────────────────────────────────────────────
// Ollama's OpenAI-compatible /v1 image_url path fails for GGUF vision models
// ("Failed to load image"). The NATIVE /api/chat with an `images: [base64]`
// array works, so image requests go through here instead of chat()/streamChat().

function nativeChatUrl(baseUrl?: string) {
  return `${(baseUrl ?? BASE).replace(/\/v1\/?$/, "")}/api/chat`;
}

/** Native API wants raw base64; strip any `data:image/...;base64,` prefix. */
function toBase64(dataUrlOrB64: string): string {
  const i = dataUrlOrB64.indexOf("base64,");
  return i >= 0 ? dataUrlOrB64.slice(i + 7) : dataUrlOrB64;
}

function visionBody(prompt: string, images: string[], opts: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: opts.model ?? MODEL,
    messages: [{ role: "user", content: prompt, images: images.map(toBase64) }],
    options: { temperature: opts.temperature ?? 0.4 },
    stream,
  });
}

/** One-shot vision completion (native API). Returns the full message text. */
export async function chatWithImages(
  prompt: string,
  images: string[],
  opts: ChatOptions = {}
): Promise<string> {
  const res = await fetch(nativeChatUrl(opts.baseUrl), {
    method: "POST",
    headers: HEADERS,
    body: visionBody(prompt, images, opts, false),
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data?.message?.content ?? "";
}

/** Streaming vision completion (native API; NDJSON `{message:{content},done}`). */
export async function* streamChatWithImages(
  prompt: string,
  images: string[],
  opts: ChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(nativeChatUrl(opts.baseUrl), {
    method: "POST",
    headers: HEADERS,
    body: visionBody(prompt, images, opts, true),
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const json = JSON.parse(line);
          const delta: string = json?.message?.content ?? "";
          if (delta) yield delta;
          if (json?.done) return;
        } catch {
          // Ignore malformed partial frames defensively.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
