"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CaptureSetup() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/capture/token")
      .then((r) => r.json())
      .then((d) => {
        if (active) setToken(d.token ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function regen() {
    const r = await fetch("/api/capture/token", { method: "POST" });
    const d = await r.json();
    setToken(d.token ?? null);
    toast.success("New token generated");
  }

  const curl = token
    ? `curl -X POST http://localhost:3000/api/capture \\\n  -H "x-capture-token: ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"target":"task","text":"Buy milk"}'`
    : "Loading…";

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Quick capture</h2>
      <p className="text-sm text-muted-foreground">
        POST to the capture endpoint to file something from anywhere. Send{" "}
        <code className="rounded bg-muted px-1">text</code> to file a task, fact, prompt, or idea,
        or send an <code className="rounded bg-muted px-1">image</code> (a base64{" "}
        <code className="rounded bg-muted px-1">data:image/…</code> URL, e.g. a screenshot) to
        save it as an Idea with an auto Gemma-vision description. Wire this token into a macOS
        Shortcut, Raycast, or a hotkey.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="capture-token">Token</Label>
        <div className="flex gap-2">
          <Input id="capture-token" readOnly value={token ?? "…"} className="font-mono text-xs" />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(token ?? "");
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
          <Button variant="ghost" onClick={regen}>
            Regenerate
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Test command</Label>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-2 text-xs">
          {curl}
        </pre>
      </div>

      <details className="text-sm text-muted-foreground" open>
        <summary className="cursor-pointer">macOS Shortcut — easiest (Run Shell Script)</summary>
        <ol className="ml-4 mt-2 list-decimal space-y-1">
          <li>Open Shortcuts → File → New Shortcut.</li>
          <li>
            Add a “Run Shell Script” action and set it to:{" "}
            <code className="rounded bg-muted px-1">
              bash &quot;&lt;repo&gt;/scripts/sk-capture.sh&quot;
            </code>{" "}
            (the script fetches this token itself, so nothing secret is stored in the Shortcut).
          </li>
          <li>Name it “Capture to Swiss Knife”.</li>
          <li>
            Shortcut details (sidebar) → Add Keyboard Shortcut → pick a hotkey (e.g. ⌃⌥⌘C).
          </li>
          <li>Copy any text, press the hotkey → it files as a task (you’ll get a notification).</li>
        </ol>
        <p className="ml-4 mt-1 text-xs">
          Capture a fact/prompt/idea instead by passing a 2nd arg, e.g.{" "}
          <code className="rounded bg-muted px-1">bash &quot;…/sk-capture.sh&quot; &quot;&quot; fact</code>.
        </p>
      </details>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">macOS Shortcut — capture selected text (no script)</summary>
        <ol className="ml-4 mt-2 list-decimal space-y-1">
          <li>Open Shortcuts and create a new shortcut (or Quick Action that receives text).</li>
          <li>
            Add a “Get Contents of URL” action. URL: http://localhost:3000/api/capture. Method:
            POST.
          </li>
          <li>Add a header: x-capture-token = your token above.</li>
          <li>
            Request Body: JSON with target set to task (or fact/prompt/idea) and text set to the
            Shortcut Input (the selected text).
          </li>
          <li>Assign a keyboard shortcut so you can capture selected text from any app.</li>
        </ol>
      </details>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">macOS Shortcut — capture a screenshot</summary>
        <ol className="ml-4 mt-2 list-decimal space-y-1">
          <li>New shortcut. Add “Take Screenshot” (interactive selection works well).</li>
          <li>
            Add “Base64 Encode” on the screenshot, then a “Text” action containing{" "}
            <code className="rounded bg-muted px-1">data:image/png;base64,</code> immediately
            followed by the encoded result.
          </li>
          <li>
            Add “Get Contents of URL” → POST to http://localhost:3000/api/capture, header
            x-capture-token = your token, Request Body JSON with{" "}
            <code className="rounded bg-muted px-1">image</code> set to that Text.
          </li>
          <li>
            It saves as an Idea (visible in Brainstorming) with a Gemma description. Assign a
            hotkey to grab any screen region into Swiss Knife.
          </li>
        </ol>
      </details>
    </div>
  );
}
