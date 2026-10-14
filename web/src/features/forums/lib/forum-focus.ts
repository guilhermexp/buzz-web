import {
  FORUM_COMMENT_KIND,
  FORUM_POST_KIND,
  forumReplyReference,
} from "@/features/forums/lib/forum-events";
import type { NostrEvent } from "@/shared/api/nostr-types";

/** A focus request older than this is stale (the user navigated elsewhere first). */
const REQUEST_TTL_MS = 60_000;

type FocusRequest = { channelId: string; eventId: string; requestedAt: number };

let pending: FocusRequest | null = null;
const listeners = new Set<() => void>();

/**
 * Ask the forum view of `channelId` to open the topic containing `eventId` (a 45001
 * post or a 45003 reply). Call after selecting the channel; the request is consumed
 * by the mounted view or by the next one that mounts for that channel.
 */
export function requestForumFocus(channelId: string, eventId: string): void {
  pending = { channelId, eventId, requestedAt: Date.now() };
  for (const listener of listeners) listener();
}

/** Consume the pending request for `channelId`, if any and still fresh. */
export function takeForumFocus(channelId: string, now = Date.now()): string | null {
  if (!pending) return null;
  if (now - pending.requestedAt > REQUEST_TTL_MS) {
    pending = null;
    return null;
  }
  if (pending.channelId !== channelId) return null;
  const { eventId } = pending;
  pending = null;
  return eventId;
}

export function subscribeForumFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type ForumFocusTarget = { postId: string; replyId: string | null };

/** Topic and reply to open for a focused event of this channel; null when it is not one. */
export function resolveForumFocus(event: NostrEvent, channelId: string): ForumFocusTarget | null {
  if (!event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId)) return null;
  if (event.kind === FORUM_POST_KIND) return { postId: event.id, replyId: null };
  if (event.kind !== FORUM_COMMENT_KIND) return null;
  const { rootId } = forumReplyReference(event);
  return rootId ? { postId: rootId, replyId: event.id } : null;
}
