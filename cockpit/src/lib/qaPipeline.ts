// Project-scoped QA pipeline: a user story → drafted .feature → deterministic
// lint → rubric score, refined across iterations. This orchestrates EXISTING
// primitives — it does not reimplement them. The Gherkin-authoring and
// eval-rubric instructions come from the active project's seeded templates
// (resolved by slug), so all LBMH/Spruce specifics stay in the gitignored
// project pack (prisma/seed-lbmh.mjs), never hardcoded here. Glossary/vocabulary
// is injected via the project's memory facts.

import { prisma } from "@/lib/db";
import { chat, chatJson, type ChatMessage } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getMemoryContext } from "@/lib/memory";
import { renderTemplate } from "@/lib/templates";
import { lintGherkin, type GherkinLintResult } from "@/lib/gherkinLint";

// Stable slugs the project pack seeds these templates under (see
// prisma/seed-lbmh.mjs → projects/<name>/pack/content.mjs). Resolved per project,
// so a project without the pack simply has no match → needsPack.
const GHERKIN_SLUG = "lbmh-gherkin-authoring";
const RUBRIC_SLUG = "lbmh-qa-eval-rubric";

type QaTemplate = { id: string; body: string };

export type QaContext = {
  /** True only when both templates AND project glossary facts are present. */
  hasPack: boolean;
  gherkinTemplate: QaTemplate | null;
  rubricTemplate: QaTemplate | null;
  hasGlossary: boolean;
};

export type RubricScore = { raw: string; verdict: "PASS" | "BLOCK" | "UNKNOWN"; score?: number | null };

// Reliable, additive read of the rubric: extract verdict + a 0-100 score FROM
// the template's free-text evaluation, without changing what the template emits.
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["PASS", "BLOCK"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: ["verdict", "score"],
};

export type IterationResult = {
  draftFeature: string;
  lint: GherkinLintResult;
  rubric: RubricScore;
};

/**
 * Resolve a project's QA pack: the Gherkin-authoring + eval-rubric templates (by
 * slug, scoped to the project) and whether the project has glossary memory facts.
 * A project "has the pack" only when both templates and at least one fact exist.
 */
export async function loadProjectQaContext(projectId: string | null): Promise<QaContext> {
  const [gherkinTemplate, rubricTemplate, factCount] = await Promise.all([
    prisma.template.findFirst({
      where: { slug: GHERKIN_SLUG, projectId },
      select: { id: true, body: true },
    }),
    prisma.template.findFirst({
      where: { slug: RUBRIC_SLUG, projectId },
      select: { id: true, body: true },
    }),
    projectId
      ? prisma.memoryFact.count({ where: { projectId, status: "active" } })
      : Promise.resolve(0),
  ]);

  const hasGlossary = factCount > 0;
  return {
    hasPack: Boolean(gherkinTemplate && rubricTemplate && hasGlossary),
    gherkinTemplate,
    rubricTemplate,
    hasGlossary,
  };
}

// Gemma tends to wrap output in ```gherkin fences; the linter wants raw text.
export function stripFences(s: string): string {
  return s.replace(/^\s*```[\w-]*\s*$/gm, "").trim();
}

function parseVerdict(raw: string): RubricScore["verdict"] {
  if (/verdict:\s*pass/i.test(raw)) return "PASS";
  if (/verdict:\s*block/i.test(raw)) return "BLOCK";
  return "UNKNOWN";
}

/** Read verdict + a 0-100 score from the rubric text (reliable; regex fallback). */
async function extractVerdict(
  raw: string,
  opts: { model: string; baseUrl: string; temperature: number }
): Promise<{ verdict: RubricScore["verdict"]; score: number | null }> {
  try {
    const out = await chatJson<{ verdict: "PASS" | "BLOCK"; score: number }>(
      [
        {
          role: "system",
          content:
            "Read this QA rubric evaluation and report its final verdict and an overall 0-100 quality score. If it is not clearly a pass, the verdict is BLOCK.",
        },
        { role: "user", content: raw },
      ],
      VERDICT_SCHEMA,
      { ...opts, temperature: 0 }
    );
    const score = typeof out.score === "number" ? Math.max(0, Math.min(100, Math.round(out.score))) : null;
    return { verdict: out.verdict === "PASS" ? "PASS" : "BLOCK", score };
  } catch {
    return { verdict: parseVerdict(raw), score: null };
  }
}

async function chatOpts() {
  const cfg = await getEffectiveConfig();
  return { model: cfg.model, baseUrl: cfg.baseUrl, temperature: cfg.temperature };
}

function withMemory(memory: string, instruction: string): ChatMessage[] {
  return memory
    ? [{ role: "system", content: memory }, { role: "user", content: instruction }]
    : [{ role: "user", content: instruction }];
}

/** Deterministic, model-independent BDD lint (reuse — never reimplement). */
export function lintFeature(draftFeature: string): GherkinLintResult {
  return lintGherkin(draftFeature);
}

/** Draft a fresh .feature from a story, using the project's Gherkin template. */
export async function draftFromStory(
  story: string,
  projectId: string | null,
  ctx: QaContext
): Promise<string> {
  if (!ctx.gherkinTemplate) throw new Error("QA pack not loaded for this project.");
  const memory = await getMemoryContext({ projectId, query: story });
  // The story drives the template's `behavior`; module/examples map to "".
  const instruction = renderTemplate(ctx.gherkinTemplate.body, { behavior: story });
  const raw = await chat(withMemory(memory, instruction), await chatOpts());
  return stripFences(raw);
}

/**
 * Revise a previous draft against a follow-up instruction, keeping the project's
 * Gherkin standards (the template body) in front of the model.
 */
export async function draftFromFollowUp(
  story: string,
  previousDraft: string,
  instruction: string,
  projectId: string | null,
  ctx: QaContext
): Promise<string> {
  if (!ctx.gherkinTemplate) throw new Error("QA pack not loaded for this project.");
  const memory = await getMemoryContext({ projectId, query: `${story}\n${instruction}` });
  const standards = renderTemplate(ctx.gherkinTemplate.body, { behavior: story });
  const prompt = `${standards}

You previously produced this .feature:
---
${previousDraft}
---

Revise it to address this follow-up, keeping every standard above and not dropping
scenarios that already work: ${instruction}

Return only the revised .feature content.`;
  const raw = await chat(withMemory(memory, prompt), await chatOpts());
  return stripFences(raw);
}

/** Score a .feature against the project's eval rubric. */
export async function scoreFeature(
  draftFeature: string,
  projectId: string | null,
  ctx: QaContext
): Promise<RubricScore> {
  if (!ctx.rubricTemplate) throw new Error("QA pack not loaded for this project.");
  const memory = await getMemoryContext({ projectId, query: draftFeature });
  const instruction = renderTemplate(ctx.rubricTemplate.body, { artifact: draftFeature });
  const opts = await chatOpts();
  const raw = await chat(withMemory(memory, instruction), opts);
  const { verdict, score } = await extractVerdict(raw, opts);
  return { raw: raw.trim(), verdict, score };
}

/** Full first iteration: draft from the story, then lint + score. */
export async function runFreshIteration(
  story: string,
  projectId: string | null,
  ctx: QaContext
): Promise<IterationResult> {
  const draftFeature = await draftFromStory(story, projectId, ctx);
  const lint = lintFeature(draftFeature);
  const rubric = await scoreFeature(draftFeature, projectId, ctx);
  return { draftFeature, lint, rubric };
}

/** Full follow-up iteration: revise from the previous draft, then lint + score. */
export async function runFollowUpIteration(
  story: string,
  previousDraft: string,
  instruction: string,
  projectId: string | null,
  ctx: QaContext
): Promise<IterationResult> {
  const draftFeature = await draftFromFollowUp(story, previousDraft, instruction, projectId, ctx);
  const lint = lintFeature(draftFeature);
  const rubric = await scoreFeature(draftFeature, projectId, ctx);
  return { draftFeature, lint, rubric };
}

// ── Serialization (Prisma rows → client DTOs) ────────────────────────────────
// Lint is recomputed on read (deterministic + free) so the client always gets a
// fresh issue list without us storing it; the stored counts are a denormalized
// cache for the session-list summary only.

export type IterationDTO = {
  id: string;
  order: number;
  instruction: string | null;
  draftFeature: string;
  lint: GherkinLintResult;
  rubric: RubricScore | null;
  edited: boolean;
  createdAt: string;
};

export type SessionDTO = {
  id: string;
  title: string;
  story: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  iterations: IterationDTO[];
};

type IterationRow = {
  id: string;
  order: number;
  instruction: string | null;
  draftFeature: string;
  score: unknown;
  edited: boolean;
  createdAt: Date;
};

export function serializeIteration(it: IterationRow): IterationDTO {
  return {
    id: it.id,
    order: it.order,
    instruction: it.instruction,
    draftFeature: it.draftFeature,
    lint: lintFeature(it.draftFeature),
    rubric: (it.score as RubricScore | null) ?? null,
    edited: it.edited,
    createdAt: it.createdAt.toISOString(),
  };
}

export function serializeSession(s: {
  id: string;
  title: string;
  story: string;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  iterations: IterationRow[];
}): SessionDTO {
  return {
    id: s.id,
    title: s.title,
    story: s.story,
    projectId: s.projectId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    iterations: s.iterations.map(serializeIteration),
  };
}

/** A short, human label for a session, from the first line of its story. */
export function deriveTitle(story: string): string {
  const firstLine = story.trim().split(/\r?\n/)[0].trim();
  if (!firstLine) return "Untitled story";
  return firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine;
}
