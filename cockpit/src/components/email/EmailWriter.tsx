"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { AiOutput } from "@/components/tools/AiOutput";
import { ContextUsed } from "@/components/tools/ContextUsed";
import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TONES = ["neutral", "formal", "friendly", "direct", "warm", "apologetic"];

export function EmailWriter() {
  const router = useRouter();
  const [mode, setMode] = useState("compose");
  const [tone, setTone] = useState("friendly");
  const [length, setLength] = useState("medium");
  const [brief, setBrief] = useState("");
  const [sourceText, setSourceText] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The settings that produced the current draft — save persists THIS pairing,
  // not whatever the form says now (editable again after the run finishes).
  const lastRun = useRef({ mode, tone, length, brief, sourceText });

  const { output, status, error, isRunning, elapsedMs, run, stop } = useAiTool({
    endpoint: "/api/email",
    buildBody: () => ({ mode, tone, length, brief, sourceText }),
  });
  const secs = Math.round(elapsedMs / 1000);

  async function handleRun() {
    if (!brief.trim()) {
      toast.error("Add a brief — what should the email say?");
      return;
    }
    setSaved(false);
    lastRun.current = { mode, tone, length, brief, sourceText };
    await run("");
  }

  // Save-after-run: persist EXACTLY the draft on screen (no regeneration),
  // paired with the inputs that produced it.
  async function saveDraft() {
    if (!output) return;
    setSaving(true);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lastRun.current, persist: output }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save the draft.");
      }
      setSaved(true);
      toast.success("Draft saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the draft.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Email Writer</h1>
      <p className="mt-1 text-muted-foreground">Compose or reply to emails with local Gemma.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Mode">
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compose">Compose</SelectItem>
              <SelectItem value="reply">Reply</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tone">
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Length">
          <Select value={length} onValueChange={setLength}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {mode === "reply" && (
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="source">Email you&apos;re replying to</Label>
          <VoiceTextarea
            id="source"
            rows={5}
            value={sourceText}
            onValueChange={setSourceText}
            placeholder="Paste the email you received…"
            disabled={isRunning}
          />
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="brief">Brief — what should it say?</Label>
        <VoiceTextarea
          id="brief"
          rows={4}
          value={brief}
          onValueChange={setBrief}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && brief.trim() && !isRunning) {
              e.preventDefault();
              handleRun();
            }
          }}
          placeholder="e.g. Ask for a 2-day extension on the report, apologize for the delay, propose Thursday."
          disabled={isRunning}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={handleRun} disabled={isRunning || !brief.trim()}>
          {isRunning ? `Writing… ${secs}s` : "Write"}
        </Button>
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <ErrorAlert className="mt-4" title="Draft failed" message={error} />}
      <AiOutput output={output} status={status} label="Draft" />
      {output && status === "done" && (
        <div className="mt-3">
          <Button variant="outline" onClick={saveDraft} disabled={saving || saved}>
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      )}
      {output && status === "done" && <ContextUsed query={brief} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
