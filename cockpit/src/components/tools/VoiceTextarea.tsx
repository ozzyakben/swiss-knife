"use client";

import * as React from "react";

import { Textarea } from "@/components/ui/textarea";
import { VoiceButton } from "@/components/tools/VoiceButton";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Extra classes for the inner textarea (the outer `className` styles the wrapper). */
  textareaClassName?: string;
};

/**
 * A Textarea with an in-corner mic button (on-device dictation). Transcribed
 * speech is appended to the current value, so you can mix typing and talking.
 * Drop-in for the main input boxes: pass `value` + `onValueChange` instead of
 * `value` + `onChange`. The mic hides while disabled (e.g. mid-run).
 */
export function VoiceTextarea({
  value,
  onValueChange,
  className,
  textareaClassName,
  disabled,
  ...props
}: Props) {
  return (
    <div className={cn("relative", className)}>
      <Textarea
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        className={cn("pr-11", textareaClassName)}
        {...props}
      />
      {!disabled && (
        <div className="absolute bottom-2 right-2">
          <VoiceButton onText={(t) => onValueChange(value ? `${value} ${t}` : t)} />
        </div>
      )}
    </div>
  );
}
