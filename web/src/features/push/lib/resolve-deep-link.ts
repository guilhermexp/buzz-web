import { tagValue, threadReference } from "@/features/chat/lib/chat-model";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { type BuzzDeepLink, sameRelay } from "@/features/push/lib/deep-link";
import type { NostrEvent } from "@/shared/api/nostr-types";

export type DeepLinkResolution =
  | { kind: "open"; channelId: string; eventId: string | null; threadRootId: string | null }
  | { kind: "other-community"; relayUrl: string }
  | { kind: "no-access" }
  | { kind: "missing"; channelId: string };

/**
 * Decide where a notification link may navigate for the CURRENT community
 * and identity. Nothing cached is trusted: the event is re-read from the
 * relay, which enforces read authorization, and must belong to the linked
 * channel. Links for another community never touch this session's data.
 */
export async function resolveDeepLink(
  link: BuzzDeepLink,
  session: {
    relayUrl: string;
    channels: BuzzChannel[];
    fetchEvent: (eventId: string) => Promise<NostrEvent | null>;
  },
): Promise<DeepLinkResolution> {
  if (!sameRelay(link.relayUrl, session.relayUrl)) {
    return { kind: "other-community", relayUrl: link.relayUrl };
  }
  const channel = session.channels.find((candidate) => candidate.id === link.channelId);
  const channelReadable = Boolean(channel && (channel.isMember || channel.visibility === "open"));
  if (!link.eventId) {
    return channelReadable
      ? { kind: "open", channelId: link.channelId, eventId: null, threadRootId: null }
      : { kind: "no-access" };
  }
  const event = await session.fetchEvent(link.eventId);
  if (!event) {
    return channelReadable ? { kind: "missing", channelId: link.channelId } : { kind: "no-access" };
  }
  if (event.id !== link.eventId || tagValue(event, "h") !== link.channelId) {
    return { kind: "no-access" };
  }
  const { rootId } = threadReference(event);
  return {
    kind: "open",
    channelId: link.channelId,
    eventId: event.id,
    threadRootId: rootId && rootId !== event.id ? rootId : null,
  };
}
