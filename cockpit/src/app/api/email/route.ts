import { assertOllamaReady } from "@/lib/health";
import { streamTextResponse } from "@/lib/ai/streamRoute";
import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TONES = ["neutral", "formal", "friendly", "direct", "warm", "apologetic"];
const LENGTHS = {
  short: "short (2-3 sentences)",
  medium: "medium (a short paragraph or two)",
  long: "longer and more thorough",
} as const;
type LengthKey = keyof typeof LENGTHS;

/** "Subject: …" first line as the draft title (deterministic), else the brief. */
function deriveDraftTitle(body: string, brief: string): string {
  const m = body.match(/^Subject:\s*(.+)$/m);
  return (m?.[1].trim() || brief.trim()).slice(0, 80);
}

export async function POST(req: Request) {
  const { mode, tone, length, brief, sourceText, persist } = (await req.json().catch(() => ({}))) as {
    mode?: string;
    tone?: string;
    length?: string;
    brief?: string;
    sourceText?: string;
    /** Save-after-run: the reviewed draft body — persisted verbatim, NO generation. */
    persist?: string;
  };

  if (!brief || typeof brief !== "string" || !brief.trim()) {
    return Response.json({ error: "Add a brief — what should the email say?" }, { status: 400 });
  }

  const t = TONES.includes(tone ?? "") ? (tone as string) : "neutral";
  const lenKey: LengthKey = length === "short" || length === "long" ? length : "medium";
  const isReply = mode === "reply";
  const projectId = await getActiveProjectId();

  // Save path: persist EXACTLY the draft the user reviewed. (The old
  // "Write & save" re-ran the model, so the saved email was never the one on
  // screen — and cost a second generation.)
  if (typeof persist === "string" && persist.trim()) {
    const draft = await prisma.emailDraft.create({
      data: {
        title: deriveDraftTitle(persist, brief),
        mode: isReply ? "reply" : "compose",
        sourceText: isReply ? sourceText?.trim() || null : null,
        brief: brief.trim(),
        body: persist,
        tone: t,
        length: lenKey,
        projectId,
      },
    });
    return Response.json({ ok: true, id: draft.id });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const system = `You write clear, effective emails. Write a ${t} email that is ${LENGTHS[lenKey]}. Return ONLY the email itself — you may start with a "Subject:" line. No preamble, no commentary, and avoid bracketed placeholders unless truly necessary.`;

  const parts = [`Intent / notes for the email:\n${brief.trim()}`];
  if (isReply && typeof sourceText === "string" && sourceText.trim()) {
    parts.push(`\nThis is a reply to the email below:\n"""\n${sourceText.trim()}\n"""`);
  }

  return streamTextResponse({
    injectMemory: true,
    memoryProjectId: projectId,
    memoryQuery: brief.trim(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: parts.join("\n") },
    ],
  });
}
