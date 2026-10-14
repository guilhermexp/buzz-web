import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

/** Channel-scoped kinds fetched page by page: messages, system rows, edits, deletions, reactions, forum. */
export const EXPORT_PAGED_KINDS = [
  9, 40002, 40008, 40099, 40003, 5, 9005, 7, 45001, 45003,
] as const;
/** Canvas head (latest per channel only). */
export const CANVAS_KIND = 40100;
/** Every kind that may ever appear in an archive. Self-encrypted state (30078, 30300, …) never does. */
export const EXPORT_KIND_ALLOWLIST: ReadonlySet<number> = new Set([
  ...EXPORT_PAGED_KINDS,
  CANVAS_KIND,
]);
export const DELETION_KINDS: ReadonlySet<number> = new Set([5, 9005]);
export const EXPORT_PAGE_LIMIT = 500;
export const EXPORT_MAX_PAGES_PER_CHANNEL = 40;

export type ExportRange = { since: number | null; until: number | null };
export type PageCursor = { until: number; beforeId: string };

/** Relay REQ filter including Buzz's `before_id` cursor extension. */
export type ExportPageFilter = {
  kinds: number[];
  "#h": string[];
  limit: number;
  since?: number;
  until?: number;
  before_id?: string;
};

/** Channels this identity can read: joined channels or open ones. */
export function exportableChannels(channels: readonly BuzzChannel[]): BuzzChannel[] {
  return channels.filter((channel) => channel.isMember || channel.visibility === "open");
}

export function exportPageFilter(
  channelId: string,
  range: ExportRange,
  cursor: PageCursor | null,
): ExportPageFilter {
  const filter: ExportPageFilter = {
    kinds: [...EXPORT_PAGED_KINDS],
    "#h": [channelId],
    limit: EXPORT_PAGE_LIMIT,
  };
  if (range.since !== null) filter.since = range.since;
  if (cursor) {
    filter.until = cursor.until;
    filter.before_id = cursor.beforeId;
  } else if (range.until !== null) {
    filter.until = range.until;
  }
  return filter;
}

function compareAscending(left: NostrEvent, right: NostrEvent): number {
  return left.created_at === right.created_at
    ? left.id.localeCompare(right.id)
    : left.created_at - right.created_at;
}

/** Cursor for the next (older) page, or null once the relay returned a short page. */
export function nextPageCursor(page: readonly NostrEvent[], limit: number): PageCursor | null {
  if (page.length < limit || page.length === 0) return null;
  let oldest = page[0];
  for (const event of page) if (compareAscending(event, oldest) < 0) oldest = event;
  return { until: oldest.created_at, beforeId: oldest.id };
}

export function eventChannelTag(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

/** Strip everything except the NIP-01 signed fields so the archive stays verifiable and minimal. */
export function archiveEvent(event: NostrEvent): NostrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: event.sig,
  };
}

function inRange(event: NostrEvent, range: ExportRange): boolean {
  if (range.since !== null && event.created_at < range.since) return false;
  if (range.until !== null && event.created_at > range.until) return false;
  return true;
}

/** Ids of events whose deletion this archive honors (author kind:5 or relay-accepted moderator kind:9005). */
export function deletedEventIds(events: readonly NostrEvent[]): Set<string> {
  const authors = new Map(events.map((event) => [event.id, event.pubkey]));
  const deleted = new Set<string>();
  for (const event of events) {
    if (!DELETION_KINDS.has(event.kind)) continue;
    for (const tag of event.tags) {
      if (tag[0] !== "e" || !tag[1]) continue;
      const author = authors.get(tag[1]);
      if (event.kind === 9005 || author === undefined || author === event.pubkey) {
        deleted.add(tag[1]);
      }
    }
  }
  return deleted;
}

/**
 * Allowlisted, non-canvas events inside the range that belong to this channel; deduplicated,
 * oldest first. Buzz reactions (kind 7) and reaction removals (kind 5) carry no `h` tag — the
 * relay scopes them by target — so h-less ones are kept when their `e` target is in scope.
 */
export function channelEventsInScope(
  events: readonly NostrEvent[],
  channelId: string,
  range: ExportRange,
): NostrEvent[] {
  const unique = new Map<string, NostrEvent>();
  const unscoped: NostrEvent[] = [];
  for (const event of events) {
    if (!EXPORT_KIND_ALLOWLIST.has(event.kind) || event.kind === CANVAS_KIND) continue;
    if (!inRange(event, range)) continue;
    const channel = eventChannelTag(event);
    if (channel === channelId) unique.set(event.id, archiveEvent(event));
    else if (channel === null && (event.kind === 7 || event.kind === 5)) unscoped.push(event);
  }
  // Reactions first, then removals that may target those reactions.
  for (const kind of [7, 5]) {
    for (const event of unscoped) {
      if (event.kind !== kind) continue;
      const targets = event.tags.filter((tag) => tag[0] === "e" && tag[1]).map((tag) => tag[1]);
      if (targets.length && targets.every((target) => unique.has(target))) {
        unique.set(event.id, archiveEvent(event));
      }
    }
  }
  return [...unique.values()].sort(compareAscending);
}

/** In-scope events with deleted targets — and edits/reactions that reference them — removed. */
export function scopeChannelEvents(
  events: readonly NostrEvent[],
  channelId: string,
  range: ExportRange,
): NostrEvent[] {
  const scoped = channelEventsInScope(events, channelId, range);
  const deleted = deletedEventIds(scoped);
  return scoped.filter((event) => {
    if (deleted.has(event.id)) return false;
    if (event.kind !== 40003 && event.kind !== 7) return true;
    const target = event.tags.find((tag) => tag[0] === "e")?.[1];
    return !target || !deleted.has(target);
  });
}

/** Latest canvas head for the channel, if the relay returned one. */
export function latestCanvasHead(
  events: readonly NostrEvent[],
  channelId: string,
): NostrEvent | null {
  let head: NostrEvent | null = null;
  for (const event of events) {
    if (event.kind !== CANVAS_KIND || eventChannelTag(event) !== channelId) continue;
    if (!head || compareAscending(event, head) > 0) head = event;
  }
  return head ? archiveEvent(head) : null;
}
