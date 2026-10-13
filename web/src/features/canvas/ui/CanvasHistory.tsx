import { ChevronsDown } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchCanvasHistoryPage } from "@/features/canvas/lib/canvas-api";
import {
  type CanvasHistoryCursor,
  type CanvasRevision,
  classifyCanvasError,
  isCanvasConflict,
  mergeRevisions,
} from "@/features/canvas/lib/canvas-protocol";
import { CanvasNotice } from "@/features/canvas/ui/CanvasNotice";
import { CanvasRevisionDetail } from "@/features/canvas/ui/CanvasRevisionDetail";
import { formatCanvasTime, useCanvasAuthorNames } from "@/features/canvas/ui/canvas-display";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

type HistoryState =
  | { status: "loading" }
  | { status: "error"; detail: string }
  | { status: "ready"; revisions: CanvasRevision[]; cursor: CanvasHistoryCursor | null };

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/**
 * Every kind-40100 write is a retained event, so the list is the complete
 * revision stream, newest first. Restore publishes the chosen content as a new
 * head guarded by the head that was current when the user confirmed.
 */
export function CanvasHistory({
  client,
  channelId,
  head,
  canRestore,
  onRestore,
}: {
  client: BuzzRelayClient;
  channelId: string;
  head: CanvasRevision | null;
  canRestore: boolean;
  onRestore: (
    revision: CanvasRevision,
    base: CanvasRevision | null,
  ) => Promise<{ verified: boolean }>;
}) {
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<
    { kind: "restored" | "unverified" } | { kind: "error"; message: string } | null
  >(null);
  const authorName = useCanvasAuthorNames(
    history.status === "ready" ? history.revisions.map((revision) => revision.author) : [],
  );

  useEffect(() => {
    let active = true;
    setHistory({ status: "loading" });
    fetchCanvasHistoryPage(client, channelId, null).then(
      (page) => {
        if (active) {
          setHistory({ status: "ready", revisions: page.revisions, cursor: page.nextCursor });
        }
      },
      (error: unknown) => {
        if (active) setHistory({ status: "error", detail: errorDetail(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [channelId, client]);

  // Live heads join the loaded list without resetting pagination.
  useEffect(() => {
    if (!head) return;
    setHistory((current) =>
      current.status === "ready"
        ? { ...current, revisions: mergeRevisions(current.revisions, [head]) }
        : current,
    );
  }, [head]);

  async function loadOlder() {
    if (history.status !== "ready" || !history.cursor) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await fetchCanvasHistoryPage(client, channelId, history.cursor);
      setHistory((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              revisions: mergeRevisions(current.revisions, page.revisions),
              cursor: page.nextCursor,
            }
          : current,
      );
    } catch (error) {
      setOlderError(t("collab.canvas.history.failed", { detail: errorDetail(error) }));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function restore(revision: CanvasRevision, base: CanvasRevision | null) {
    setRestoring(true);
    setRestoreResult(null);
    try {
      const result = await onRestore(revision, base);
      setSelectedId(null);
      setRestoreResult({ kind: result.verified ? "restored" : "unverified" });
    } catch (error) {
      const failure = classifyCanvasError(error);
      setRestoreResult({
        kind: "error",
        message: isCanvasConflict(failure)
          ? t("collab.canvas.history.restoreConflict")
          : failure === "superseded"
            ? t("collab.canvas.history.restoreSuperseded")
            : t("collab.canvas.history.restoreFailed", { detail: errorDetail(error) }),
      });
    } finally {
      setRestoring(false);
    }
  }

  if (history.status === "loading") {
    return (
      <div className="space-y-2 p-3" role="status">
        <span className="sr-only">{t("collab.canvas.history.loading")}</span>
        {[0, 1, 2].map((row) => (
          <div className="h-12 animate-pulse rounded-lg bg-muted/60" key={row} />
        ))}
      </div>
    );
  }
  if (history.status === "error") {
    return (
      <p className="m-3 text-sm text-destructive" role="alert">
        {t("collab.canvas.history.failed", { detail: history.detail })}
      </p>
    );
  }
  if (history.revisions.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        {t("collab.canvas.history.empty")}
      </p>
    );
  }

  return (
    <section aria-label={t("collab.canvas.history.title")} className="space-y-2 p-3">
      {restoreResult ? (
        restoreResult.kind === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {restoreResult.message}
          </p>
        ) : (
          <CanvasNotice>
            {restoreResult.kind === "restored"
              ? t("collab.canvas.history.restored")
              : t("collab.canvas.history.restoreUnverified")}
          </CanvasNotice>
        )
      ) : null}
      <ul className="space-y-1.5">
        {history.revisions.map((revision) => {
          const current = revision.eventId === head?.eventId;
          const selected = revision.eventId === selectedId;
          return (
            <li
              className={cn(
                "rounded-lg border transition-colors",
                selected ? "border-ring/60 bg-muted/30" : "border-border/70",
              )}
              key={revision.eventId}
            >
              <button
                aria-expanded={selected}
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                disabled={restoring}
                type="button"
                onClick={() => {
                  setRestoreResult(null);
                  setSelectedId(selected ? null : revision.eventId);
                }}
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {authorName(revision.author)}
                  {current ? (
                    <span className="ml-2 rounded-sm bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {t("collab.canvas.history.current")}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatCanvasTime(revision.createdAt)}
                </span>
              </button>
              {selected ? (
                <CanvasRevisionDetail
                  authorName={authorName}
                  canRestore={canRestore && !current}
                  current={head}
                  restoring={restoring}
                  revision={revision}
                  onRestore={(base) => void restore(revision, base)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {olderError ? (
        <p className="text-sm text-destructive" role="alert">
          {olderError}
        </p>
      ) : null}
      {history.cursor ? (
        <Button
          disabled={loadingOlder}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => void loadOlder()}
        >
          <ChevronsDown aria-hidden="true" />
          {loadingOlder
            ? t("collab.canvas.history.loadingOlder")
            : t("collab.canvas.history.loadOlder")}
        </Button>
      ) : null}
    </section>
  );
}
