// Embedding helpers for the memory loop: serialize/parse vectors, cosine
// similarity, and the two embeddinggemma calls (query vs document). At our scale
// (tens-to-hundreds of facts) brute-force cosine in JS is the right tool — SQLite
// has no vector type, and adding one would be infrastructure we don't need.

import { embed } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";

// EmbeddingGemma is trained with task-specific prompt prefixes for asymmetric
// retrieval; using them materially improves ranking quality. (Model card → the
// "Retrieval" task: a query prefix and a document prefix.) Facts are embedded as
// documents; the current task is embedded as a query.
const QUERY_PREFIX = "task: search result | query: ";
const DOC_PREFIX = "title: none | text: ";

/** Vectors live in a TEXT column as a JSON number[]. */
export function serializeVector(v: number[]): string {
  return JSON.stringify(v);
}

export function parseVector(s: string | null | undefined): number[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.length > 0 && typeof v[0] === "number" ? (v as number[]) : null;
  } catch {
    return null;
  }
}

/** Cosine similarity in [-1, 1]; 0 when either vector is degenerate. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedOpts() {
  const cfg = await getEffectiveConfig();
  return { model: cfg.embeddingModel, baseUrl: cfg.baseUrl };
}

/** Embed a single query string (retrieval-query prefix). Throws if the engine is down. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed(QUERY_PREFIX + text, await embedOpts());
  return v;
}

/** Embed one or more documents (retrieval-document prefix). */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return embed(
    texts.map((t) => DOC_PREFIX + t),
    await embedOpts()
  );
}
