import { assertOllamaReady } from "@/lib/health";
import { chatJson } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getActiveProjectId } from "@/lib/project";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkReport, type BugDraft } from "@/lib/bugReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    repro: { type: "array", items: { type: "string" } },
    expected: { type: "string" },
    actual: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    environment: { type: "string" },
  },
  required: ["title", "repro", "expected", "actual", "severity"],
};

const SYSTEM =
  "Turn a rough defect note into a structured bug report. Extract a short title, numbered reproduction steps, " +
  "the expected behaviour, the actual behaviour, a severity (low/medium/high/critical), and the environment if mentioned. " +
  "Do not invent details that aren't implied.";

export async function POST(req: Request) {
  const { note, report } = (await req.json().catch(() => ({}))) as {
    note?: string;
    /** Save-after-run: the reviewed draft — gated + persisted verbatim, NO model call. */
    report?: BugDraft;
  };
  if (!note || !note.trim()) return Response.json({ error: "Describe the bug." }, { status: 400 });

  const projectId = await getActiveProjectId();

  // Save path: the user reviewed THIS draft; the same deterministic gate
  // still applies, but the model never re-runs (the old "Draft & save"
  // re-drafted, so the saved report wasn't the one on screen).
  if (report && typeof report === "object") {
    const checked = checkReport(report);
    if (checked.missing.length > 0) {
      return Response.json(
        { error: `Can't save — missing: ${checked.missing.join(", ")}.` },
        { status: 400 }
      );
    }
    const row = await prisma.bugReport.create({
      data: {
        title: checked.title,
        repro: checked.repro.join("\n"),
        expected: checked.expected,
        actual: checked.actual,
        severity: checked.severity,
        environment: checked.environment,
        note: note.trim(),
        projectId,
      },
    });
    await logActivity({ entity: "bug", action: "reported", summary: checked.title, projectId });
    return Response.json({ savedId: row.id });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const cfg = await getEffectiveConfig();

  let draft: BugDraft;
  try {
    draft = await chatJson(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: note.trim() },
      ],
      SCHEMA,
      { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.2 }
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't draft the report." }, { status: 500 });
  }

  // Deterministic completeness gate (lib/bugReport.ts, unit-tested).
  return Response.json(checkReport(draft));
}
