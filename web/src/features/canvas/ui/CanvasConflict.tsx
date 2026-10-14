import { GitMerge, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CanvasRevision } from "@/features/canvas/lib/canvas-protocol";
import { CanvasMarkdown } from "@/features/canvas/ui/CanvasMarkdown";
import { formatCanvasTime } from "@/features/canvas/ui/canvas-display";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/**
 * Recovery for a draft whose base is no longer the head: either the Relay
 * rejected the save (`conflict`) or a newer head arrived while editing
 * (`review`). The draft is never touched until the user picks an action.
 */
export function CanvasConflict({
  reason,
  theirs,
  authorName,
  busy,
  onMerge,
  onOverwrite,
  onDiscard,
}: {
  reason: "conflict" | "review";
  theirs: CanvasRevision | null;
  authorName: (pubkey: string) => string;
  busy: boolean;
  onMerge: () => void;
  onOverwrite: () => void;
  onDiscard: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      aria-labelledby="canvas-conflict-title"
      className="space-y-3 rounded-lg border border-[hsl(var(--buzz-warning)/0.45)] bg-[hsl(var(--buzz-warning)/0.08)] p-3"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--buzz-warning))]"
        />
        <div className="min-w-0 space-y-1">
          <h3
            className="text-sm font-semibold outline-none"
            id="canvas-conflict-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {reason === "conflict"
              ? t("collab.canvas.conflict.title")
              : t("collab.canvas.conflict.reviewTitle")}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("collab.canvas.conflict.body")}
          </p>
        </div>
      </div>
      <section
        aria-label={t("collab.canvas.conflict.latestRegion")}
        className="rounded-md border bg-background/80"
      >
        <p className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {theirs
            ? t("collab.canvas.conflict.latest", {
                name: authorName(theirs.author),
                time: formatCanvasTime(theirs.createdAt),
              })
            : t("collab.canvas.conflict.noHead")}
        </p>
        {theirs ? (
          <div className="buzz-scrollbar max-h-56 overflow-y-auto px-3 py-2">
            <CanvasMarkdown content={theirs.content} />
          </div>
        ) : null}
      </section>
      <div className="flex flex-wrap gap-2">
        {theirs ? (
          <Button disabled={busy} size="sm" type="button" onClick={onMerge}>
            <GitMerge aria-hidden="true" />
            {t("collab.canvas.conflict.merge")}
          </Button>
        ) : null}
        <Button disabled={busy} size="sm" type="button" variant="outline" onClick={onOverwrite}>
          <Upload aria-hidden="true" />
          {busy ? t("collab.canvas.saving") : t("collab.canvas.conflict.overwrite")}
        </Button>
        <Button disabled={busy} size="sm" type="button" variant="ghost" onClick={onDiscard}>
          <Trash2 aria-hidden="true" />
          {t("collab.canvas.conflict.discard")}
        </Button>
      </div>
    </section>
  );
}
