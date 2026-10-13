import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import type { ManagedAgent } from "@/features/agents/lib/agent-control-client";
import { relayAgentsFromEvents } from "@/features/agents/lib/relay-agents";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

const AGENT = "a".repeat(64);
const CONFIGURED = "b".repeat(64);

function event(createdAt: number, content: Record<string, unknown>): NostrEvent {
  return {
    id: String(createdAt).padStart(64, "0"),
    pubkey: AGENT,
    kind: 10100,
    content: JSON.stringify(content),
    created_at: createdAt,
    tags: [],
    sig: "0".repeat(128),
  };
}

function channel(members: BuzzChannel["members"] = [{ pubkey: AGENT, role: "bot" }]): BuzzChannel {
  return {
    id: "channel-id",
    name: "general",
    description: "",
    topic: null,
    type: "stream",
    visibility: "open",
    archived: false,
    isMember: true,
    members,
    participantPubkeys: members.map((member) => member.pubkey),
  };
}

function authTag(ownerSecret: Uint8Array, agentPubkey: string, conditions = ""): string[] {
  const digest = sha256(utf8ToBytes(`nostr:agent-auth:${agentPubkey}:${conditions}`));
  return [
    "auth",
    getPublicKey(ownerSecret),
    conditions,
    bytesToHex(schnorr.sign(digest, ownerSecret)),
  ];
}

describe("relayAgentsFromEvents", () => {
  it("uses the latest agent profile and only relay membership for channel access", () => {
    const profiles: Record<string, UserProfile> = {
      [AGENT]: {
        pubkey: AGENT,
        name: "Profile name",
        about: "Remote coding assistant",
        picture: null,
        isAgent: true,
      },
    };
    const agents = relayAgentsFromEvents({
      events: [
        event(1, { name: "Old name", channel_add_policy: "anyone" }),
        event(2, {
          display_name: "Codex(remote)",
          capabilities: ["chat", "tools"],
          respond_to: "owner-only",
          channel_ids: ["declared"],
          channel_add_policy: "nobody",
        }),
      ],
      configuredAgents: [],
      managedAgents: [],
      channels: [channel()],
      profiles,
      presence: { [AGENT]: "online" },
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      pubkey: AGENT,
      name: "Codex(remote)",
      about: "Remote coding assistant",
      capabilities: ["chat", "tools"],
      respondTo: "owner-only",
      channelAddPolicy: "nobody",
      status: "online",
      ownerPubkey: null,
      managed: null,
    });
    // A self-declared channel list never grants or implies access.
    expect(agents[0]?.channelIds).toEqual(["channel-id"]);
  });

  it("keeps configured agents visible before they publish kind 10100", () => {
    const agents = relayAgentsFromEvents({
      events: [],
      configuredAgents: [{ pubkey: CONFIGURED, name: "Grok(remote)" }],
      managedAgents: [],
      channels: [],
      profiles: {},
      presence: {},
    });

    expect(agents).toEqual([
      expect.objectContaining({ pubkey: CONFIGURED, name: "Grok(remote)", status: "offline" }),
    ]);
  });

  it("deduplicates configured agents and bot memberships regardless of pubkey casing", () => {
    const agents = relayAgentsFromEvents({
      events: [],
      configuredAgents: [{ pubkey: AGENT.toUpperCase(), name: "Codex(remote)" }],
      managedAgents: [],
      channels: [channel()],
      profiles: {},
      presence: {},
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ pubkey: AGENT, channelIds: ["channel-id"] });
  });

  it("reports a NIP-OA owner only for a valid, single, matching auth tag on kind 0", () => {
    const ownerSecret = generateSecretKey();
    const agentSecret = generateSecretKey();
    const agentPubkey = getPublicKey(agentSecret);
    const strangerSecret = generateSecretKey();
    const kind0 = (tags: string[][]) =>
      finalizeEvent({ kind: 0, created_at: 100, content: "{}", tags }, agentSecret) as NostrEvent;
    const ownerOf = (metadata: NostrEvent) =>
      relayAgentsFromEvents({
        events: [metadata],
        configuredAgents: [{ pubkey: agentPubkey, name: "agent" }],
        managedAgents: [],
        channels: [],
        profiles: {},
        presence: {},
      })[0]?.ownerPubkey;

    expect(ownerOf(kind0([authTag(ownerSecret, agentPubkey)]))).toBe(getPublicKey(ownerSecret));
    // Signed for a different agent key.
    expect(ownerOf(kind0([authTag(ownerSecret, "c".repeat(64))]))).toBeNull();
    // Owner field swapped for someone who did not sign.
    const forged = authTag(ownerSecret, agentPubkey);
    forged[1] = getPublicKey(strangerSecret);
    expect(ownerOf(kind0([forged]))).toBeNull();
    // Two auth tags means no valid auth tag.
    expect(
      ownerOf(kind0([authTag(ownerSecret, agentPubkey), authTag(strangerSecret, agentPubkey)])),
    ).toBeNull();
    // Condition clauses are evaluated against the carrying event.
    expect(ownerOf(kind0([authTag(ownerSecret, agentPubkey, "kind=1")]))).toBeNull();
    expect(ownerOf(kind0([authTag(ownerSecret, agentPubkey, "kind=0&created_at<200")]))).toBe(
      getPublicKey(ownerSecret),
    );
  });

  it("merges a managed runtime with its relay presence and policy", () => {
    const managedAgent: ManagedAgent = {
      pubkey: CONFIGURED,
      name: "Runner",
      status: "running",
      authorized: true,
      config: {
        model: "m",
        respondTo: "allowlist",
        respondToAllowlist: [AGENT],
        channels: [],
        channelAddPolicy: "owner_only",
      },
      createdAt: 1,
      updatedAt: 1,
      lastExit: null,
    };
    const [agent] = relayAgentsFromEvents({
      events: [],
      configuredAgents: [],
      managedAgents: [managedAgent],
      channels: [],
      profiles: {},
      presence: { [CONFIGURED]: "away" },
    });
    expect(agent).toMatchObject({
      name: "Runner",
      status: "away",
      respondTo: "allowlist",
      respondToAllowlist: [AGENT],
      channelAddPolicy: "owner_only",
      managed: managedAgent,
    });
  });
});
