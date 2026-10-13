import { useEffect, useMemo, useState } from "react";
import { getThreadRoot, KIND_NOTE, mergeNotes } from "@/features/pulse/lib/pulse-events";
import { fetchNote } from "@/features/pulse/lib/pulse-queries";
import { subscribeLive, useLikes } from "@/features/pulse/lib/use-pulse";
import { PulseNoteCard } from "@/features/pulse/ui/PulseNoteCard";
import { NotesSkeleton, PulseAlert, PulseEmpty } from "@/features/pulse/ui/PulseNoteList";
import { usePulseSession } from "@/features/pulse/ui/pulse-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

/** Root note plus every kind 1 reply referencing the root or the opened note, kept live. */
export function PulseThreadView({ noteId }: { noteId: string }) {
  const { client, me, onPublished } = usePulseSession();
  const [root, setRoot] = useState<NostrEvent | null>(null);
  const [replies, setReplies] = useState<NostrEvent[]>([]);
  const [anchors, setAnchors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const retry = () => setGeneration((value) => value + 1);

  useEffect(() => {
    void generation;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLiveError(null);
    setRoot(null);
    setReplies([]);
    setAnchors([]);
    (async () => {
      const opened = await fetchNote(client, noteId);
      const rootId = (opened && getThreadRoot(opened)) ?? noteId;
      const rootNote = rootId === noteId ? opened : await fetchNote(client, rootId);
      const ids = [...new Set([rootId, noteId])];
      const found = await client.query({ kinds: [KIND_NOTE], "#e": ids, limit: 500 });
      if (cancelled) return;
      setRoot(rootNote);
      setAnchors(ids);
      setReplies(
        mergeNotes([], opened && opened.id !== rootId ? [...found, opened] : found).filter(
          (note) => note.id !== rootId,
        ),
      );
    })()
      .catch((loadError: unknown) => {
        if (!cancelled)
          setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, noteId, generation]);

  const anchorsKey = anchors.join(",");
  useEffect(() => {
    if (!anchorsKey) return;
    const ids = anchorsKey.split(",");
    const add = (note: NostrEvent) => {
      if (
        note.kind !== KIND_NOTE ||
        !note.tags.some((tag) => tag[0] === "e" && ids.includes(tag[1]))
      )
        return;
      setReplies((current) => mergeNotes(current, [note]));
    };
    const stopRelay = subscribeLive(
      client,
      { kinds: [KIND_NOTE], "#e": ids, since: Math.floor(Date.now() / 1000) },
      add,
      setLiveError,
    );
    const stopLocal = onPublished(add);
    return () => {
      stopRelay();
      stopLocal();
    };
  }, [client, anchorsKey, onPublished]);

  const ordered = useMemo(
    () => [...replies].sort((left, right) => left.created_at - right.created_at),
    [replies],
  );
  const likes = useLikes(
    client,
    [...(root ? [root.id] : []), ...ordered.map((note) => note.id)],
    me,
  );

  if (loading) return <NotesSkeleton />;
  if (error)
    return <PulseAlert message={`${t("collab.pulse.error.load")}: ${error}`} onRetry={retry} />;

  return (
    <div className="flex flex-col gap-4">
      {liveError ? (
        <PulseAlert message={`${t("collab.pulse.error.live")}: ${liveError}`} onRetry={retry} />
      ) : null}
      {likes.error ? (
        <PulseAlert
          message={`${t("collab.pulse.error.likes")}: ${likes.error}`}
          onRetry={likes.retry}
        />
      ) : null}
      {root ? (
        <div className="rounded-2xl border bg-background/60 px-2">
          <PulseNoteCard likes={likes} note={root} showReplyContext={false} />
        </div>
      ) : (
        <PulseEmpty message={t("collab.pulse.thread.unavailable")} />
      )}
      <section aria-label={t("collab.pulse.thread.replies")}>
        <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
          {t("collab.pulse.thread.replies")}
        </h4>
        {ordered.length ? (
          ordered.map((note) => <PulseNoteCard key={note.id} likes={likes} note={note} />)
        ) : (
          <PulseEmpty message={t("collab.pulse.thread.noReplies")} />
        )}
      </section>
    </div>
  );
}
