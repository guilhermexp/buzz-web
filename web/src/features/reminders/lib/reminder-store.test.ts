import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import { finalizeEvent } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeReminderContent } from "@/features/reminders/lib/reminder-codec";
import {
  createReminder,
  ReminderStore,
  transitionReminder,
} from "@/features/reminders/lib/reminder-store";
import type { EventTemplate, NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import {
  activateLocalSigner,
  activateNip07Signer,
  clearActiveSigner,
  encryptNip44ToSelf,
} from "@/shared/lib/nostr-signer";

const TARGET = {
  eventId: "b".repeat(64),
  channelId: "11111111-1111-4111-8111-111111111111",
  preview: "ship it",
  authorPubkey: "c".repeat(64),
};

type Handlers = { onEvent: (event: NostrEvent) => void; onEose?: () => void };

class FakeClient {
  handlers: Handlers[] = [];
  filters: unknown[] = [];
  published: NostrEvent[] = [];
  constructor(private readonly secretKey: Uint8Array) {}
  onStateChange(listener: (state: string) => void) {
    listener("connected");
    return () => undefined;
  }
  async subscribe(
    filter: unknown,
    onEvent: (event: NostrEvent) => void,
    lifecycle: { onEose?: () => void } = {},
  ) {
    this.filters.push(filter);
    this.handlers.push({ onEvent, onEose: lifecycle.onEose });
    return () => undefined;
  }
  async publish(template: EventTemplate) {
    const event = finalizeEvent(
      { ...template, created_at: template.created_at ?? Math.floor(Date.now() / 1_000) },
      this.secretKey,
    ) as NostrEvent;
    this.published.push(event);
    return { event, message: "" };
  }
  sign(template: EventTemplate): NostrEvent {
    return finalizeEvent(
      { ...template, created_at: template.created_at ?? 1 },
      this.secretKey,
    ) as NostrEvent;
  }
}

/** Drain the store's promise-chained decrypt queue (no timers involved). */
async function settle() {
  for (let index = 0; index < 200; index += 1) await Promise.resolve();
}

describe("ReminderStore", () => {
  let secretKey: Uint8Array;
  let pubkey: string;
  let client: FakeClient;
  let store: ReminderStore;
  let release: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    secretKey = generateSecretKey();
    pubkey = activateLocalSigner(secretKey);
    client = new FakeClient(secretKey);
    store = new ReminderStore(pubkey);
    release = store.retain(client as unknown as BuzzRelayClient);
  });

  afterEach(() => {
    release();
    clearActiveSigner();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function reminderEvent(
    d: string,
    status: "pending" | "done",
    createdAt: number,
    notBefore?: number,
  ) {
    return client.sign({
      kind: 30300,
      created_at: createdAt,
      content: await encryptNip44ToSelf(serializeReminderContent({ target: TARGET, status })),
      tags: [["d", d], ...(notBefore !== undefined ? [["not_before", String(notBefore)]] : [])],
    });
  }

  it("subscribes to the author's reminders without since and becomes ready after EOSE", async () => {
    await settle();
    expect(client.filters).toEqual([{ kinds: [30300], authors: [pubkey] }]);
    expect(store.getSnapshot().status).toBe("loading");
    client.handlers[0].onEvent(await reminderEvent("r1", "pending", 10, 100));
    client.handlers[0].onEose?.();
    await settle();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(store.getSnapshot().reminders).toHaveLength(1);
  });

  it("keeps only the newest version per d regardless of arrival order", async () => {
    await settle();
    const newer = await reminderEvent("r1", "done", 20);
    const older = await reminderEvent("r1", "pending", 10, 100);
    client.handlers[0].onEvent(newer);
    client.handlers[0].onEvent(older);
    await settle();
    const [only] = store.getSnapshot().reminders;
    expect(store.getSnapshot().reminders).toHaveLength(1);
    expect(only).toMatchObject({ eventId: newer.id, content: { status: "done" } });
    expect(only.notBefore).toBeUndefined();
  });

  it("ignores undecryptable, foreign and malformed events", async () => {
    await settle();
    const stranger = generateSecretKey();
    client.handlers[0].onEvent(
      finalizeEvent(
        { kind: 30300, created_at: 5, content: "x", tags: [["d", "foreign"]] },
        stranger,
      ) as NostrEvent,
    );
    client.handlers[0].onEvent(
      client.sign({ kind: 30300, created_at: 5, content: "garbage", tags: [["d", "bad"]] }),
    );
    client.handlers[0].onEvent(
      client.sign({
        kind: 30300,
        created_at: 5,
        content: await encryptNip44ToSelf(JSON.stringify({ status: "pending" })),
        tags: [["d", "empty"]],
      }),
    );
    await settle();
    expect(store.getSnapshot().reminders).toEqual([]);
  });

  it("a Relay re-publish of a known event re-evaluates due without duplicating", async () => {
    await settle();
    const event = await reminderEvent("r1", "pending", 10, 100);
    client.handlers[0].onEvent(event);
    await settle();
    const before = store.getSnapshot();
    client.handlers[0].onEvent(event);
    await settle();
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().reminders).toBe(before.reminders);
  });

  it("create, snooze and complete republish the same d with strictly newer created_at", async () => {
    await settle();
    const created = await createReminder(client as unknown as BuzzRelayClient, store, {
      target: TARGET,
      notBefore: 4_000_000_000,
      note: "  ",
    });
    expect(created.content).toEqual({ target: TARGET, status: "pending" });
    const snoozed = await transitionReminder(client as unknown as BuzzRelayClient, store, created, {
      status: "pending",
      notBefore: 4_000_000_500,
    });
    const done = await transitionReminder(client as unknown as BuzzRelayClient, store, snoozed, {
      status: "done",
    });
    const tagsOf = (event: NostrEvent) =>
      Object.fromEntries(event.tags.map((tag) => [tag[0], tag[1]]));
    const [first, second, third] = client.published;
    expect(tagsOf(first).d).toMatch(/^[0-9a-f]{32}$/);
    expect(tagsOf(second)).toMatchObject({ d: tagsOf(first).d, not_before: "4000000500" });
    expect(tagsOf(third).d).toBe(tagsOf(first).d);
    expect(tagsOf(third).not_before).toBeUndefined();
    expect(Number(tagsOf(third).expiration)).toBeGreaterThan(third.created_at + 29 * 86_400);
    expect(second.created_at).toBeGreaterThan(first.created_at);
    expect(third.created_at).toBeGreaterThan(second.created_at);
    // The live echo of our own publish is not decrypted again or reordered.
    client.handlers[0].onEvent(second);
    await settle();
    expect(store.getSnapshot().reminders).toEqual([done]);
  });
});

describe("ReminderStore with a NIP-07 signer", () => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  let decrypt: (ciphertext: string) => Promise<string>;
  let client: FakeClient;
  let store: ReminderStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("nostr", {
      getPublicKey: async () => pubkey,
      signEvent: async () => {
        throw new Error("unused");
      },
      nip44: {
        encrypt: async (_peer: string, plaintext: string) =>
          nip44.v2.encrypt(plaintext, conversationKey),
        decrypt: (_peer: string, ciphertext: string) => decrypt(ciphertext),
      },
    });
    decrypt = async (ciphertext) => nip44.v2.decrypt(ciphertext, conversationKey);
    await activateNip07Signer();
    client = new FakeClient(secretKey);
    store = new ReminderStore(pubkey);
  });

  afterEach(() => {
    clearActiveSigner();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const pendingEvent = () =>
    client.sign({
      kind: 30300,
      created_at: 10,
      content: nip44.v2.encrypt(
        serializeReminderContent({ target: TARGET, status: "pending" }),
        conversationKey,
      ),
      tags: [
        ["d", "r1"],
        ["not_before", "100"],
      ],
    });

  it("retries a decrypt the signer refused on the next delivery of the same event", async () => {
    const release = store.retain(client as unknown as BuzzRelayClient);
    await settle();
    const event = pendingEvent();
    decrypt = async () => {
      throw new Error("user rejected");
    };
    client.handlers[0].onEvent(event);
    await settle();
    expect(store.getSnapshot().reminders).toEqual([]);
    decrypt = async (ciphertext) => nip44.v2.decrypt(ciphertext, conversationKey);
    // The Relay's due-time re-publish (or a reconnect replay) delivers it again.
    client.handlers[0].onEvent(event);
    await settle();
    expect(store.getSnapshot().reminders.map((reminder) => reminder.id)).toEqual(["r1"]);
    release();
  });

  it("drops a decrypt that completes after release and does not poison the next session", async () => {
    const release = store.retain(client as unknown as BuzzRelayClient);
    await settle();
    const event = pendingEvent();
    let finish: (plaintext: string) => void = () => undefined;
    decrypt = (ciphertext) =>
      new Promise((resolve) => {
        finish = () => resolve(nip44.v2.decrypt(ciphertext, conversationKey));
      });
    client.handlers[0].onEvent(event);
    await settle();
    release();
    finish("");
    await settle();
    expect(store.getSnapshot().reminders).toEqual([]);

    decrypt = async (ciphertext) => nip44.v2.decrypt(ciphertext, conversationKey);
    const releaseAgain = store.retain(client as unknown as BuzzRelayClient);
    await settle();
    client.handlers[1].onEvent(event);
    await settle();
    expect(store.getSnapshot().reminders.map((reminder) => reminder.id)).toEqual(["r1"]);
    releaseAgain();
  });
});
