import { spawn } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// On-device speech-to-text. Needs whisper.cpp (whisper-cli) + ffmpeg installed
// natively (no cloud). Binary paths and the model are configurable via env. If a
// tool or the model is missing the route returns a 503 with the fix command, so
// the feature is ready the moment you run `brew install whisper-cpp ffmpeg` and
// download a model.
const WHISPER = process.env.WHISPER_BIN || "whisper-cli";
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const WHISPER_MODEL = process.env.WHISPER_MODEL || join(homedir(), ".cache/whisper/ggml-base.en.bin");

type RunResult = { code: number | null; stdout: string; stderr: string };

function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    p.on("error", reject); // ENOENT when the binary isn't installed
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No audio uploaded." }, { status: 400 });
  }

  const buf = Buffer.from(await (file as File).arrayBuffer());
  const base = join(tmpdir(), `sk-voice-${process.pid}-${buf.length}`);
  const inPath = `${base}.webm`;
  const wavPath = `${base}.wav`;
  const txtPath = `${base}.txt`;

  try {
    await writeFile(inPath, buf);

    // 1) Decode the browser's webm/opus to 16 kHz mono WAV for whisper.
    try {
      const conv = await run(FFMPEG, ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", wavPath]);
      if (conv.code !== 0) {
        return Response.json({ error: "Couldn't decode the audio." }, { status: 422 });
      }
    } catch (e) {
      if (isMissing(e)) {
        return Response.json(
          { error: "ffmpeg isn't installed. Run: brew install ffmpeg", reason: "no-ffmpeg" },
          { status: 503 }
        );
      }
      throw e;
    }

    // 2) Transcribe on-device with whisper.cpp.
    if (!existsSync(WHISPER_MODEL)) {
      return Response.json(
        {
          error: `No whisper model at ${WHISPER_MODEL}. Download one: curl -L -o "${WHISPER_MODEL}" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`,
          reason: "no-model",
        },
        { status: 503 }
      );
    }
    let res: RunResult;
    try {
      res = await run(WHISPER, ["-m", WHISPER_MODEL, "-f", wavPath, "-nt", "-otxt", "-of", base]);
    } catch (e) {
      if (isMissing(e)) {
        return Response.json(
          { error: "whisper.cpp isn't installed. Run: brew install whisper-cpp", reason: "no-whisper" },
          { status: 503 }
        );
      }
      throw e;
    }

    let text = "";
    try {
      text = (await readFile(txtPath, "utf8")).trim();
    } catch {
      text = res.stdout.trim();
    }
    return Response.json({ text });
  } finally {
    unlink(inPath).catch(() => {});
    unlink(wavPath).catch(() => {});
    unlink(txtPath).catch(() => {});
  }
}
