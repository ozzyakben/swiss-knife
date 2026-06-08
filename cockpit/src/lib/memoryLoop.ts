// The memory loop: turn raw text into reviewable, de-duplicated, categorized
// candidate facts, and keep long-term memory healthy (index, decay). This is a
// human-in-the-loop loop — every write to ACTIVE memory is a proposal the user
// approves. The model never silently edits an existing active fact.
//
// Tiering (per CLAUDE.md): the configured chat model (light by default) does the
// high-volume extract + classify; embeddinggemma does dedupe + ranking; the
// quality model does the judgment step (consolidating a merge). Each model step
// is wrapped in a deterministic gate — fixed-taxonomy validation, a cosine/string
// duplicate threshold, and finally the human accept — rather than trusting one
// large prompt to get everything right.

import { prisma } from "@/lib/db";
import { chat, type ChatMessage } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { cosine, embedDocuments, parseVector, serializeVector } from "@/lib/embeddings";
import { FACT_CATEGORIES, normalizeCategory, type FactCategory } from "@/lib/memory";

// Deterministic duplicate gates. A candidate is a duplicate of an existing fact
// when their embeddings are very close OR their words overlap heavily. The cosine
// cutoff is calibrated on real embeddinggemma vectors: a genuine paraphrase of a
// glossary fact scored ~0.79, the nearest non-duplicate ~0.46, and unrelated
// facts ~0.20 — so 0.72 catches real restatements with comfortable margin above
// the noise floor without false-merging distinct facts.
const DEDUPE_COSINE = 0.72;
const JACCARD_DUP = 0.8;
// The quality tier for the judgment step. Falls back to the configured model if
// it isn't pulled, so consolidation degrades rather than failing.
const QUALITY_MODEL = "gemma4:12b-mlx";
// Decay: model-suggested facts never surfaced as relevant get archived after
// this many days. Manual, pinned, seeded (sourceKey), and used facts are spared.
const STALE_DAYS = 30;

export type LearnCandidate = {
  value: string;
  category: FactCategory;
  duplicateOfId?: string;
  duplicateOfValue?: string;
  similarity?: number;
  mergedValue?: string;
};

export type LearnResult = {
  created: number; // brand-new pending candidates
  merges: number; // merge proposals (consolidated into an existing fact on accept)
  skipped: number; // already-queued duplicates, not re-added
  candidates: LearnCandidate[];
};

// ── String similarity (cheap, embedding-independent) ─────────────────────────
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}
function jaccard(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// ── Capture + classify (light model) ─────────────────────────────────────────
async function extractAndClassify(text: string): Promise<{ value: string; category: FactCategory }[]> {
  const cfg = await getEffectiveConfig();
  const out = await chat(
    [
      {
        role: "system",
        content:
          "Extract durable, reusable facts about the user, their projects, preferences, vocabulary, or constraints from the text. " +
          `Classify each into exactly one category from this set: ${FACT_CATEGORIES.join(", ")}. ` +
          'Return ONLY a plain list, one fact per line, in the format "<category> :: <fact>". ' +
          "No numbering, no commentary. Skip anything transient or trivial. Max 8 facts.",
      },
      { role: "user", content: text },
    ],
    { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.3 }
  );

  const seen = new Set<string>();
  const facts: { value: string; category: FactCategory }[] = [];
  for (const line of out.split("\n")) {
    const cleaned = line.replace(/^[\s\-*\d.)]+/, "").trim();
    if (!cleaned) continue;
    const idx = cleaned.indexOf("::");
    const category = idx === -1 ? "general" : normalizeCategory(cleaned.slice(0, idx));
    const value = (idx === -1 ? cleaned : cleaned.slice(idx + 2)).trim();
    if (value.length <= 2) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    facts.push({ value, category });
    if (facts.length >= 8) break;
  }
  return facts;
}

// ── Consolidate a duplicate (quality model, judgment) ────────────────────────
async function consolidate(existing: string, incoming: string): Promise<string> {
  const cfg = await getEffectiveConfig();
  const messages: ChatMessage[] = [
    {
      role: "user",
      content:
        "Two memory facts overlap. Merge them into ONE clear, canonical fact that keeps all true information " +
        "and resolves any contradiction in favor of the newer statement. Return ONLY the merged fact, one line, no commentary.\n\n" +
        `Existing fact:\n${existing}\n\nNewer statement:\n${incoming}`,
    },
  ];
  const firstLine = (s: string) => s.trim().split("\n")[0].trim();
  try {
    const out = await chat(messages, { model: QUALITY_MODEL, baseUrl: cfg.baseUrl, temperature: 0.2 });
    return firstLine(out) || incoming;
  } catch {
    // Quality tier not pulled → degrade to the configured chat model.
    const out = await chat(messages, { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.2 });
    return firstLine(out) || incoming;
  }
}

// ── The pipeline ─────────────────────────────────────────────────────────────
export async function learnFromText(args: {
  text: string;
  projectId: string | null;
}): Promise<LearnResult> {
  const { text, projectId } = args;
  const candidates = await extractAndClassify(text);
  if (candidates.length === 0) return { created: 0, merges: 0, skipped: 0, candidates: [] };

  // Embed candidates (best-effort; string dedupe still works if this fails).
  let vectors: (number[] | null)[] = candidates.map(() => null);
  try {
    vectors = await embedDocuments(candidates.map((c) => c.value));
  } catch {
    // embeddinggemma unavailable: fall through to string-only dedupe.
  }

  // Existing in-scope facts (global + project), active + already-queued.
  const existing = await prisma.memoryFact.findMany({
    where: {
      status: { in: ["active", "pending"] },
      OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])],
    },
    select: { id: true, value: true, category: true, status: true, embedding: true },
  });
  const existingVecs = existing.map((e) => parseVector(e.embedding));

  const out: LearnCandidate[] = [];
  let created = 0;
  let merges = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cvec = vectors[i] ?? null;

    // Best duplicate among existing facts (deterministic gate).
    let best: { idx: number; sim: number } | null = null;
    for (let j = 0; j < existing.length; j++) {
      const evec = existingVecs[j];
      const cos = cvec && evec ? cosine(cvec, evec) : 0;
      const jac = jaccard(c.value, existing[j].value);
      const isDup = cos >= DEDUPE_COSINE || jac >= JACCARD_DUP;
      const sim = Math.max(cos, jac);
      if (isDup && (!best || sim > best.sim)) best = { idx: j, sim };
    }

    if (best) {
      const match = existing[best.idx];
      if (match.status === "pending") {
        // Already in the review queue — don't stack another copy.
        skipped++;
        out.push({
          value: c.value,
          category: c.category,
          duplicateOfId: match.id,
          duplicateOfValue: match.value,
          similarity: best.sim,
        });
        continue;
      }
      // Merge proposal against an ACTIVE fact: consolidate the wording (12B).
      const merged = await consolidate(match.value, c.value);
      const category = normalizeCategory(match.category ?? c.category);
      await prisma.memoryFact.create({
        data: {
          value: merged.slice(0, 500),
          category,
          source: "ai",
          status: "pending",
          projectId,
          mergedIntoId: match.id,
          embedding: cvec ? serializeVector(cvec) : null,
        },
      });
      merges++;
      out.push({
        value: merged,
        category,
        duplicateOfId: match.id,
        duplicateOfValue: match.value,
        similarity: best.sim,
        mergedValue: merged,
      });
    } else {
      await prisma.memoryFact.create({
        data: {
          value: c.value.slice(0, 500),
          category: c.category,
          source: "ai",
          status: "pending",
          projectId,
          embedding: cvec ? serializeVector(cvec) : null,
        },
      });
      created++;
      out.push({ value: c.value, category: c.category });
    }
  }

  return { created, merges, skipped, candidates: out };
}

/**
 * Opt-in auto-capture: run the loop over the project's recent activity (ideas,
 * QA stories, task notes) instead of a pasted note. Bounded and reviewable —
 * everything it finds lands in the pending queue. Returns the loop result plus
 * how many activity items were scanned.
 */
export async function learnFromActivity(
  projectId: string | null
): Promise<LearnResult & { sources: number }> {
  const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
  const [ideas, sessions, tasks] = await Promise.all([
    prisma.idea.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { topic: true, content: true },
    }),
    prisma.qaSession.findMany({
      where: scope,
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { title: true, story: true },
    }),
    prisma.task.findMany({
      where: { ...scope, NOT: { notes: null } },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { title: true, notes: true },
    }),
  ]);

  const blocks: string[] = [];
  for (const i of ideas) blocks.push(`Idea — ${i.topic}:\n${i.content}`);
  for (const s of sessions) blocks.push(`QA story — ${s.title}:\n${s.story}`);
  for (const t of tasks) blocks.push(`Task — ${t.title}: ${t.notes}`);
  const sources = blocks.length;
  if (sources === 0) return { created: 0, merges: 0, skipped: 0, candidates: [], sources: 0 };

  // Bound the text fed to extraction so a large history stays a cheap 4B call.
  const CAP = 6000;
  let text = blocks.join("\n\n");
  if (text.length > CAP) text = text.slice(0, CAP);

  const res = await learnFromText({ text, projectId });
  return { ...res, sources };
}

/**
 * Backfill categories on facts that have none (e.g. seeded-pack facts that
 * predate the taxonomy). Additive only — never overwrites an existing category,
 * and validates every label against the fixed set. Scoped to a project + global
 * when projectId is given. Returns how many were classified.
 */
export async function classifyUncategorized(projectId?: string | null): Promise<{ classified: number }> {
  const scope = projectId ? { OR: [{ projectId: null }, { projectId }] } : {};
  const rows = await prisma.memoryFact.findMany({
    where: { status: { in: ["active", "pending"] }, category: null, ...scope },
    select: { id: true, value: true },
  });
  if (rows.length === 0) return { classified: 0 };

  const cfg = await getEffectiveConfig();
  const BATCH = 12;
  let classified = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const list = slice.map((r, idx) => `${idx + 1}. ${r.value}`).join("\n");
    const out = await chat(
      [
        {
          role: "system",
          content:
            `Classify each numbered fact into exactly one category from this set: ${FACT_CATEGORIES.join(", ")}. ` +
            'Return ONLY lines in the form "<number>. <category>", one per fact, no commentary.',
        },
        { role: "user", content: list },
      ],
      { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.1 }
    );

    const byIndex = new Map<number, FactCategory>();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+)\s*[.):\-]\s*([a-zA-Z]+)/);
      if (m) byIndex.set(Number(m[1]), normalizeCategory(m[2]));
    }
    for (let k = 0; k < slice.length; k++) {
      const cat = byIndex.get(k + 1);
      if (!cat) continue;
      await prisma.memoryFact.update({ where: { id: slice[k].id }, data: { category: cat } });
      classified++;
    }
  }
  return { classified };
}

/** Embed every active/pending fact that lacks a vector. Returns indexed/total. */
export async function reindexFacts(): Promise<{ indexed: number; total: number }> {
  const statuses = ["active", "pending"];
  const [rows, total] = await Promise.all([
    prisma.memoryFact.findMany({
      where: { status: { in: statuses }, embedding: null },
      select: { id: true, value: true },
    }),
    prisma.memoryFact.count({ where: { status: { in: statuses } } }),
  ]);
  if (rows.length === 0) return { indexed: 0, total };

  const BATCH = 32;
  let indexed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vecs = await embedDocuments(slice.map((r) => r.value));
    for (let k = 0; k < slice.length; k++) {
      await prisma.memoryFact.update({
        where: { id: slice[k].id },
        data: { embedding: serializeVector(vecs[k]) },
      });
    }
    indexed += slice.length;
  }
  return { indexed, total };
}

/**
 * Apply an accepted merge proposal: copy its (consolidated) wording into the
 * surviving active fact, re-embed it, and drop the proposal. This is the only
 * place an active fact's wording changes from the loop, and it runs only on an
 * explicit human accept.
 */
export async function applyMerge(proposalId: string, targetId: string, mergedValue: string): Promise<void> {
  let embedding: string | null = null;
  try {
    const [v] = await embedDocuments([mergedValue]);
    embedding = serializeVector(v);
  } catch {
    // Keep the old embedding; a later reindex will refresh it.
  }
  await prisma.$transaction([
    prisma.memoryFact.update({
      where: { id: targetId },
      data: embedding ? { value: mergedValue, embedding } : { value: mergedValue },
    }),
    prisma.memoryFact.delete({ where: { id: proposalId } }),
  ]);
}

/**
 * Decay: archive model-suggested facts that have never been surfaced as relevant
 * and have aged out. Conservative on purpose — manual, pinned, seeded-pack
 * (sourceKey), and ever-used facts are never auto-archived, and archiving is
 * reversible (status only). Returns how many were archived.
 */
export async function archiveStaleFacts(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  try {
    const res = await prisma.memoryFact.updateMany({
      where: {
        status: "active",
        source: "ai",
        pinned: false,
        sourceKey: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: { lt: cutoff },
      },
      data: { status: "archived" },
    });
    return res.count;
  } catch {
    return 0;
  }
}
