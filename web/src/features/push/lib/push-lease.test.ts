import { getConversationKey, decrypt as nip44Decrypt } from "nostr-tools/nip44";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { leaseRefreshKey } from "@/features/push/lib/push-enrollment";
import {
  buildActiveLeasePlaintext,
  buildLeaseTemplate,
  buildPushSubscriptions,
  leaseEndpoint,
  nextGeneration,
  parsePushDescriptor,
} from "@/features/push/lib/push-lease";
import {
  activateLocalSigner,
  clearActiveSigner,
  encryptNip44ToPeer,
} from "@/shared/lib/nostr-signer";

const ME = "a".repeat(64);
const DM = "123e4567-e89b-42d3-a456-426614174000";
const CHOSEN = "123e4567-e89b-42d3-a456-426614174001";
const MUTED = "123e4567-e89b-42d3-a456-426614174002";
const APP_KEY =
  "BOBU7aHsFMMPqEjmsay4fqJweEw3IcPY69xBeoWpo7yApB1AixNIzqhEPTRYfrxH_A1P2a2fSVw-poQ1Ww3v_jY";

function descriptorInfo(overrides: Record<string, unknown> = {}) {
  return {
    push: {
      origin: "ws://127.0.0.1:47300",
      keys: [{ id: "relay-v1", pubkey: "b".repeat(64), current: true }],
      push_kinds: [9, 40002, 45001, 45003],
      class_support: { webpush: ["default"] },
      webpush: { application_server_key: APP_KEY },
      ...overrides,
    },
  };
}

function channel(id: string, type: BuzzChannel["type"], isMember = true): BuzzChannel {
  return {
    id,
    name: id.slice(-4),
    description: "",
    topic: null,
    type,
    visibility: "private",
    archived: false,
    isMember,
    members: [],
    participantPubkeys: [],
  };
}

afterEach(() => clearActiveSigner());

describe("parsePushDescriptor", () => {
  it("accepts a webpush-capable relay and exposes the VAPID key and executor key", () => {
    expect(parsePushDescriptor(descriptorInfo())).toEqual({
      origin: "ws://127.0.0.1:47300",
      keyId: "relay-v1",
      relayPubkey: "b".repeat(64),
      applicationServerKey: APP_KEY,
      pushKinds: [9, 40002, 45001, 45003],
    });
  });

  it("rejects relays that cannot deliver browser push", () => {
    expect(parsePushDescriptor({})).toBeNull();
    expect(
      parsePushDescriptor(descriptorInfo({ class_support: { apns: ["default"] } })),
    ).toBeNull();
    expect(parsePushDescriptor(descriptorInfo({ webpush: null }))).toBeNull();
    expect(
      parsePushDescriptor(descriptorInfo({ keys: [{ id: "relay-v1", pubkey: "not-hex" }] })),
    ).toBeNull();
  });
});

describe("buildPushSubscriptions", () => {
  it("notifies mentions everywhere and every message in chosen channels, minus mutes and self", () => {
    const subscriptions = buildPushSubscriptions({
      pubkey: ME.toUpperCase(),
      channelIds: [DM, CHOSEN, MUTED, "general"],
      mutedChannelIds: [MUTED],
    });
    expect(subscriptions).toHaveLength(2);
    const [mentions, channels] = subscriptions;
    expect(mentions.filter).toEqual({ kinds: [9, 40002, 45001, 45003], "#p": [ME] });
    expect(channels.filter).toEqual({ kinds: [9], "#h": [DM, CHOSEN] });
    for (const subscription of subscriptions) {
      expect(subscription.ignore).toEqual([{ kinds: [9, 40002, 45001, 45003], authors: [ME] }]);
      expect(subscription.suppress).toEqual({ p_tags_max: 20 });
    }
  });

  it("restricts kinds to what the relay advertises and enforces NIP-PL quotas", () => {
    const [mentions] = buildPushSubscriptions({
      pubkey: ME,
      channelIds: [],
      mutedChannelIds: [],
      eligibleKinds: [9, 45001],
    });
    expect(mentions.filter.kinds).toEqual([9, 45001]);
    const many = Array.from(
      { length: 50 * 16 },
      (_, index) => `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, "0")}`,
    );
    expect(() =>
      buildPushSubscriptions({ pubkey: ME, channelIds: many, mutedChannelIds: [] }),
    ).toThrow("push-too-many-channels");
  });
});

describe("mute handling", () => {
  it("keeps mentions in a muted channel but drops its channel-wide traffic", () => {
    const subscriptions = buildPushSubscriptions({
      pubkey: ME,
      channelIds: [CHOSEN, MUTED],
      mutedChannelIds: [MUTED],
    });
    const [mentions, channels] = subscriptions;
    // Mentions match on #p alone; nothing ignores the muted channel's `h`.
    expect(mentions.filter).toEqual({ kinds: [9, 40002, 45001, 45003], "#p": [ME] });
    expect(JSON.stringify(mentions.ignore)).not.toContain(MUTED);
    expect(channels.filter).toEqual({ kinds: [9], "#h": [CHOSEN] });
    expect(subscriptions).toHaveLength(2);
  });

  it("changes the lease refresh key exactly when a joined channel's mute or membership changes", () => {
    const joined = [channel(DM, "dm"), channel(CHOSEN, "stream")];
    const base = leaseRefreshKey(joined, new Set());
    expect(leaseRefreshKey([...joined].reverse(), new Set())).toBe(base);
    expect(leaseRefreshKey(joined, new Set([CHOSEN]))).not.toBe(base);
    // Muting a channel the user has not joined does not alter the lease inputs.
    expect(leaseRefreshKey(joined, new Set([MUTED]))).toBe(base);
    expect(leaseRefreshKey([...joined, channel(MUTED, "stream")], new Set())).not.toBe(base);
    expect(leaseRefreshKey([channel(DM, "dm", false), joined[1]], new Set())).not.toBe(base);
  });
});
describe("lease envelope", () => {
  it("keeps only the endpoint and keys of the browser subscription", () => {
    const endpoint = leaseEndpoint({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x",
      expirationTime: null,
      keys: { p256dh: "BKey", auth: "auth" },
    });
    expect(JSON.parse(endpoint)).toEqual({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x",
      keys: { p256dh: "BKey", auth: "auth" },
    });
    expect(() => leaseEndpoint({ endpoint: "http://insecure.example", keys: {} })).toThrow();
  });

  it("generations strictly increase even when the clock steps backwards", () => {
    expect(nextGeneration(0, 1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(nextGeneration(1_700_000_000_000, 1_600_000_000_000)).toBe(1_700_000_000_001);
  });

  it("produces a kind 30350 event whose content only the relay key can open", async () => {
    const relaySecret = generateSecretKey();
    const relayPubkey = getPublicKey(relaySecret);
    const userPubkey = activateLocalSigner(generateSecretKey());
    const plaintext = buildActiveLeasePlaintext({
      origin: "ws://127.0.0.1:47300",
      generation: 7,
      endpoint:
        '{"endpoint":"https://fcm.googleapis.com/fcm/send/x","keys":{"p256dh":"k","auth":"a"}}',
      subscriptions: buildPushSubscriptions({
        pubkey: userPubkey,
        channelIds: [],
        mutedChannelIds: [],
      }),
    });
    const content = await encryptNip44ToPeer(relayPubkey, JSON.stringify(plaintext));
    const template = buildLeaseTemplate({
      installationId: "f".repeat(32),
      keyId: "relay-v1",
      expiration: 1_800_000_000,
      content,
      createdAt: 1_700_000_000,
    });
    expect(template.kind).toBe(30350);
    expect(template.tags.map(([name]) => name)).toEqual(["d", "expiration", "exec", "alt"]);
    expect(template.content).not.toContain("fcm.googleapis.com");
    const opened = JSON.parse(
      nip44Decrypt(template.content, getConversationKey(relaySecret, userPubkey)),
    );
    expect(Object.keys(opened).sort()).toEqual(
      ["active", "endpoint", "generation", "origin", "subscriptions", "transport", "v"].sort(),
    );
    expect(opened.transport).toBe("webpush");
    expect(opened.subscriptions[0].filter["#p"]).toEqual([userPubkey]);
  });
});
