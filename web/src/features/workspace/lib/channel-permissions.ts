import type { BuzzChannel } from "@/features/chat/lib/chat-types";

export type GrantableRole = "admin" | "member" | "guest";

/**
 * Roles the current identity may grant when adding someone to `channel`,
 * mirroring the Relay's NIP-29 put-user rule (buzz-relay
 * `channel_authz::decide_put_user`): any active member may add members,
 * guests and bots; only a channel owner/admin may grant an elevated role.
 * DMs and archived channels take no additions. Empty means "cannot add".
 * Agents are added with role `bot`, allowed whenever this list is non-empty.
 */
export function channelAddRoles(channel: BuzzChannel, pubkey: string): GrantableRole[] {
  if (channel.type === "dm" || channel.archived || !channel.isMember) return [];
  const self = pubkey.toLowerCase();
  const role = channel.members.find((member) => member.pubkey.toLowerCase() === self)?.role;
  if (!role) return [];
  return role === "owner" || role === "admin" ? ["admin", "member", "guest"] : ["member", "guest"];
}
