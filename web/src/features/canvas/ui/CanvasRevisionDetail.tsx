import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { diffCanvasLines } from "@/features/canvas/lib/canvas-merge";
import type { CanvasRevision } from "@/features/canvas/lib/canvas-protocol";
import { CanvasMarkdown } from "@/features/canvas/ui/CanvasMarkdown";
import { formatCanvasTime } from "@/features/canvas/ui/canvas-display";
import { t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const DIFF_TONE = {
  added: "bg-[hsl(var(--buzz-positive)/0.1)] text-[hsl(var(--buzz-positive))]",
  removed: "bg-destructive/10 text-destructive",
  same: "text-muted-foreground",
} as const;
const DIFF_PREFIX = { added: "+", removed: "-", same: " " } as const;

function RevisionDiff({ current, revision }: { current: string; revision: string }) {
  const lines = diffCanvasLines(current, revision);
  if (lines.every((line) => line.kind === "same")) {
    return <p className="text-xs text-muted-foreground">{t("collab.canvas.history.identical")}</p>;
  }
  return (
    <pre className="buzz-scrollbar max-h-64 overflow-auto rounded-md border bg-background/70 py-1 font-mono text-xs leading-relaxed">
      {lines.map((line, index) => (
        // Lines have no identity beyond their position in this diff.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional diff rows
        <div className={cn("px-2 whitespace-pre-wrap", DIFF_TONE[line.kind])} key={index}>
          {`${DIFF_PREFIX[line.kind]} ${line.text}`}
        </div>
      ))}
    </pre>
  );
}

/**
 * Preview of one revision plus restore. The confirmation freezes the head that
 * is current when it opens, so a head arriving before the user confirms makes
 * the restore fail as a conflict instead of silently overwriting it.
 */
export function CanvasRevisionDetail({
  revision,
  current,
  canRestore,
  restoring,
  authorName,
  onRestore,
}: {
  revision: CanvasRevision;
  current: CanvasRevision | null;
  canRestore: boolean;
  restoring: boolean;
  authorName: (pubkey: string) => string;
  onRestore: (base: CanvasRevision | null) => void;
}) {
  const [view, setView] = useState<"preview" | "changes">("preview");
  const [confirmBase, setConfirmBase] = useState<{ base: CanvasRevision | null } | null>(null);
  const viewButton = (value: "preview" | "changes", label: string) => (
    <button
      aria-pressed={view === value}
      className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
      type="button"
      onClick={() => setView(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 border-t px-3 py-3">
      {current && current.eventId !== revision.eventId ? (
        <fieldset className="inline-flex gap-0.5 rounded-lg border-0 bg-muted/60 p-0.5">
          <legend className="sr-only">{t("collab.canvas.history.view")}</legend>
          {viewButton("preview", t("collab.canvas.history.preview"))}
          {viewButton("changes", t("collab.canvas.history.changes"))}
        </fieldset>
      ) : null}
      {view === "changes" && current ? (
        <RevisionDiff current={current.content} revision={revision.content} />
      ) : revision.content.trim() ? (
        <div className="buzz-scrollbar max-h-72 overflow-y-auto rounded-md border bg-background/70 px-3 py-2">
          <CanvasMarkdown content={revision.content} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("collab.canvas.history.emptyRevision")}</p>
      )}
      {canRestore && !confirmBase ? (
        <Button
          disabled={restoring}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => setConfirmBase({ base: current })}
        >
          <RotateCcw aria-hidden="true" />
          {restoring ? t("collab.canvas.history.restoring") : t("collab.canvas.history.restore")}
        </Button>
      ) : null}
      {canRestore && confirmBase ? (
        <section
          aria-labelledby={`canvas-restore-${revision.eventId}`}
          className="space-y-2 rounded-md border bg-background p-3"
        >
          <h4 className="text-sm font-semibold" id={`canvas-restore-${revision.eventId}`}>
            {t("collab.canvas.history.confirmTitle")}
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("collab.canvas.history.confirmBody", {
              name: authorName(revision.author),
              time: formatCanvasTime(revision.createdAt),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={restoring}
              size="sm"
              type="button"
              onClick={() => {
                const { base } = confirmBase;
                setConfirmBase(null);
                onRestore(base);
              }}
            >
              {t("collab.canvas.history.confirm")}
            </Button>
            <Button
              disabled={restoring}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setConfirmBase(null)}
            >
              {t("collab.canvas.cancel")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
