import { assertOllamaReady } from "@/lib/health";
import { chat } from "@/lib/ollama";
import { getEffectiveConfig } from "@/lib/config";
import { getMemoryContext } from "@/lib/memory";
import { getActiveProjectId } from "@/lib/project";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  const { goal } = (await req.json().catch(() => ({}))) as { goal?: string };
  if (!goal || typeof goal !== "string" || !goal.trim()) {
    return Response.json({ error: "Describe a goal to break down." }, { status: 400 });
  }

  const cfg = await getEffectiveConfig();
  const projectId = await getActiveProjectId();
  const memory = await getMemoryContext({ projectId, query: goal.trim() });

  const text = await chat(
    [
      {
        role: "system",
        content:
          "You break a goal into concrete, actionable tasks. Return ONLY a plain list, one task per line, 3-7 tasks, no numbering, no headers, no commentary. Each line is a short imperative task.",
      },
      ...(memory ? [{ role: "system" as const, content: memory }] : []),
      { role: "user", content: goal.trim() },
    ],
    { model: cfg.model, baseUrl: cfg.baseUrl, temperature: 0.4 }
  );

  const titles = text
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 12);

  if (titles.length === 0) {
    return Response.json({ error: "No tasks were generated. Try rephrasing the goal." }, { status: 422 });
  }

  const max = await prisma.task.aggregate({ where: { status: "todo" }, _max: { order: true } });
  let order = (max._max.order ?? 0) + 1;
  const created = [];
  for (const title of titles) {
    created.push(
      await prisma.task.create({
        data: { title: title.slice(0, 200), status: "todo", order: order++, projectId },
      })
    );
  }

  return Response.json({ tasks: created });
}
