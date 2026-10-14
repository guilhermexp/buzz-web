import type { EventTemplate, NostrEvent } from "@/shared/api/nostr-types";

export const KIND_NOTE = 1;
export const KIND_CONTACTS = 3;
export const KIND_DELETION = 5;
export const KIND_REACTION = 7;
/** Desktop/relay cap for event content (`MAX_CONTENT_BYTES` in desktop events.rs). */
export const MAX_NOTE_BYTES = 64 * 1024;
export const FEED_PAGE_SIZE = 50;
/** Desktop caps reaction lookups at 200 note ids per request. */
export const MAX_REACTION_NOTE_IDS = 200;
/** Desktop caps the multi-author timeline filter at 100 pubkeys. */
export const MAX_TIMELINE_AUTHORS = 100;

const REPO_ADDRESS_PREFIX = "30617:";
const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Project issue/PR comments are kind:1 notes tagged with a NIP-34 repository
 * address (`a` = `30617:<owner>:<repo>`); desktop keeps them out of Pulse
 * because their parent is a git event, not a note.
 */
export function isProjectComment(event: Pick<NostrEvent, "tags">): boolean {
  return event.tags.some(
    (tag) => tag[0] === "a" && (tag[1]?.startsWith(REPO_ADDRESS_PREFIX) ?? false),
  );
}

/** Merge note pages: kind 1 only, no project comments, unique ids, newest first. */
export function mergeNotes(
  current: readonly NostrEvent[],
  incoming: readonly NostrEvent[],
): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const event of [...current, ...incoming]) {
    if (event.kind !== KIND_NOTE || isProjectComment(event)) continue;
    byId.set(event.id, event);
  }
  return [...byId.values()].sort(
    (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
}

/** Oldest timestamp of a page — the `until` cursor for the next page. */
export function nextUntil(notes: readonly NostrEvent[]): number | null {
  if (!notes.length) return null;
  return Math.min(...notes.map((note) => note.created_at));
}

function eTags(event: Pick<NostrEvent, "tags">): string[][] {
  return event.tags.filter((tag) => tag[0] === "e" && Boolean(tag[1]));
}

/** NIP-10 parent: marked `reply`, then the last unmarked `e`, then `root` (desktop order). */
export function getReplyParent(event: Pick<NostrEvent, "tags">): string | null {
  const tags = eTags(event).reverse();
  const marked = tags.find((tag) => tag[3] === "reply");
  if (marked) return marked[1];
  const unmarked = tags.find((tag) => !tag[3]);
  if (unmarked) return unmarked[1];
  return tags.find((tag) => tag[3] === "root")?.[1] ?? null;
}

/** NIP-10 thread root: marked `root`, else the first positional `e`, else the parent. */
export function getThreadRoot(event: Pick<NostrEvent, "tags">): string | null {
  const tags = eTags(event);
  const marked = tags.find((tag) => tag[3] === "root");
  if (marked) return marked[1];
  const positional = tags.find((tag) => !tag[3]);
  return positional?.[1] ?? getReplyParent(event);
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type NoteExtras = {
  parent?: NostrEvent | null;
  /** Mentioned pubkeys (desktop: picker-bound or unambiguous typed `@Name`). */
  mentions?: readonly string[];
  /** `imeta` tags for uploaded media referenced in the content. */
  mediaTags?: readonly (readonly string[])[];
};

/**
 * Kind 1 note, tag order as desktop `build_note`: NIP-10 markers
 * (`["e", root, "", "root"]` when the parent is itself a reply, then
 * `["e", parent, "", "reply"]`), `p` for the parent author plus mentions, then
 * `imeta` media tags.
 */
export function buildNoteTemplate(content: string, options: NoteExtras = {}): EventTemplate {
  const body = content.trim();
  if (!body) throw new Error("empty note");
  if (utf8Length(body) > MAX_NOTE_BYTES) throw new Error("note too long");
  const tags: string[][] = [];
  const pubkeys = new Set<string>();
  const parent = options.parent;
  if (parent) {
    const root = getThreadRoot(parent);
    if (root && root !== parent.id) tags.push(["e", root, "", "root"]);
    tags.push(["e", parent.id, "", "reply"]);
    pubkeys.add(parent.pubkey);
  }
  for (const pubkey of options.mentions ?? []) pubkeys.add(pubkey.toLowerCase());
  for (const pubkey of pubkeys) {
    if (HEX_64.test(pubkey)) tags.push(["p", pubkey]);
  }
  for (const tag of options.mediaTags ?? []) {
    if (tag[0] === "imeta") tags.push([...tag]);
  }
  return { kind: KIND_NOTE, content: body, tags };
}

/** NIP-25 like: `+` with the target's `e`, author `p` and kind `k`. */
export function buildLikeTemplate(note: Pick<NostrEvent, "id" | "pubkey" | "kind">): EventTemplate {
  return {
    kind: KIND_REACTION,
    content: "+",
    tags: [
      ["e", note.id],
      ["p", note.pubkey],
      ["k", String(note.kind)],
    ],
  };
}

/** NIP-09 deletion of one of my reactions. */
export function buildUnlikeTemplate(reactionId: string): EventTemplate {
  return {
    kind: KIND_DELETION,
    content: "",
    tags: [
      ["e", reactionId],
      ["k", String(KIND_REACTION)],
    ],
  };
}

export function deletedEventIds(deletions: readonly NostrEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const deletion of deletions) {
    if (deletion.kind !== KIND_DELETION) continue;
    for (const tag of eTags(deletion)) ids.add(tag[1]);
  }
  return ids;
}

function isLike(reaction: NostrEvent): boolean {
  return reaction.content === "" || reaction.content === "+";
}

export type LikeSummary = {
  count: number;
  /** My live `+` reaction on the note, if any; unlike deletes it. */
  myReactionId: string | null;
};

/**
 * Fold `+` reactions into per-note like counts: one per distinct reactor,
 * ignoring reactions deleted by their own author (NIP-09) and reactions whose
 * last `e` tag is not a requested note (desktop `last_matching_event_tag_id`).
 */
export function aggregateLikes(
  noteIds: readonly string[],
  reactions: readonly NostrEvent[],
  deletions: readonly NostrEvent[],
  me: string,
): Map<string, LikeSummary> {
  const targets = new Set(noteIds);
  const deletedBy = new Map<string, Set<string>>();
  for (const deletion of deletions) {
    if (deletion.kind !== KIND_DELETION) continue;
    for (const tag of eTags(deletion)) {
      const authors = deletedBy.get(tag[1]) ?? new Set<string>();
      authors.add(deletion.pubkey);
      deletedBy.set(tag[1], authors);
    }
  }
  const reactors = new Map<string, Set<string>>();
  const mine = new Map<string, NostrEvent>();
  for (const reaction of reactions) {
    if (reaction.kind !== KIND_REACTION || !isLike(reaction)) continue;
    if (deletedBy.get(reaction.id)?.has(reaction.pubkey)) continue;
    const target = eTags(reaction)
      .reverse()
      .find((tag) => targets.has(tag[1]))?.[1];
    if (!target) continue;
    const set = reactors.get(target) ?? new Set<string>();
    set.add(reaction.pubkey);
    reactors.set(target, set);
    if (reaction.pubkey === me) {
      const previous = mine.get(target);
      if (!previous || reaction.created_at > previous.created_at) mine.set(target, reaction);
    }
  }
  const summaries = new Map<string, LikeSummary>();
  for (const id of targets) {
    summaries.set(id, {
      count: reactors.get(id)?.size ?? 0,
      myReactionId: mine.get(id)?.id ?? null,
    });
  }
  return summaries;
}

/** Note ids I liked, newest like first, excluding my deleted reactions (desktop get_liked_notes). */
export function likedNoteIds(
  myReactions: readonly NostrEvent[],
  myDeletions: readonly NostrEvent[],
  limit: number,
): string[] {
  const deleted = deletedEventIds(myDeletions);
  const ids: string[] = [];
  const sorted = [...myReactions].sort((left, right) => right.created_at - left.created_at);
  for (const reaction of sorted) {
    if (ids.length >= limit) break;
    if (reaction.kind !== KIND_REACTION || !isLike(reaction) || deleted.has(reaction.id)) continue;
    const tags = eTags(reaction);
    const target = tags[tags.length - 1]?.[1];
    if (target && !ids.includes(target)) ids.push(target);
  }
  return ids;
}

/** Latest replaceable event (highest created_at, then lowest id per NIP-01). */
export function latestEvent(events: readonly NostrEvent[]): NostrEvent | null {
  let latest: NostrEvent | null = null;
  for (const event of events) {
    if (
      !latest ||
      event.created_at > latest.created_at ||
      (event.created_at === latest.created_at && event.id < latest.id)
    ) {
      latest = event;
    }
  }
  return latest;
}

export function contactPubkeys(contactList: Pick<NostrEvent, "tags"> | null): string[] {
  if (!contactList) return [];
  const pubkeys: string[] = [];
  for (const tag of contactList.tags) {
    const pubkey = tag[0] === "p" ? tag[1]?.toLowerCase() : undefined;
    if (pubkey && HEX_64.test(pubkey) && !pubkeys.includes(pubkey)) pubkeys.push(pubkey);
  }
  return pubkeys;
}

/**
 * Next kind 3 snapshot from the freshest known list: adds or removes one `p`
 * while preserving every other tag (other follows with relay/petname, `t`
 * hashtags, …) and the content (legacy relay map). `created_at` always moves
 * past the previous list so the replaceable event cannot lose to it.
 */
export function buildContactListTemplate(
  latest: NostrEvent | null,
  target: string,
  follow: boolean,
  nowSeconds: number,
): EventTemplate {
  const pubkey = target.toLowerCase();
  if (!HEX_64.test(pubkey)) throw new Error("invalid pubkey");
  const previous = latest?.tags ?? [];
  const isTarget = (tag: string[]) => tag[0] === "p" && tag[1]?.toLowerCase() === pubkey;
  const kept = previous.filter((tag) => !isTarget(tag)).map((tag) => [...tag]);
  const tags = !follow
    ? kept
    : previous.some(isTarget)
      ? previous.map((tag) => [...tag])
      : [...kept, ["p", pubkey]];
  return {
    kind: KIND_CONTACTS,
    content: latest?.content ?? "",
    tags,
    created_at: Math.max(nowSeconds, (latest?.created_at ?? 0) + 1),
  };
}

/** Client-side search over loaded notes: every word must match content or author name. */
export function searchNotes(
  notes: readonly NostrEvent[],
  query: string,
  authorName: (pubkey: string) => string,
): NostrEvent[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return notes.filter((note) => {
    const haystack = `${note.content}\n${authorName(note.pubkey)}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
