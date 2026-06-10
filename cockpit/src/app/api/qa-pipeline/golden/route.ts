import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Promote a QA draft to a labeled golden case (story + expected verdict).
export async function POST(req: Request) {
  const { story, draftFeature, expectedVerdict, sessionId } = (await req.json().catch(() => ({}))) as {
    story?: string;
    draftFeature?: string;
    expectedVerdict?: string;
    sessionId?: string;
  };
  if (!story?.trim() || !draftFeature?.trim() || !["PASS", "BLOCK"].includes(expectedVerdict ?? "")) {
    return Response.json({ error: "Need story, draftFeature, and expectedVerdict (PASS|BLOCK)." }, { status: 400 });
  }
  // The golden belongs to the SESSION's project: ⌘K deep links open sessions
  // from any project, and the active-project cookie would mis-file the golden
  // into whatever project happens to be active.
  let projectId: string | null;
  if (typeof sessionId === "string" && sessionId) {
    const session = await prisma.qaSession
      .findUnique({ where: { id: sessionId }, select: { projectId: true } })
      .catch(() => null);
    if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
    projectId = session.projectId;
  } else {
    projectId = await getActiveProjectId();
  }
  const c = await prisma.goldenCase.create({
    data: { story: story.trim(), draftFeature, expectedVerdict: expectedVerdict as string, projectId },
  });
  return Response.json({ id: c.id });
}

export async function GET() {
  const projectId = await getActiveProjectId();
  const cases = await prisma.goldenCase
    .findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, story: true, expectedVerdict: true } })
    .catch(() => []);
  return Response.json({ cases });
}
