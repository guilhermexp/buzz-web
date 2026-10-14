import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";

/** Non-destructive status line; `action` offers the one follow-up that resolves it. */
export function CanvasNotice({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
      role="status"
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 leading-relaxed text-foreground/85">{children}</p>
      {action ? (
        <Button size="sm" type="button" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
