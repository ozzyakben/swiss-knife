"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { useAiTool } from "@/hooks/useAiTool";
import { AiOutput } from "@/components/tools/AiOutput";
import { ContextUsed } from "@/components/tools/ContextUsed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceTextarea } from "@/components/tools/VoiceTextarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseVariables, missingRequired, type VarDef } from "@/lib/templates";

export type RunnableTemplate = {
  id: string;
  name: string;
  variables: string;
};

/**
 * Fill a template's {{variables}} and run it through the model. Used by the
 * prompt library (saves a Prompt) and brainstorming (saves an Idea); the save
 * target is decided server-side by the template kind.
 */
export function TemplateRunner({
  template,
  savedLabel = "Saved",
  onSaved,
}: {
  template: RunnableTemplate;
  savedLabel?: string;
  onSaved?: () => void;
}) {
  const vars: VarDef[] = parseVariables(template.variables);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, v.default ?? ""]))
  );
  const router = useRouter();

  const { output, status, error, isRunning, run, stop } = useAiTool({
    endpoint: "/api/templates/run",
    buildBody: (_input, extra) => ({
      templateId: template.id,
      values,
      save: Boolean(extra?.save),
    }),
  });

  function set(name: string, val: string) {
    setValues((s) => ({ ...s, [name]: val }));
  }

  async function handleRun(save: boolean) {
    const missing = missingRequired(vars, values);
    if (missing.length) {
      toast.error(`Fill in: ${missing.join(", ")}`);
      return;
    }
    const ok = await run("", { save });
    if (ok && save) {
      toast.success(savedLabel);
      router.refresh();
      onSaved?.();
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      {vars.map((v) => (
        <div key={v.name} className="space-y-1.5">
          <Label htmlFor={`var-${v.name}`}>
            {v.label ?? v.name}
            {v.required && <span className="text-destructive"> *</span>}
          </Label>
          {v.type === "select" ? (
            <Select value={values[v.name] ?? ""} onValueChange={(val) => set(v.name, val)}>
              <SelectTrigger id={`var-${v.name}`}>
                <SelectValue placeholder={`Choose ${v.label ?? v.name}`} />
              </SelectTrigger>
              <SelectContent>
                {(v.options ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : v.type === "textarea" ? (
            <VoiceTextarea
              id={`var-${v.name}`}
              rows={4}
              value={values[v.name] ?? ""}
              onValueChange={(val) => set(v.name, val)}
              disabled={isRunning}
            />
          ) : (
            <Input
              id={`var-${v.name}`}
              value={values[v.name] ?? ""}
              onChange={(e) => set(v.name, e.target.value)}
              disabled={isRunning}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleRun(false)} disabled={isRunning}>
          {isRunning ? "Running…" : "Run"}
        </Button>
        <Button variant="outline" onClick={() => handleRun(true)} disabled={isRunning}>
          Run &amp; save
        </Button>
        {isRunning && (
          <Button variant="ghost" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">⚠ {error}</p>}
      <AiOutput output={output} status={status} label="Result" />
      {output && status === "done" && (
        <ContextUsed query={Object.values(values).filter(Boolean).join(" ")} />
      )}
    </div>
  );
}
