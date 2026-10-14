import type { BuzzChannel } from "@/features/chat/lib/chat-types";

type CanvasChannel = Pick<BuzzChannel, "type" | "archived" | "members">;

/**
 * Channel owners other than `pubkey` whose NIP-OA owner could grant `pubkey`
 * edit rights (desktop's `canManageOwnedAgentChannel` candidates). Empty when
 * the roster already decides: `pubkey` is absent, or is itself owner/admin.
 */
export function agentOwnerCandidates(channel: CanvasChannel, pubkey: string): string[] {
  const self = pubkey.toLowerCase();
  const selfRole = channel.members.find((member) => member.pubkey.toLowerCase() === self)?.role;
  if (!selfRole || selfRole === "owner" || selfRole === "admin") return [];
  return channel.members
    .filter((member) => member.role === "owner" && member.pubkey.toLowerCase() !== self)
    .map((member) => member.pubkey.toLowerCase());
}

/**
 * Buzz Desktop's canvas edit rule (`canEditNarrative` + archive gate): the
 * identity must be in the roster and either a channel owner/admin or the
 * verified NIP-OA owner of an agent that owns the channel; never in DMs or
 * archived channels. Community-level roles do not count. The Relay accepts
 * writes from any member; this is the client's product rule.
 *
 * `verifiedAgentOwners` maps a channel-owner pubkey to the owner its kind-0
 * NIP-OA `auth` tag verifiably attests (null when none).
 */
export function canEditCanvas(
  channel: CanvasChannel,
  pubkey: string,
  verifiedAgentOwners: Readonly<Record<string, string | null>> = {},
): boolean {
  if (channel.type === "dm" || channel.archived) return false;
  const self = pubkey.toLowerCase();
  const role = channel.members.find((member) => member.pubkey.toLowerCase() === self)?.role;
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  return agentOwnerCandidates(channel, self).some(
    (owner) => verifiedAgentOwners[owner]?.toLowerCase() === self,
  );
}
