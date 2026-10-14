import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregateLikes,
  buildContactListTemplate,
  buildLikeTemplate,
  buildUnlikeTemplate,
  contactPubkeys,
  KIND_DELETION,
  KIND_REACTION,
  type LikeSummary,
  latestEvent,
  mergeNotes,
} from "@/features/pulse/lib/pulse-events";
import {
  fetchContactList,
  fetchReactions,
  type PageLoader,
} from "@/features/pulse/lib/pulse-queries";
import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Opens a persistent subscription and returns its synchronous teardown. A
 * failed open (connection lost) or a terminal CLOSED reports through
 * `onError`; a teardown that runs before the open resolves still closes it.
 */
export function subscribeLive(
  client: BuzzRelayClient,
  filter: NostrFilter,
  onEvent: (event: NostrEvent) => void,
  onError: (message: string) => void,
): () => void {
  let stop: (() => void) | null = null;
  let closed = false;
  client
    .subscribe(filter, onEvent, {
      onClosed: (error) => {
        if (!closed) onError(errorMessage(error));
      },
    })
    .then(
      (unsubscribe) => {
        if (closed) unsubscribe();
        else stop = unsubscribe;
      },
      (error: unknown) => {
        if (!closed) onError(errorMessage(error));
      },
    );
  return () => {
    closed = true;
    stop?.();
  };
}

export type NoteFeed = {
  notes: NostrEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Live subscription failed; `reload` re-reads the feed and resubscribes. */
  liveError: string | null;
  hasMore: boolean;
  /** Notes from others received live, held back until the reader asks for them. */
  pending: NostrEvent[];
  loadMore: () => void;
  showPending: () => void;
  /** Insert a note this client just published. */
  addOwn: (note: NostrEvent) => void;
  reload: () => void;
};

/**
 * One paginated kind 1 feed. `loader` defines the page query; `live` (when
 * set) is the filter for a `since`-bounded subscription. Notes from other
 * authors arriving live are queued in `pending` instead of shifting the list.
 */
export function useNoteFeed({
  client,
  loader,
  live,
  me,
  matches,
}: {
  client: BuzzRelayClient | null;
  loader: PageLoader | null;
  live: NostrFilter | null;
  me: string;
  matches?: (note: NostrEvent) => boolean;
}): NoteFeed {
  const [notes, setNotes] = useState<NostrEvent[]>([]);
  const [pending, setPending] = useState<NostrEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const notesRef = useRef<NostrEvent[]>([]);
  notesRef.current = notes;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    void generation;
    let cancelled = false;
    setNotes([]);
    setPending([]);
    setCursor(null);
    setError(null);
    setLiveError(null);
    if (!loader) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loader(null)
      .then((page) => {
        if (cancelled) return;
        setNotes(page.notes);
        setCursor(page.cursor);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader, generation]);

  const loadMore = useCallback(() => {
    if (!loader || cursor === null || loadingMore) return;
    setLoadingMore(true);
    loader(cursor)
      .then((page) => {
        const merged = mergeNotes(notesRef.current, page.notes);
        // A page that adds nothing at the same cursor cannot make progress.
        const stalled = merged.length === notesRef.current.length && page.cursor === cursor;
        setNotes(merged);
        setCursor(stalled ? null : page.cursor);
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)))
      .finally(() => setLoadingMore(false));
  }, [loader, cursor, loadingMore]);

  const liveKey = live ? JSON.stringify(live) : null;
  useEffect(() => {
    void generation;
    if (!liveKey || !client) return;
    const filter = {
      ...(JSON.parse(liveKey) as NostrFilter),
      since: Math.floor(Date.now() / 1000),
    };
    const onEvent = (event: NostrEvent) => {
      if (mergeNotes([], [event]).length === 0) return;
      if (matchesRef.current && !matchesRef.current(event)) return;
      if (notesRef.current.some((note) => note.id === event.id)) return;
      if (event.pubkey === me) setNotes((current) => mergeNotes(current, [event]));
      else
        setPending((current) =>
          current.some((note) => note.id === event.id) ? current : [...current, event],
        );
    };
    return subscribeLive(client, filter, onEvent, setLiveError);
  }, [liveKey, me, client, generation]);

  const showPending = useCallback(() => {
    setNotes((current) => mergeNotes(current, pending));
    setPending([]);
  }, [pending]);

  const addOwn = useCallback((note: NostrEvent) => {
    if (matchesRef.current && !matchesRef.current(note)) return;
    setNotes((current) => mergeNotes(current, [note]));
  }, []);

  return {
    notes,
    loading,
    loadingMore,
    error,
    liveError,
    hasMore: cursor !== null,
    pending: pending.filter((note) => !notes.some((existing) => existing.id === note.id)),
    loadMore,
    showPending,
    addOwn,
    reload: () => setGeneration((value) => value + 1),
  };
}

export type Contacts = {
  pubkeys: string[];
  loaded: boolean;
  error: string | null;
  isFollowing: (pubkey: string) => boolean;
  /** Read-fresh-then-write follow/unfollow; rejects with the relay message. */
  setFollow: (pubkey: string, follow: boolean) => Promise<void>;
};

export function useContacts(client: BuzzRelayClient | null, me: string): Contacts {
  const [list, setList] = useState<NostrEvent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<NostrEvent | null>(null);
  listRef.current = list;

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setLoaded(false);
    setError(null);
    if (!client || !me) return;
    fetchContactList(client, me)
      .then((event) => {
        if (!cancelled) setList(event);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, me]);

  const setFollow = useCallback(
    async (pubkey: string, follow: boolean) => {
      if (!client) throw new Error("relay unavailable");
      // Never write from a possibly stale snapshot: re-read the list and keep
      // whichever copy is newest, so follows made elsewhere are preserved.
      const fresh = await fetchContactList(client, me);
      const base = latestEvent(
        [fresh, listRef.current].filter((event): event is NostrEvent => event !== null),
      );
      const template = buildContactListTemplate(
        base,
        pubkey,
        follow,
        Math.floor(Date.now() / 1000),
      );
      const { event } = await client.publish(template);
      setList(event);
    },
    [client, me],
  );

  const pubkeys = useMemo(() => contactPubkeys(list), [list]);
  return {
    pubkeys,
    loaded,
    error,
    isFollowing: (pubkey) => pubkeys.includes(pubkey.toLowerCase()),
    setFollow,
  };
}

export type Likes = {
  summary: (noteId: string) => LikeSummary;
  pendingIds: ReadonlySet<string>;
  toggle: (note: NostrEvent) => Promise<void>;
  /** Like counts could not be read, or their live updates stopped. */
  error: string | null;
  /** Re-read counts and resubscribe. */
  retry: () => void;
};

/** Like counts for the visible notes, kept live with kind 7/5 subscriptions. */
export function useLikes(client: BuzzRelayClient | null, noteIds: string[], me: string): Likes {
  const [reactions, setReactions] = useState<NostrEvent[]>([]);
  const [deletions, setDeletions] = useState<NostrEvent[]>([]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const idsKey = [...new Set(noteIds)].sort().join(",");

  useEffect(() => {
    void refresh;
    let cancelled = false;
    setError(null);
    const ids = idsKey ? idsKey.split(",") : [];
    if (!client || !ids.length) {
      setReactions([]);
      setDeletions([]);
      return;
    }
    fetchReactions(client, ids)
      .then((result) => {
        if (cancelled) return;
        setReactions(result.reactions);
        setDeletions(result.deletions);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [client, idsKey, refresh]);

  const reactionIdsKey = reactions.map((reaction) => reaction.id).join(",");
  useEffect(() => {
    void refresh;
    const ids = idsKey ? idsKey.split(",") : [];
    if (!client || !ids.length) return;
    const since = Math.floor(Date.now() / 1000);
    const stops: Array<() => void> = [];
    const add = (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => {
      stops.push(subscribeLive(client, filter, onEvent, setError));
    };
    add({ kinds: [KIND_REACTION], "#e": ids.slice(0, 500), since }, (event) =>
      setReactions((current) =>
        current.some((item) => item.id === event.id) ? current : [...current, event],
      ),
    );
    const reactionIds = reactionIdsKey ? reactionIdsKey.split(",") : [];
    if (reactionIds.length) {
      add({ kinds: [KIND_DELETION], "#e": reactionIds.slice(0, 500), since }, (event) =>
        setDeletions((current) =>
          current.some((item) => item.id === event.id) ? current : [...current, event],
        ),
      );
    }
    return () => {
      for (const stop of stops) stop();
    };
  }, [client, idsKey, reactionIdsKey, refresh]);

  const summaries = useMemo(
    () => aggregateLikes(idsKey ? idsKey.split(",") : [], reactions, deletions, me),
    [idsKey, reactions, deletions, me],
  );

  const toggle = useCallback(
    async (note: NostrEvent) => {
      if (!client || pendingIds.has(note.id)) return;
      const current = summaries.get(note.id);
      setPendingIds((ids) => new Set(ids).add(note.id));
      try {
        if (current?.myReactionId) {
          const { event } = await client.publish(buildUnlikeTemplate(current.myReactionId));
          setDeletions((items) => [...items, event]);
        } else {
          const { event } = await client.publish(buildLikeTemplate(note));
          setReactions((items) => [...items, event]);
        }
      } catch (toggleError) {
        // Another client of mine already liked it: reload to pick up that reaction.
        if (
          errorMessage(toggleError).toLowerCase().includes("duplicate: reaction already exists")
        ) {
          setRefresh((value) => value + 1);
          return;
        }
        throw toggleError;
      } finally {
        setPendingIds((ids) => {
          const next = new Set(ids);
          next.delete(note.id);
          return next;
        });
      }
    },
    [client, pendingIds, summaries],
  );

  return {
    summary: (noteId) => summaries.get(noteId) ?? { count: 0, myReactionId: null },
    pendingIds,
    toggle,
    error,
    retry: () => setRefresh((value) => value + 1),
  };
}
