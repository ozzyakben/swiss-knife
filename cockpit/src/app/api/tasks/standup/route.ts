import { assertOllamaReady } from "@/lib/health";
import { streamTextResponse } from "@/lib/ai/streamRoute";
import { getActiveProjectId } from "@/lib/project";
import { buildStandupBoard, EMPTY_BOARD_ERROR, STANDUP_SYSTEM } from "@/lib/routines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const notReady = await assertOllamaReady();
  if (notReady) return notReady;

  // One shared, scoped, bounded board builder with the headless routine —
  // one prompt to tune, one bug surface (lib/routines.ts).
  const projectId = await getActiveProjectId();
  const board = await buildStandupBoard(projectId);
  if (!board) {
    return Response.json({ error: EMPTY_BOARD_ERROR }, { status: 400 });
  }

  return streamTextResponse({
    messages: [
      { role: "system", content: STANDUP_SYSTEM },
      { role: "user", content: board },
    ],
    temperature: 0.3,
  });
}
