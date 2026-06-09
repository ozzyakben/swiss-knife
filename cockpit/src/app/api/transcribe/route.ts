import { spawn } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bound the subprocesses so a hung ffmpeg/whisper can't pin a request forever,
// and cap the upload (early via Content-Length, authoritatively via the buffer
// length) so a giant clip can't fill the disk or the whisper input.
const SPAWN_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(Object.assign(new Error(`${cmd} timed out after ${SPAWN_TIMEOUT_MS}ms`), { timedOut: true }));
    }, SPAWN_TIMEOUT_MS);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    }); // ENOENT when the binary isn't installed
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isTimeout(e: unknown): boolean {
  return (e as { timedOut?: boolean })?.timedOut === true;
}

export async function POST(req: Request) {
  // Early-out before buffering the whole multipart body into memory. The header
  // is client-controlled, so buf.length below stays the authoritative gate.
  const declaredLen = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio too large (max 25 MB)." }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No audio uploaded." }, { status: 400 });
  }

  const buf = Buffer.from(await (file as File).arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio too large (max 25 MB)." }, { status: 413 });
  }
  // A per-request unique base: process.pid is constant in a long-lived server and
  // buf.length collides for two same-size clips, so two concurrent uploads would
  // clobber each other's temp files. randomUUID() is unique per request.
  const base = join(tmpdir(), `sk-voice-${randomUUID()}`);
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
      if (isTimeout(e)) {
        return Response.json({ error: "Audio decode timed out." }, { status: 504 });
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
      if (isTimeout(e)) {
        return Response.json({ error: "Transcription timed out." }, { status: 504 });
      }
      throw e;
    }

    // A non-zero whisper exit is a real failure — don't report it as a
    // successful empty transcription (mirror the ffmpeg exit-code guard above).
    if (res.code !== 0) {
      return Response.json(
        { error: "Transcription failed.", detail: res.stderr.slice(0, 200) },
        { status: 422 }
      );
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
