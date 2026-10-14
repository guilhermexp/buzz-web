import type { BuzzChannel, MemberRole } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

/**
 * A role change the Relay accepted (kind 9000 OK) whose relay-signed roster
 * (kind 39002) has not been observed yet. `rosterVersion` is the newest
 * roster `created_at` known when the change was accepted: rosters at or
 * below it predate the change and must not overwrite it.
 */
export type PendingRoleChange = {
  channelId: string;
  pubkey: string;
  role: MemberRole;
  rosterVersion: number;
};

function rosterChannelId(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "d")?.[1] ?? null;
}

/**
 * Records fetched rosters in `cache` (newest per channel; the Relay stamps
 * each snapshot strictly after the previous one) and returns, for every
 * channel present in `fetched`, the newest roster known. Out-of-order query
 * responses therefore never regress a roster. Channels absent from `fetched`
 * are not resurrected from the cache, so lost visibility still applies.
 */
export function freshestRosters(
  cache: Map<string, NostrEvent>,
  fetched: readonly NostrEvent[],
): NostrEvent[] {
  const channelIds = new Set<string>();
  for (const event of fetched) {
    const channelId = rosterChannelId(event);
    if (!channelId) continue;
    channelIds.add(channelId);
    const cached = cache.get(channelId);
    if (!cached || event.created_at > cached.created_at) cache.set(channelId, event);
  }
  return [...channelIds].map((channelId) => cache.get(channelId) as NostrEvent);
}

/** Drops pending changes once a roster newer than their baseline arrived. */
export function settlePendingRoles(
  pending: readonly PendingRoleChange[],
  rosterVersions: Readonly<Record<string, number>>,
): PendingRoleChange[] {
  return pending.filter(
    (change) => (rosterVersions[change.channelId] ?? 0) <= change.rosterVersion,
  );
}

/** Overlays accepted-but-unobserved role changes onto stale rosters. */
export function applyPendingRoles(
  channels: BuzzChannel[],
  pending: readonly PendingRoleChange[],
): BuzzChannel[] {
  if (!pending.length) return channels;
  return channels.map((channel) => {
    const changes = pending.filter((change) => change.channelId === channel.id);
    if (!changes.length) return channel;
    let members = channel.members;
    for (const change of changes) {
      const target = change.pubkey.toLowerCase();
      const existing = members.some((member) => member.pubkey.toLowerCase() === target);
      members = existing
        ? members.map((member) =>
            member.pubkey.toLowerCase() === target ? { ...member, role: change.role } : member,
          )
        : [...members, { pubkey: target, role: change.role }];
    }
    return {
      ...channel,
      members,
      participantPubkeys: [
        ...new Set([...channel.participantPubkeys, ...changes.map((change) => change.pubkey)]),
      ],
    };
  });
}
