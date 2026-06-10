import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

/** Persist a data:image/* URL under cockpit/uploads/, returning its relative
 * path — shared by quick-capture and the Image tool's "Save as idea". */
export async function saveDataUrlImage(dataUrl: string): Promise<string | null> {
  const m = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!m) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  const dir = join(process.cwd(), "uploads");
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, file), buf);
  return `uploads/${file}`;
}
