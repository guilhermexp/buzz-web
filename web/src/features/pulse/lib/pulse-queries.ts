import {
  FEED_PAGE_SIZE,
  KIND_CONTACTS,
  KIND_DELETION,
  KIND_NOTE,
  KIND_REACTION,
  latestEvent,
  likedNoteIds,
  MAX_REACTION_NOTE_IDS,
  mergeNotes,
  nextUntil,
} from "@/features/pulse/lib/pulse-events";
import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

export type FeedPage = { notes: NostrEvent[]; cursor: number | null };
export type PageLoader = (cursor: number | null) => Promise<FeedPage>;

/** Author-scoped or global kind 1 pages paginated by `until` (inclusive, deduped on merge). */
export function notesPageLoader(
  client: BuzzRelayClient,
  authors: readonly string[] | null,
): PageLoader {
  return async (cursor) => {
    const filter: NostrFilter = { kinds: [KIND_NOTE], limit: FEED_PAGE_SIZE };
    if (authors) filter.authors = [...authors];
    if (cursor !== null) filter.until = cursor;
    const events = await client.query(filter);
    const notes = mergeNotes([], events);
    // `until` is inclusive: the next page repeats the oldest second (deduped
    // on merge) so notes sharing that timestamp are never skipped.
    const oldest = nextUntil(events);
    return {
      notes,
      cursor: events.length >= FEED_PAGE_SIZE && oldest !== null ? oldest : null,
    };
  };
}

const LIKED_REACTION_PAGE = FEED_PAGE_SIZE * 4;

/** My `+` reactions (minus my deletions) resolved to their target notes, newest like first. */
export function likedPageLoader(client: BuzzRelayClient, me: string): PageLoader {
  return async (cursor) => {
    const filter: NostrFilter = {
      kinds: [KIND_REACTION],
      authors: [me],
      limit: LIKED_REACTION_PAGE,
    };
    if (cursor !== null) filter.until = cursor;
    const reactions = await client.query(filter);
    const deletions = reactions.length
      ? await client.query({
          kinds: [KIND_DELETION],
          authors: [me],
          "#e": reactions.map((reaction) => reaction.id),
          limit: 500,
        })
      : [];
    const ids = likedNoteIds(reactions, deletions, LIKED_REACTION_PAGE);
    const notes = ids.length
      ? await client.query({ kinds: [KIND_NOTE], ids, limit: ids.length })
      : [];
    const order = new Map(ids.map((id, index) => [id, index]));
    const oldest = nextUntil(reactions);
    return {
      notes: mergeNotes([], notes).sort(
        (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
      ),
      cursor: reactions.length >= LIKED_REACTION_PAGE && oldest !== null ? oldest : null,
    };
  };
}

export async function fetchContactList(
  client: BuzzRelayClient,
  pubkey: string,
): Promise<NostrEvent | null> {
  return latestEvent(await client.query({ kinds: [KIND_CONTACTS], authors: [pubkey], limit: 1 }));
}

export async function fetchNote(client: BuzzRelayClient, id: string): Promise<NostrEvent | null> {
  const events = await client.query({ ids: [id], kinds: [KIND_NOTE], limit: 1 });
  return events.find((event) => event.id === id) ?? null;
}

export async function fetchReplies(client: BuzzRelayClient, rootId: string): Promise<NostrEvent[]> {
  return mergeNotes([], await client.query({ kinds: [KIND_NOTE], "#e": [rootId], limit: 500 }));
}

/** Reactions on the given notes plus the deletions that reference those reactions. */
export async function fetchReactions(
  client: BuzzRelayClient,
  noteIds: readonly string[],
): Promise<{ reactions: NostrEvent[]; deletions: NostrEvent[] }> {
  const reactions: NostrEvent[] = [];
  for (let index = 0; index < noteIds.length; index += MAX_REACTION_NOTE_IDS) {
    const chunk = noteIds.slice(index, index + MAX_REACTION_NOTE_IDS);
    reactions.push(...(await client.query({ kinds: [KIND_REACTION], "#e": chunk, limit: 500 })));
  }
  const deletions: NostrEvent[] = [];
  const reactionIds = reactions.map((reaction) => reaction.id);
  for (let index = 0; index < reactionIds.length; index += 500) {
    deletions.push(
      ...(await client.query({
        kinds: [KIND_DELETION],
        "#e": reactionIds.slice(index, index + 500),
        limit: 500,
      })),
    );
  }
  return { reactions, deletions };
}
