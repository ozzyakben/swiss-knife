"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/Markdown";
import type { AiToolStatus } from "@/hooks/useAiTool";

/** Shared streamed-output panel: renders markdown, copies raw text, shows a streaming indicator. */
export function AiOutput({
  output,
  status,
  label = "Output",
}: {
  output: string;
  status: AiToolStatus;
  label?: string;
}) {
  if (!output && status !== "streaming") return null;
  const streaming = status === "streaming";

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {label}
          {streaming && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-foreground/60" />
          )}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          disabled={!output}
          onClick={() => {
            navigator.clipboard.writeText(output);
            toast.success("Copied");
          }}
        >
          <Copy className="mr-1 h-4 w-4" /> Copy
        </Button>
      </CardHeader>
      <CardContent>
        {output ? (
          <Markdown>{output}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">Thinking…</p>
        )}
      </CardContent>
    </Card>
  );
}
