import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cut a derived title at a word boundary instead of mid-word. */
function deriveTitle(text: string, max = 60): string {
  const t = text.trim().split(/\r?\n/)[0].trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut) + "…";
}

// Persist a prompt AFTER the user has seen the result (the save-after-run
// path). The optimizer used to only save via a pre-commit flag that re-ran
// the model — persisting something the user never reviewed.
export async function POST(req: Request) {
  const { title, original, optimized, source } = (await req.json().catch(() => ({}))) as {
    title?: string;
    original?: string;
    optimized?: string;
    source?: string;
  };
  if (!original || typeof original !== "string" || !original.trim()) {
    return Response.json({ error: "Missing 'original'." }, { status: 400 });
  }
  const projectId = await getActiveProjectId();
  const prompt = await prisma.prompt.create({
    data: {
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : deriveTitle(original),
      original: original.trim(),
      optimized: typeof optimized === "string" && optimized.trim() ? optimized : null,
      source: typeof source === "string" && source.trim() ? source.trim() : "optimizer",
      projectId,
    },
  });
  return Response.json({ prompt });
}
