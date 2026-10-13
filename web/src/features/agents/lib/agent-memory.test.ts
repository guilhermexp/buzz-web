import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMemoryView,
  deriveMemoryDTag,
  type EngramRecord,
  isValidSlug,
  parseEngramBody,
  readAgentMemory,
  selectHeads,
} from "@/features/agents/lib/agent-memory";
import type { NostrEvent } from "@/shared/api/nostr-types";
import {
  activateLocalSigner,
  clearActiveSigner,
  decryptNip44FromPeer,
  nip44ConversationHmacFromPeer,
} from "@/shared/lib/nostr-signer";

const ownerSecret = generateSecretKey();
const owner = getPublicKey(ownerSecret);
const agentSecret = generateSecretKey();
const agent = getPublicKey(agentSecret);
const conversationKey = getConversationKey(agentSecret, owner);
const agentHmac = (message: Uint8Array) => hmac(sha256, conversationKey, message);
const dFor = (slug: string) => deriveMemoryDTag(agentHmac, slug) ?? "";

function engram(slug: string, body: unknown, createdAt: number, d = dFor(slug)): NostrEvent {
  return finalizeEvent(
    {
      kind: 30174,
      created_at: createdAt,
      tags: [
        ["d", d],
        ["p", owner],
      ],
      content: encrypt(typeof body === "string" ? body : JSON.stringify(body), conversationKey),
    },
    agentSecret,
  ) as NostrEvent;
}

afterEach(() => clearActiveSigner());

describe("NIP-AE memory", () => {
  it("validates the slug grammar", () => {
    expect(isValidSlug("core")).toBe(true);
    expect(isValidSlug("mem/notes/2026-05-12")).toBe(true);
    expect(isValidSlug("mem/Notes")).toBe(false);
    expect(isValidSlug("mem/")).toBe(false);
    expect(isValidSlug("notes")).toBe(false);
  });

  it("selects heads by created_at with lowest-id tie break", () => {
    const record = (eventId: string, createdAt: number): EngramRecord => ({
      eventId,
      createdAt,
      dTag: "d",
      body: { slug: "mem/a", value: eventId },
    });
    expect(selectHeads([record("b", 5), record("a", 5), record("c", 4)])[0]?.eventId).toBe("a");
    expect(selectHeads([record("b", 5), record("z", 6)])[0]?.eventId).toBe("z");
  });

  it("rejects duplicate members, wrong shapes and d tags that do not re-derive", () => {
    const derive = (slug: string) => dFor(slug);
    const d = dFor("mem/a");
    expect(parseEngramBody('{"slug":"mem/a","value":"x","value":"y"}', d, derive)).toBeNull();
    expect(
      parseEngramBody('{"slug":"mem/a","nested":{"k":1,"k":2},"value":"x"}', d, derive),
    ).toBeNull();
    expect(parseEngramBody('{"slug":"mem/a","value":5}', d, derive)).toBeNull();
    expect(parseEngramBody('{"slug":"mem/a","value":"x"}', dFor("mem/b"), derive)).toBeNull();
    expect(
      parseEngramBody('{"slug":"mem/a","value":"x","extra":[{"a":1},{"a":2}]}', d, derive),
    ).toEqual({
      slug: "mem/a",
      value: "x",
    });
  });

  it("lists heads, honours tombstones and marks orphans unreachable from core", () => {
    const view = buildMemoryView(
      selectHeads([
        { eventId: "1", createdAt: 1, dTag: "c", body: { slug: "core", profile: "See [[mem/a]]" } },
        {
          eventId: "2",
          createdAt: 1,
          dTag: "a",
          body: { slug: "mem/a", value: "links [[mem/b]]" },
        },
        { eventId: "3", createdAt: 1, dTag: "b", body: { slug: "mem/b", value: "reached" } },
        { eventId: "4", createdAt: 1, dTag: "o", body: { slug: "mem/orphan", value: "alone" } },
        { eventId: "5", createdAt: 1, dTag: "t", body: { slug: "mem/gone", value: "old" } },
        { eventId: "6", createdAt: 2, dTag: "t", body: { slug: "mem/gone", value: null } },
      ]),
    );
    expect(view.core?.profile).toBe("See [[mem/a]]");
    expect(view.memories.map((entry) => [entry.slug, entry.reachable])).toEqual([
      ["mem/a", true],
      ["mem/b", true],
      ["mem/orphan", false],
    ]);
  });

  it("lets the owner read through the real signer and gives a stranger nothing", async () => {
    const events = [
      engram("core", { slug: "core", profile: "I help [[mem/x]]" }, 10),
      engram("mem/x", { slug: "mem/x", value: "first" }, 10),
      engram("mem/x", { slug: "mem/x", value: "second" }, 11),
      // Body claims mem/x but sits under another slug's address: must not hijack mem/x.
      engram("mem/y", { slug: "mem/x", value: "hijack" }, 12),
    ];
    activateLocalSigner(ownerSecret);
    const mine = await readAgentMemory(
      events,
      agent,
      owner,
      decryptNip44FromPeer,
      (message) => nip44ConversationHmacFromPeer(agent, message),
      5_000,
    );
    expect(mine.dTagsVerified).toBe(true);
    expect(mine.core?.profile).toBe("I help [[mem/x]]");
    expect(mine.memories.map((entry) => entry.value)).toEqual(["second"]);

    const strangerSecret = generateSecretKey();
    activateLocalSigner(strangerSecret);
    const stranger = await readAgentMemory(
      events,
      agent,
      getPublicKey(strangerSecret),
      decryptNip44FromPeer,
      (message) => nip44ConversationHmacFromPeer(agent, message),
      5_000,
    );
    expect(stranger.core).toBeNull();
    expect(stranger.memories).toEqual([]);
    // Pretending to be the owner does not help: the stranger's key cannot decrypt.
    const spoofed = await readAgentMemory(
      events,
      agent,
      owner,
      decryptNip44FromPeer,
      () => null,
      5_000,
    );
    expect(spoofed.core).toBeNull();
    expect(spoofed.memories).toEqual([]);
  });
});
