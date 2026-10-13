import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { type NoteFeed, useLikes } from "@/features/pulse/lib/use-pulse";
import { PulseNoteCard } from "@/features/pulse/ui/PulseNoteCard";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { getLocale, t } from "@/shared/i18n";

export function NotesSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label={t("collab.pulse.loading")}
      className="space-y-1"
      role="status"
    >
      {[0, 1, 2, 3].map((row) => (
        <div className="flex gap-3 px-2 py-4" key={row}>
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 max-w-sm animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PulseEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/** Inline failure with a retry; server detail is bounded because it is untrusted. */
export function PulseAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      <span className="min-w-0 break-words">{message.slice(0, 240)}</span>
      <button
        className="shrink-0 rounded px-2 py-1 font-medium hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onRetry}
      >
        {t("collab.pulse.retry")}
      </button>
    </div>
  );
}

function newNotesLabel(count: number): string {
  return count === 1
    ? t("collab.pulse.newNotesOne")
    : t("collab.pulse.newNotesOther", { count: count.toLocaleString(getLocale()) });
}

/** Renders a feed with live "new notes" pill, like counts and `until` pagination. */
export function PulseNoteList({
  feed,
  emptyMessage,
  notes = feed.notes,
  showLoadMore = true,
}: {
  feed: NoteFeed;
  emptyMessage: string;
  /** Override for client-side filtered views (search). */
  notes?: NostrEvent[];
  showLoadMore?: boolean;
}) {
  const { client, me, onPublished } = usePulseSession();
  const likes = useLikes(
    client,
    notes.map((note) => note.id),
    me,
  );
  const { addOwn } = feed;
  useEffect(() => onPublished(addOwn), [onPublished, addOwn]);

  return (
    <div className="relative">
      {feed.pending.length ? (
        <div className="sticky top-2 z-10 flex justify-center">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            type="button"
            onClick={feed.showPending}
          >
            <ArrowUp aria-hidden className="h-3.5 w-3.5" />
            {newNotesLabel(feed.pending.length)}
          </button>
        </div>
      ) : null}
      {feed.error ? (
        <PulseAlert
          message={`${t("collab.pulse.error.load")}: ${feed.error}`}
          onRetry={feed.reload}
        />
      ) : feed.liveError ? (
        <PulseAlert
          message={`${t("collab.pulse.error.live")}: ${feed.liveError}`}
          onRetry={feed.reload}
        />
      ) : null}
      {likes.error ? (
        <PulseAlert
          message={`${t("collab.pulse.error.likes")}: ${likes.error}`}
          onRetry={likes.retry}
        />
      ) : null}
      {feed.loading ? (
        <NotesSkeleton />
      ) : notes.length === 0 && !feed.error ? (
        <PulseEmpty message={emptyMessage} />
      ) : (
        <div>
          {notes.map((note) => (
            <PulseNoteCard key={note.id} likes={likes} note={note} />
          ))}
        </div>
      )}
      {showLoadMore && feed.hasMore && !feed.loading ? (
        <div className="flex justify-center py-4">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3.5 text-xs font-medium transition-colors hover:bg-foreground/5 disabled:opacity-60"
            disabled={feed.loadingMore}
            type="button"
            onClick={feed.loadMore}
          >
            {feed.loadingMore ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
            {feed.loadingMore ? t("collab.pulse.loadingMore") : t("collab.pulse.loadMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
