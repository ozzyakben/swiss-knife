import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import { chatJson } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getActiveProjectId } from "@/lib/project";
import { logActivity } from "@/lib/activity";
import { embedDocuments } from "@/lib/embeddings";
import {
  CASE_DIMENSIONS,
  DEDUPE_CUTOFF,
  isEvalCase,
  lintCases,
  markDuplicates,
  type EvalCase,
} from "@/lib/evalCases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEMA = {
  type: "object",
  properties: {
    cases: {
      type: "array",
      minItems: 5,
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: [...CASE_DIMENSIONS] },
          title: { type: "string" },
          artifact: { type: "string" },
          expectedVerdict: { type: "string", enum: ["PASS", "BLOCK"] },
          rationale: { type: "string" },
        },
        required: ["dimension", "title", "artifact", "expectedVerdict", "rationale"],
      },
    },
  },
  required: ["cases"],
};

const SYSTEM = `You design evaluation test cases from a spec. Produce concrete cases across ALL FIVE dimensions:
- happy: clearly meets the spec (expectedVerdict PASS)
- boundary: sits exactly at the edge of a rule (verdict per your judgement, explain in rationale)
- adversarial: tries to break, exploit, or game the spec (usually BLOCK)
- ambiguous: the spec under-determines the answer (pick a verdict, say why)
- out-of-scope: outside what the spec covers (usually BLOCK)

Each case: a short title, the ARTIFACT (the concrete input an evaluator would judge — written in
the spec's domain, under 15 lines, realistic), an expectedVerdict, and a one-sentence rationale.
At least one case per dimension. Make every artifact concrete and clearly distinct from the
others — no near-rephrasings. Use the user's domain vocabulary.`;

type PostBody = { spec?: string; accept?: EvalCase };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PostBody;

  // ── Accept path: one human-reviewed case → one GoldenCase row. ──
  if (body.accept) {
    if (!isEvalCase(body.accept)) {
      return Response.json({ error: "Malformed eval case." }, { status: 400 });
    }
    const projectId = await getActiveProjectId();
    const row = await prisma.goldenCase.create({
      data: {
        story: `[${body.accept.dimension}] ${body.accept.title.trim()}`,
        draftFeature: body.accept.artifact,
        expectedVerdict: body.accept.expectedVerdict,
        projectId,
      },
    });
    await logActivity({
      entity: "golden",
      action: "accepted",
      summary: `Eval case: ${body.accept.title}`,
      projectId,
    });
    return Response.json({ savedId: row.id });
  }

  // ── Generate path: model drafts → coverage gate → embedding dedupe. ──
  // Gate on the model generation actually uses (qaModel override when set).
  const cfg = await getEffectiveConfig();
  const notReady = await assertOllamaReady(cfg.qaModel ?? undefined);
  if (notReady) return notReady;

  if (!body.spec || typeof body.spec !== "string" || !body.spec.trim()) {
    return Response.json({ error: "Paste the spec to generate cases for." }, { status: 400 });
  }
  if (body.spec.length > 20_000) {
    return Response.json({ error: "That's too long — paste a focused spec." }, { status: 413 });
  }

  let cases: EvalCase[];
  try {
    // chatJson = structured extraction: NO memory injection (perf rule).
    const out = await chatJson<{ cases: EvalCase[] }>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: body.spec.trim() },
      ],
      SCHEMA,
      // Same model the bench will later judge with (qaModel override) — cases
      // drafted on one tier and judged on another skews adversarial quality.
      { model: cfg.qaModel ?? cfg.model, baseUrl: cfg.baseUrl, temperature: 0.4 }
    );
    cases = out.cases ?? [];
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't generate cases." }, { status: 500 });
  }

  const lint = lintCases(cases);

  // Near-duplicate flagging (advisory): embeddinggemma + the calibrated cutoff.
  // An embed failure degrades to "dedupe skipped", never fails the run.
  let duplicateOf: (number | null)[] = cases.map(() => null);
  let dedupe: "done" | "skipped" = "done";
  try {
    const vectors = await embedDocuments(cases.map((c) => c.artifact));
    duplicateOf = markDuplicates(vectors, DEDUPE_CUTOFF);
  } catch {
    dedupe = "skipped";
  }

  return Response.json({
    cases: cases.map((c, i) => ({ ...c, duplicateOf: duplicateOf[i] })),
    lint,
    dedupe,
    ok: lint.ok,
  });
}
