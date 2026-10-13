import { profilesFromEvents } from "@/features/chat/lib/chat-model";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import {
  CANVAS_KIND,
  EXPORT_MAX_PAGES_PER_CHANNEL,
  EXPORT_PAGE_LIMIT,
  type ExportRange,
  exportPageFilter,
  latestCanvasHead,
  nextPageCursor,
  type PageCursor,
} from "./content-export-model";

export type QueryClient = { query: (filter: NostrFilter) => Promise<NostrEvent[]> };

export type ChannelFetchResult = {
  /** Everything the relay returned for the channel (unscoped; scope before archiving). */
  events: NostrEvent[];
  canvasHead: NostrEvent | null;
  truncated: boolean;
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/** Page backwards through one channel with the relay's `until` + `before_id` cursor, bounded. */
export async function fetchChannelEvents(
  client: QueryClient,
  channelId: string,
  range: ExportRange,
  signal: AbortSignal,
  onPage: (fetchedSoFar: number) => void,
): Promise<ChannelFetchResult> {
  const events = new Map<string, NostrEvent>();
  let truncated = false;
  let cursor: PageCursor | null = null;
  for (let page = 0; ; page += 1) {
    if (page === EXPORT_MAX_PAGES_PER_CHANNEL) {
      truncated = true;
      break;
    }
    throwIfAborted(signal);
    const batch = await client.query(exportPageFilter(channelId, range, cursor) as NostrFilter);
    for (const event of batch) events.set(event.id, event);
    onPage(events.size);
    cursor = nextPageCursor(batch, EXPORT_PAGE_LIMIT);
    if (!cursor) break;
  }
  throwIfAborted(signal);
  const heads = await client.query({ kinds: [CANVAS_KIND], "#h": [channelId], limit: 1 });
  return {
    events: [...events.values()],
    canvasHead: latestCanvasHead(heads, channelId),
    truncated,
  };
}

const PROFILE_BATCH = 100;

/** Latest kind:0 names for the given authors (missing ones fall back to truncated pubkeys). */
export async function fetchAuthorProfiles(
  client: QueryClient,
  pubkeys: readonly string[],
  signal: AbortSignal,
): Promise<Record<string, UserProfile>> {
  const unique = [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))];
  const events: NostrEvent[] = [];
  for (let index = 0; index < unique.length; index += PROFILE_BATCH) {
    throwIfAborted(signal);
    const authors = unique.slice(index, index + PROFILE_BATCH);
    events.push(...(await client.query({ kinds: [0], authors, limit: authors.length })));
  }
  return profilesFromEvents(events, new Set());
}
