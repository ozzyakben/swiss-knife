import { reindexFacts } from "@/lib/memoryLoop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Embed every active/pending fact that lacks a vector, so relevance ranking works. */
export async function POST() {
  try {
    const { indexed, total } = await reindexFacts();
    return Response.json({ indexed, total });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Reindex failed.";
    return Response.json(
      { error: `Couldn't reach the embedding model. Run: ollama pull embeddinggemma`, detail },
      { status: 503 }
    );
  }
}
