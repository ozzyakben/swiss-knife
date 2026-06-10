import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { saveDataUrlImage } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors quick-capture's image cap (~15 MB decoded).
const MAX_IMAGE_CHARS = 20 * 1024 * 1024;

// Persist an idea AFTER the user has seen the result (save-after-run): the
// only previous write paths were request-time save flags that re-ran the
// model, or capture/quick-add. [id] PATCH/DELETE already existed. An optional
// image data URL is stored alongside (the Image tool's "Save as idea").
export async function POST(req: Request) {
  const { title, topic, content, image } = (await req.json().catch(() => ({}))) as {
    title?: string;
    topic?: string;
    content?: string;
    image?: string;
  };
  if (!content || typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Missing 'content'." }, { status: 400 });
  }
  let imagePath: string | null = null;
  if (typeof image === "string" && image.startsWith("data:image")) {
    if (image.length > MAX_IMAGE_CHARS) {
      return Response.json({ error: "Image too large (max ~15 MB)." }, { status: 413 });
    }
    imagePath = await saveDataUrlImage(image);
    // Same contract as capture: a data:image we can't parse is a 400, not a
    // silent imagePath:null that loses the image behind a 200.
    if (!imagePath) {
      return Response.json({ error: "Unsupported image format." }, { status: 400 });
    }
  }
  const projectId = await getActiveProjectId();
  const t = typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : null;
  const idea = await prisma.idea.create({
    data: {
      title: t,
      topic: (typeof topic === "string" && topic.trim() ? topic.trim() : t ?? content.trim()).slice(0, 200),
      content: content.trim(),
      imagePath,
      projectId,
    },
  });
  return Response.json({ idea });
}
