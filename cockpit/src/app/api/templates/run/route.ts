import { assertOllamaReady } from "@/lib/health";
import { streamTextResponse } from "@/lib/ai/streamRoute";
import { prisma } from "@/lib/db";
import { renderTemplate } from "@/lib/templates";
import { getActiveProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shared "fill a template and run it" endpoint. Renders the template body with
 * the provided values, streams the model output, and on save persists to the
 * right table: an Idea for techniques, a Prompt for prompt templates.
 */
export async function POST(req: Request) {
  const { templateId, values, persist, projectId } = (await req.json().catch(() => ({}))) as {
    templateId?: string;
    values?: Record<string, string>;
    /** Save-after-run: the reviewed output — persisted verbatim, NO generation. */
    persist?: string;
    projectId?: string;
  };

  if (!templateId) {
    return Response.json({ error: "Missing 'templateId'." }, { status: 400 });
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });

  const rendered = renderTemplate(template.body, values ?? {});
  if (!rendered.trim()) {
    return Response.json({ error: "Fill in the fields before running." }, { status: 400 });
  }

  const effectiveProjectId = projectId || (await getActiveProjectId());
  const subject =
    (values?.topic ?? values?.text ?? "").toString().trim() || rendered.slice(0, 60);
  const title = `${template.name}${subject ? `: ${subject.slice(0, 50)}` : ""}`;

  // Save path: persist EXACTLY the output the user reviewed (the old request-
  // time save flag re-ran the model — slow, and saved an unseen variant).
  if (typeof persist === "string" && persist.trim()) {
    if (template.kind === "technique") {
      const idea = await prisma.idea.create({
        data: {
          title,
          topic: subject,
          content: persist,
          techniqueId: template.id,
          techniqueKind: template.category,
          projectId: effectiveProjectId,
        },
      });
      return Response.json({ ok: true, kind: "idea", id: idea.id });
    }
    const prompt = await prisma.prompt.create({
      data: {
        title,
        original: rendered,
        optimized: persist,
        source: "library",
        templateId: template.id,
        projectId: effectiveProjectId,
      },
    });
    return Response.json({ ok: true, kind: "prompt", id: prompt.id });
  }

  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  return streamTextResponse({
    injectMemory: true,
    memoryProjectId: effectiveProjectId,
    memoryQuery: subject || rendered,
    messages: [{ role: "user", content: rendered }],
  });
}
