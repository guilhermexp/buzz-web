import {
  KIND_HUDDLE_ENDED,
  KIND_HUDDLE_PARTICIPANT_JOINED,
  KIND_HUDDLE_PARTICIPANT_LEFT,
  KIND_HUDDLE_STARTED,
} from "@/features/voice/lib/huddle-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

export type ActiveHuddle = {
  ephemeralChannelId: string;
  startedBy: string | null;
  participants: string[];
  /** created_at of the newest lifecycle event for this huddle. */
  lastActivity: number;
};

/** A just-started huddle may have no connected peer yet; trust it this long. */
export const HUDDLE_START_GRACE_SECONDS = 90;

/** The `ephemeral_channel_id` a lifecycle event refers to. */
export function lifecycleEphemeralChannelId(event: NostrEvent): string | null {
  try {
    const content: unknown = JSON.parse(event.content);
    if (!content || typeof content !== "object") return null;
    const value = (content as Record<string, unknown>).ephemeral_channel_id;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reconstruct the channel's current huddle from lifecycle events 48100–48103
 * (desktop HuddleIndicator semantics): causal order is created_at, then kind
 * (start < join < left < end), then id. 48101/48102 are relay-signed; the
 * participant is their `p` tag. Ended huddles are never resurrected by late
 * join/left events.
 */
export function reconstructActiveHuddle(events: Iterable<NostrEvent>): ActiveHuddle | null {
  const sorted = [...events].sort(
    (left, right) =>
      left.created_at - right.created_at ||
      left.kind - right.kind ||
      left.id.localeCompare(right.id),
  );
  let huddle: (Omit<ActiveHuddle, "participants"> & { participants: Set<string> }) | null = null;
  const ended = new Set<string>();
  for (const event of sorted) {
    const id = lifecycleEphemeralChannelId(event);
    if (!id) continue;
    const participant = (
      event.tags.find((tag) => tag[0] === "p")?.[1] ?? event.pubkey
    ).toLowerCase();
    switch (event.kind) {
      case KIND_HUDDLE_STARTED:
        ended.delete(id);
        huddle = {
          ephemeralChannelId: id,
          startedBy: event.pubkey,
          participants: new Set(),
          lastActivity: event.created_at,
        };
        break;
      case KIND_HUDDLE_PARTICIPANT_JOINED:
      case KIND_HUDDLE_PARTICIPANT_LEFT:
        if (ended.has(id)) break;
        if (!huddle || huddle.ephemeralChannelId !== id) {
          huddle = {
            ephemeralChannelId: id,
            startedBy: null,
            participants: new Set(),
            lastActivity: 0,
          };
        }
        if (event.kind === KIND_HUDDLE_PARTICIPANT_JOINED) huddle.participants.add(participant);
        else huddle.participants.delete(participant);
        huddle.lastActivity = Math.max(huddle.lastActivity, event.created_at);
        break;
      case KIND_HUDDLE_ENDED:
        ended.add(id);
        if (huddle?.ephemeralChannelId === id) huddle = null;
        break;
    }
  }
  return huddle ? { ...huddle, participants: [...huddle.participants] } : null;
}

/**
 * Whether a reconstructed huddle is live: the relay's 48104 liveness answer
 * wins when available; a fresh start is trusted during the grace window.
 */
export function isHuddleLive(
  huddle: ActiveHuddle,
  liveSessions: ReadonlySet<string> | null,
  nowSeconds: number,
): boolean {
  if (liveSessions?.has(huddle.ephemeralChannelId)) return true;
  if (nowSeconds - huddle.lastActivity <= HUDDLE_START_GRACE_SECONDS) return true;
  return liveSessions === null;
}

/**
 * Humans still in the room as seen by a leaving participant (who counts
 * themselves): the ephemeral channel's members (kind 39002) without the `bot`
 * role, plus peers live on the audio socket that 39002 does not mark as bots.
 * The live roster matters because the relay auto-adds audio joiners to the
 * channel without republishing 39002, so 39002 alone can miss connected humans.
 */
export function humansInHuddle(members: NostrEvent | null, livePubkeys: Iterable<string>): number {
  const humans = new Set<string>();
  const bots = new Set<string>();
  for (const tag of members?.tags ?? []) {
    if (tag[0] !== "p" || !tag[1]) continue;
    const pubkey = tag[1].toLowerCase();
    if (tag[3] === "bot") bots.add(pubkey);
    else humans.add(pubkey);
  }
  for (const pubkey of livePubkeys) {
    const normalized = pubkey.toLowerCase();
    if (!bots.has(normalized)) humans.add(normalized);
  }
  return humans.size;
}
