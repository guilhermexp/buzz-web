import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { verifiedAgentOwner } from "@/features/agents/lib/nip-oa";
import { agentOwnerCandidates, canEditCanvas } from "@/features/canvas/lib/canvas-permissions";
import type { BuzzChannel, ChannelMember, MemberRole } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

const SELF = "a".repeat(64);
const AGENT = "c".repeat(64);

function channel(role: MemberRole | null, overrides: Partial<BuzzChannel> = {}) {
  const members: ChannelMember[] = [{ pubkey: "b".repeat(64), role: "owner" }];
  if (role) members.unshift({ pubkey: SELF.toUpperCase(), role });
  return { type: "stream" as const, archived: false, members, ...overrides };
}

describe("canEditCanvas", () => {
  it("allows channel owners and admins only", () => {
    expect(canEditCanvas(channel("owner"), SELF)).toBe(true);
    expect(canEditCanvas(channel("admin"), SELF)).toBe(true);
    for (const role of ["member", "guest", "bot"] as const) {
      expect(canEditCanvas(channel(role), SELF)).toBe(false);
    }
  });

  it("denies identities outside the roster even when someone else owns the channel", () => {
    expect(canEditCanvas(channel(null), SELF)).toBe(false);
  });

  it("denies archived channels and DMs regardless of role", () => {
    expect(canEditCanvas(channel("owner", { archived: true }), SELF)).toBe(false);
    expect(canEditCanvas(channel("owner", { type: "dm" }), SELF)).toBe(false);
  });
});

describe("agent-owned channels", () => {
  const agentChannel = (selfRole: MemberRole | null, agentRole: MemberRole = "owner") => ({
    type: "stream" as const,
    archived: false,
    members: [
      ...(selfRole ? [{ pubkey: SELF, role: selfRole }] : []),
      { pubkey: AGENT, role: agentRole },
    ],
  });

  it("lets the verified owner of an owning agent edit, like desktop", () => {
    expect(agentOwnerCandidates(agentChannel("member"), SELF)).toEqual([AGENT]);
    expect(canEditCanvas(agentChannel("member"), SELF, { [AGENT]: SELF })).toBe(true);
  });

  it("requires the agent to own the channel, the attestation to name us, and roster presence", () => {
    expect(canEditCanvas(agentChannel("member"), SELF, { [AGENT]: "d".repeat(64) })).toBe(false);
    expect(canEditCanvas(agentChannel("member"), SELF, { [AGENT]: null })).toBe(false);
    expect(canEditCanvas(agentChannel("member", "admin"), SELF, { [AGENT]: SELF })).toBe(false);
    expect(canEditCanvas(agentChannel(null), SELF, { [AGENT]: SELF })).toBe(false);
    expect(
      canEditCanvas({ ...agentChannel("member"), archived: true }, SELF, { [AGENT]: SELF }),
    ).toBe(false);
  });

  it("skips the ownership lookup when the roster already decides", () => {
    expect(agentOwnerCandidates(agentChannel("admin"), SELF)).toEqual([]);
    expect(agentOwnerCandidates(agentChannel(null), SELF)).toEqual([]);
  });

  it("grants edit from a real NIP-OA attested agent profile and not from a forged one", () => {
    const ownerKey = generateSecretKey();
    const owner = getPublicKey(ownerKey);
    const agentKey = generateSecretKey();
    const agent = getPublicKey(agentKey);
    const attestation = bytesToHex(
      schnorr.sign(sha256(utf8ToBytes(`nostr:agent-auth:${agent}:`)), ownerKey),
    );
    const profile = (signature: string): NostrEvent =>
      finalizeEvent(
        {
          kind: 0,
          created_at: 1_791_900_000,
          content: "{}",
          tags: [["auth", owner, "", signature]],
        },
        agentKey,
      ) as NostrEvent;
    const room = {
      type: "stream" as const,
      archived: false,
      members: [
        { pubkey: owner, role: "member" as const },
        { pubkey: agent, role: "owner" as const },
      ],
    };

    expect(canEditCanvas(room, owner, { [agent]: verifiedAgentOwner(profile(attestation)) })).toBe(
      true,
    );
    const forged = `${attestation.slice(0, -2)}${attestation.endsWith("00") ? "11" : "00"}`;
    expect(canEditCanvas(room, owner, { [agent]: verifiedAgentOwner(profile(forged)) })).toBe(
      false,
    );
  });
});
