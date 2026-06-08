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
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { templateId, values, save, projectId } = (await req.json().catch(() => ({}))) as {
    templateId?: string;
    values?: Record<string, string>;
    save?: boolean;
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

  return streamTextResponse({
    injectMemory: true,
    memoryProjectId: effectiveProjectId,
    memoryQuery: subject || rendered,
    messages: [{ role: "user", content: rendered }],
    onComplete: save
      ? async (full) => {
          if (template.kind === "technique") {
            await prisma.idea.create({
              data: {
                title,
                topic: subject,
                content: full,
                techniqueId: template.id,
                techniqueKind: template.category,
                projectId: effectiveProjectId,
              },
            });
          } else {
            await prisma.prompt.create({
              data: {
                title,
                original: rendered,
                optimized: full,
                source: "library",
                templateId: template.id,
                projectId: effectiveProjectId,
              },
            });
          }
        }
      : undefined,
  });
}
