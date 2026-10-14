import type { ChannelAddPolicy, ManagedAgent } from "@/features/agents/lib/agent-control-client";
import { verifiedAgentOwner } from "@/features/agents/lib/nip-oa";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { ConfiguredAgent } from "@/shared/config/runtime-config";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type AgentRespondTo = "owner-only" | "allowlist" | "anyone" | "nobody";

export type RelayAgent = {
  pubkey: string;
  name: string;
  agentType: string;
  about: string;
  channelIds: string[];
  capabilities: string[];
  status: "online" | "away" | "offline";
  respondTo: AgentRespondTo | null;
  respondToAllowlist: string[];
  channelAddPolicy: ChannelAddPolicy | null;
  /** Owner proven by a valid NIP-OA tag on the agent's kind 0; shown as "managed by", never author. */
  ownerPubkey: string | null;
  /** Present only for agents this identity runs through Agent Control. */
  managed: ManagedAgent | null;
};

const ADD_POLICIES: readonly ChannelAddPolicy[] = ["anyone", "owner_only", "nobody"];
const RESPOND_TO: readonly AgentRespondTo[] = ["owner-only", "allowlist", "anyone", "nobody"];

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function latestByAuthor(events: readonly NostrEvent[], kind: number): Map<string, NostrEvent> {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== kind) continue;
    const pubkey = event.pubkey.toLowerCase();
    if ((latest.get(pubkey)?.created_at ?? 0) <= event.created_at) latest.set(pubkey, event);
  }
  return latest;
}

function contentOf(event: NostrEvent | undefined): Record<string, unknown> {
  if (!event) return {};
  try {
    const parsed = JSON.parse(event.content) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function relayAgentsFromEvents({
  events,
  configuredAgents,
  managedAgents = [],
  channels,
  profiles,
  presence,
}: {
  /** Kind 10100 agent profiles and kind 0 metadata (for NIP-OA verification). */
  events: readonly NostrEvent[];
  configuredAgents: readonly ConfiguredAgent[];
  /** Agents this identity runs through Agent Control (omit when not relevant to the caller). */
  managedAgents?: readonly ManagedAgent[];
  channels: readonly BuzzChannel[];
  profiles: Readonly<Record<string, UserProfile>>;
  presence: Readonly<Record<string, RelayAgent["status"]>>;
}): RelayAgent[] {
  const agentProfiles = latestByAuthor(events, 10100);
  const metadata = latestByAuthor(events, 0);
  const configured = new Map(configuredAgents.map((agent) => [agent.pubkey.toLowerCase(), agent]));
  const managed = new Map(managedAgents.map((agent) => [agent.pubkey, agent]));
  const botPubkeys = channels.flatMap((channel) =>
    channel.members
      .filter((member) => member.role === "bot")
      .map((member) => member.pubkey.toLowerCase()),
  );
  const pubkeys = new Set([
    ...agentProfiles.keys(),
    ...configured.keys(),
    ...managed.keys(),
    ...botPubkeys,
  ]);

  return [...pubkeys]
    .map((pubkey): RelayAgent => {
      const content = contentOf(agentProfiles.get(pubkey));
      const profile = profiles[pubkey];
      const managedAgent = managed.get(pubkey) ?? null;
      const nameValue = content.display_name ?? content.name;
      const metadataEvent = metadata.get(pubkey);
      const membershipChannelIds = channels
        .filter((channel) =>
          channel.members.some((member) => member.pubkey.toLowerCase() === pubkey),
        )
        .map((channel) => channel.id);
      return {
        pubkey,
        name:
          managedAgent?.name ||
          (typeof nameValue === "string" && nameValue.trim()) ||
          configured.get(pubkey)?.name ||
          profile?.name ||
          truncatePubkey(pubkey),
        agentType:
          typeof content.agent_type === "string" && content.agent_type.trim()
            ? content.agent_type.trim()
            : "agent",
        about: profile?.about ?? "",
        // Membership is the relay's authority; a self-declared channel list never grants access.
        channelIds: membershipChannelIds,
        capabilities: stringArray(content.capabilities),
        status: presence[pubkey] ?? "offline",
        respondTo:
          managedAgent?.config.respondTo ??
          RESPOND_TO.find((mode) => mode === content.respond_to) ??
          null,
        respondToAllowlist: managedAgent
          ? managedAgent.config.respondToAllowlist
          : stringArray(content.respond_to_allowlist).map((value) => value.toLowerCase()),
        channelAddPolicy:
          ADD_POLICIES.find((policy) => policy === content.channel_add_policy) ??
          managedAgent?.config.channelAddPolicy ??
          null,
        ownerPubkey: metadataEvent ? verifiedAgentOwner(metadataEvent) : null,
        managed: managedAgent,
      };
    })
    .sort(
      (left, right) =>
        Number(right.managed !== null) - Number(left.managed !== null) ||
        Number(right.status === "online") - Number(left.status === "online") ||
        left.name.localeCompare(right.name),
    );
}
