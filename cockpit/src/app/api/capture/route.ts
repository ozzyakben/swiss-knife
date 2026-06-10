import { prisma } from "@/lib/db";
import { describeImage } from "@/lib/vision";
import { readCaptureToken, tokenMatches } from "@/lib/captureAuth";
import { embedDocuments, serializeVector } from "@/lib/embeddings";
import { logActivity } from "@/lib/activity";
import { saveDataUrlImage } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap the inbound image so a huge base64 payload can't exhaust memory/disk.
// Base64 is ~1.37x the raw bytes, so this string cap ≈ a ~15 MB decoded image.
const MAX_IMAGE_CHARS = 20 * 1024 * 1024;

async function getToken(): Promise<string | null> {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  return s?.captureToken || null;
}

/**
 * Quick-capture endpoint for a macOS Shortcut / hotkey. Token-authed via the
 * x-capture-token header (constant-time compare). Files text into the chosen table, or —
 * when an `image` data URL is sent — saves the image and a Gemma-vision
 * description as an Idea (resilient: the capture is kept even if vision fails).
 */
export async function POST(req: Request) {
  const token = await getToken();
  if (!token) {
    return Response.json(
      { error: "Quick capture isn't set up. Generate a token in Settings." },
      { status: 403 }
    );
  }
  if (!tokenMatches(readCaptureToken(req), token)) {
    return Response.json({ error: "Invalid capture token." }, { status: 401 });
  }

  const { target, text, title, projectId, image } = (await req.json().catch(() => ({}))) as {
    target?: string;
    text?: string;
    title?: string;
    projectId?: string;
    image?: string;
  };

  const hasImage = typeof image === "string" && image.startsWith("data:image");
  const t = (text ?? "").trim();
  if (!hasImage && !t) {
    return Response.json({ error: "Nothing to capture." }, { status: 400 });
  }
  if (hasImage && (image as string).length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "Image too large (max ~15 MB)." }, { status: 413 });
  }

  // Validate the project — a stale Shortcut id would FK-fail the create with a
  // raw 500; an unknown project degrades to a global capture instead.
  let pid: string | null = null;
  if (typeof projectId === "string" && projectId) {
    const exists = await prisma.project
      .findUnique({ where: { id: projectId }, select: { id: true } })
      .catch(() => null);
    pid = exists ? projectId : null;
  }

  // Image capture → Idea with a vision description + the saved file path.
  if (hasImage) {
    const imagePath = await saveDataUrlImage(image as string);
    if (!imagePath) {
      return Response.json({ error: "Unsupported image format." }, { status: 400 });
    }
    let description = "";
    try {
      description = (await describeImage(image as string, t || undefined)).trim();
    } catch {
      description = ""; // engine down / error — keep the capture anyway
    }
    const content = description || t || "Captured image (auto-description unavailable).";
    const idea = await prisma.idea.create({
      data: {
        title: (title || t.slice(0, 60) || "Captured image").trim(),
        topic: (t || "image capture").slice(0, 200),
        content,
        imagePath,
        projectId: pid,
      },
    });
    // The Activity page advertises captures and the wrapup routine reads them —
    // a headless capture that leaves no activity row is invisible to both.
    await logActivity({ entity: "idea", action: "captured", summary: idea.title ?? idea.topic, projectId: pid });
    return Response.json({ ok: true, target: "idea", id: idea.id, imagePath, described: !!description });
  }

  // Text capture → the chosen table.
  const tgt = ["task", "fact", "prompt", "idea"].includes(target ?? "") ? target : "task";

  let id: string;
  if (tgt === "fact") {
    // Verbatim human text with an explicit target=fact → active is right; but
    // embed at create (best-effort) so it ranks without a manual reindex.
    let embedding: string | null = null;
    try {
      const [v] = await embedDocuments([t.slice(0, 300)]);
      embedding = serializeVector(v);
    } catch {
      embedding = null;
    }
    const f = await prisma.memoryFact.create({
      data: { value: t.slice(0, 300), source: "manual", status: "active", projectId: pid, embedding },
    });
    id = f.id;
  } else if (tgt === "prompt") {
    const p = await prisma.prompt.create({
      data: { title: (title || t.slice(0, 60)).trim(), original: t, source: "import", projectId: pid },
    });
    id = p.id;
  } else if (tgt === "idea") {
    const i = await prisma.idea.create({
      data: { title: (title || t.slice(0, 60)).trim(), topic: t.slice(0, 200), content: t, projectId: pid },
    });
    id = i.id;
  } else {
    const max = await prisma.task.aggregate({ where: { status: "todo" }, _max: { order: true } });
    const task = await prisma.task.create({
      data: { title: t.slice(0, 200), status: "todo", order: (max._max.order ?? 0) + 1, projectId: pid },
    });
    id = task.id;
  }

  await logActivity({ entity: tgt as string, action: "captured", summary: t.slice(0, 120), projectId: pid });
  return Response.json({ ok: true, target: tgt, id });
}
