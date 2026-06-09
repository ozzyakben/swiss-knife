import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/** Shared destructive alert for tool errors — same look as the health banner. */
export function ErrorAlert({
  message,
  title = "Something went wrong",
  className,
}: {
  message: string;
  title?: string;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn(className)}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
