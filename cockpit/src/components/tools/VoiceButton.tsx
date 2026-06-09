"use client";

import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * On-device voice capture: record from the mic, transcribe via the local
 * /api/transcribe (whisper.cpp), and hand the text back. Degrades with a clear
 * toast when whisper/ffmpeg aren't installed.
 */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await transcribe(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function transcribe(blob: Blob) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      if (data.text) onText(data.text);
      else toast.error("Didn't catch any speech");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      disabled={busy}
      aria-label={recording ? "Stop recording" : "Voice capture"}
      title={recording ? "Stop recording" : "Voice capture"}
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground " +
        (recording ? "text-destructive" : "")
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <Square className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}
