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

export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { mode, tone, length, brief, sourceText, save } = (await req.json().catch(() => ({}))) as {
    mode?: string;
    tone?: string;
    length?: string;
    brief?: string;
    sourceText?: string;
    save?: boolean;
  };

  if (!brief || typeof brief !== "string" || !brief.trim()) {
    return Response.json({ error: "Add a brief — what should the email say?" }, { status: 400 });
  }

  const t = TONES.includes(tone ?? "") ? (tone as string) : "neutral";
  const lenKey: LengthKey = length === "short" || length === "long" ? length : "medium";
  const isReply = mode === "reply";
  const projectId = await getActiveProjectId();

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
    onComplete: save
      ? async (body) => {
          await prisma.emailDraft.create({
            data: {
              title: brief.trim().slice(0, 60),
              mode: isReply ? "reply" : "compose",
              sourceText: isReply ? sourceText?.trim() || null : null,
              brief: brief.trim(),
              body,
              tone: t,
              length: lenKey,
              projectId,
            },
          });
        }
      : undefined,
  });
}
