import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Shared empty-state block: optional icon, one-line title, hint, action. Server-safe. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-6 py-10 text-center",
        className
      )}
    >
      {Icon && <Icon className="mb-1 h-5 w-5 text-muted-foreground" />}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
