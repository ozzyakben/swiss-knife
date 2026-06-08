import { prisma } from "@/lib/db";
import { cosine, embedQuery, parseVector } from "@/lib/embeddings";

// The fixed fact taxonomy. The model classifies into this set; anything off-set
// normalizes to "general" so the grouped Memory view stays stable.
export const FACT_CATEGORIES = [
  "glossary",
  "preference",
  "standard",
  "constraint",
  "workflow",
  "person",
  "project",
  "general",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export function normalizeCategory(s: string | null | undefined): FactCategory {
  const c = (s ?? "").trim().toLowerCase();
  return (FACT_CATEGORIES as readonly string[]).includes(c) ? (c as FactCategory) : "general";
}

export type RankedFact = {
  id: string;
  key: string | null;
  value: string;
  category: string | null;
  pinned: boolean;
  /** Cosine relevance to the query, or null when ranked by recency (fallback). */
  score: number | null;
};

export type RankResult = {
  facts: RankedFact[];
  /** true = relevance-ranked by embedding; false = pinned+recency fallback. */
  ranked: boolean;
};

type FactRow = {
  id: string;
  key: string | null;
  value: string;
  category: string | null;
  pinned: boolean;
  embedding: string | null;
  createdAt: Date;
};

/**
 * Rank a project's active facts (global + that project) for the current task.
 *
 * With a `query` and indexed facts, this embeds the query and orders facts by
 * cosine similarity — pinned facts are always kept (at the top), the rest fill
 * the budget by relevance. Without a query, or if embeddings are unavailable,
 * it degrades to the old pinned + recency order. This never throws: any failure
 * falls back, so injection can't break a tool.
 */
export async function rankFacts(opts: {
  projectId?: string | null;
  query?: string | null;
  limit?: number;
}): Promise<RankResult> {
  const limit = opts.limit ?? 50;
  let rows: FactRow[] = [];
  try {
    rows = await prisma.memoryFact.findMany({
      where: {
        status: "active",
        OR: [{ projectId: null }, ...(opts.projectId ? [{ projectId: opts.projectId }] : [])],
      },
      orderBy: [{ pinned: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        key: true,
        value: true,
        category: true,
        pinned: true,
        embedding: true,
        createdAt: true,
      },
    });
  } catch {
    return { facts: [], ranked: false };
  }
  if (rows.length === 0) return { facts: [], ranked: false };

  const toRanked = (f: FactRow, score: number | null): RankedFact => ({
    id: f.id,
    key: f.key,
    value: f.value,
    category: f.category,
    pinned: f.pinned,
    score,
  });
  const fallback = (): RankResult => ({
    facts: rows.slice(0, limit).map((f) => toRanked(f, null)),
    ranked: false,
  });

  const q = opts.query?.trim();
  if (!q) return fallback();

  let queryVec: number[];
  try {
    queryVec = await embedQuery(q);
  } catch {
    return fallback();
  }

  const scored: { f: FactRow; score: number }[] = [];
  const unindexed: FactRow[] = [];
  for (const f of rows) {
    const v = parseVector(f.embedding);
    if (v) scored.push({ f, score: cosine(queryVec, v) });
    else unindexed.push(f);
  }
  if (scored.length === 0) return fallback(); // nothing indexed yet

  scored.sort((a, b) => b.score - a.score);
  // Pinned facts always make the cut; then highest-scoring others fill the rest.
  const ordered = [...scored.filter((s) => s.f.pinned), ...scored.filter((s) => !s.f.pinned)];
  const chosen = ordered.slice(0, limit).map((s) => toRanked(s.f, s.score));
  const room = limit - chosen.length;
  const extra = room > 0 ? unindexed.slice(0, room).map((f) => toRanked(f, null)) : [];
  return { facts: [...chosen, ...extra], ranked: true };
}

/** Best-effort decay signal: record that these facts were just injected. */
async function recordUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await prisma.memoryFact.updateMany({
      where: { id: { in: ids } },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch {
    // Usage tracking is non-essential; never let it break injection.
  }
}

/**
 * Active facts formatted as a context block to prepend to tool prompts. Includes
 * global facts (projectId null) plus the given project's facts. When `query` is
 * provided, facts are relevance-ranked (see rankFacts); otherwise pinned+recency.
 * Returns "" when there are none (so callers can skip the system message).
 */
export async function getMemoryContext(opts?: {
  projectId?: string | null;
  query?: string | null;
  limit?: number;
}): Promise<string> {
  const { facts } = await rankFacts({
    projectId: opts?.projectId ?? null,
    query: opts?.query ?? null,
    limit: opts?.limit ?? 50,
  });
  if (facts.length === 0) return "";
  await recordUsage(facts.map((f) => f.id));
  const lines = facts.map((f) => `- ${f.key ? `${f.key}: ` : ""}${f.value}`).join("\n");
  return `Relevant context about the user and their work (use where helpful; do not repeat it verbatim):\n${lines}`;
}
