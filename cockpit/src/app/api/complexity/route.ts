import { assertOllamaReady } from "@/lib/health";
import { chatJson } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { auditClaim, scanComplexity } from "@/lib/complexity";
import { looksLikeDiff, parseDiffHunks } from "@/lib/codeSmells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 40_000;

const SCHEMA = {
  type: "object",
  properties: {
    timeBigO: { type: "string" },
    spaceBigO: { type: "string" },
    hotspots: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          line: { type: "integer", minimum: 1 },
          note: { type: "string" },
        },
        required: ["line", "note"],
      },
    },
  },
  required: ["timeBigO", "spaceBigO", "hotspots"],
};

const SYSTEM = `You analyze the asymptotic complexity of a TS/JS snippet.
Report timeBigO and spaceBigO in standard O(...) notation over the dominant input (e.g. "O(n log n)",
"O(n*m)"), and up to 6 hotspots — the specific lines that dominate the cost — each with the 1-based
line number in the given snippet and a short note. Judge only the code given; if the bound depends on
an unknown callee, say so in the hotspot note and bound what you can see.`;

export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code || typeof code !== "string" || !code.trim()) {
    return Response.json({ error: "Paste a snippet to analyze." }, { status: 400 });
  }
  if (code.length > MAX_CHARS) {
    return Response.json({ error: "That's too much code — paste a focused snippet." }, { status: 413 });
  }

  // A unified diff must be reconstructed to its NEW-file side first: lexing
  // raw diff text counts deleted `-` loops as live growth mechanisms, and the
  // model would be asked to analyze diff syntax. Hotspot lines are then mapped
  // back to new-file numbers — the same coordinates the smell findings use.
  let analyzed = code;
  let toNewFile: ((l: number) => number | null) | null = null;
  if (looksLikeDiff(code)) {
    const hunks = parseDiffHunks(code);
    if (hunks.length > 0) {
      analyzed = hunks.map((h) => h.fragment).join("\n");
      const lineMap: (number | null)[] = [];
      for (const h of hunks) {
        h.fragment.split("\n").forEach((_, i) => lineMap.push(h.map[i] ?? null));
      }
      toNewFile = (l) => lineMap[l - 1] ?? null;
    }
  }

  // Deterministic mechanism scan first — it grounds and audits the model.
  const scan = scanComplexity(analyzed);

  const cfg = await getEffectiveConfig();
  let verdict: { timeBigO: string; spaceBigO: string; hotspots: { line: number; note: string }[] };
  try {
    // chatJson = structured extraction: NO memory injection (perf rule).
    verdict = await chatJson(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: analyzed },
      ],
      SCHEMA,
      { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0 }
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't analyze the snippet." }, { status: 500 });
  }

  // The model can cite L99 in an 8-line paste — drop hotspots whose line
  // doesn't exist in the snippet (the scan already counted its lines), then
  // translate diff-fragment lines to new-file numbers.
  verdict.hotspots = (verdict.hotspots ?? [])
    .filter((h) => h.line >= 1 && h.line <= scan.lines)
    .flatMap((h) => {
      if (!toNewFile) return [h];
      const mapped = toNewFile(h.line);
      return mapped === null ? [] : [{ ...h, line: mapped }];
    });

  const warnings = auditClaim(scan, verdict.timeBigO);
  return Response.json({
    verdict,
    scan,
    warnings,
    ok: warnings.length === 0,
  });
}
