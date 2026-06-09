import { prisma } from "@/lib/db";
import { assertOllamaReady } from "@/lib/health";
import { getActiveProjectId } from "@/lib/project";
import { loadProjectQaContext, scoreFeature } from "@/lib/qaPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-run the current rubric over the project's golden cases and report how often
// it still agrees with the labeled verdict — catches rubric/model drift.
export async function POST() {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const projectId = await getActiveProjectId();
  const ctx = await loadProjectQaContext(projectId);
  if (!ctx.hasPack) return Response.json({ needsPack: true });

  const cases = await prisma.goldenCase.findMany({ where: { projectId } });
  if (cases.length === 0) {
    return Response.json({ total: 0, agree: 0, agreementPct: null, results: [] });
  }

  const results: { id: string; expected: string; got: string; agree: boolean; story: string }[] = [];
  let agree = 0;
  for (const c of cases) {
    // One failing case (engine hiccup) must not 500 the whole bench and discard
    // every other case's result — record it as a non-agreeing ERROR and continue.
    let got = "ERROR";
    try {
      got = (await scoreFeature(c.draftFeature, projectId, ctx)).verdict;
    } catch {
      got = "ERROR";
    }
    const ok = got === c.expectedVerdict;
    if (ok) agree += 1;
    results.push({ id: c.id, expected: c.expectedVerdict, got, agree: ok, story: c.story.slice(0, 70) });
  }

  return Response.json({
    total: cases.length,
    agree,
    agreementPct: Math.round((agree / cases.length) * 100),
    results,
  });
}
