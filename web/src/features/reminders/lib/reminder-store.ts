import {
  KIND_EVENT_REMINDER,
  nextCreatedAt,
  nextDueAt,
  type Reminder,
  type ReminderContent,
  type ReminderTarget,
  type ReminderTransition,
  randomReminderId,
  reminderFromEvent,
  reminderTags,
  serializeReminderContent,
  supersedes,
} from "@/features/reminders/lib/reminder-codec";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";
import {
  canEncryptToSelf,
  decryptNip44FromSelf,
  encryptNip44ToSelf,
} from "@/shared/lib/nostr-signer";

export type ReminderStoreStatus = "loading" | "ready" | "error" | "unsupported";

export type ReminderSnapshot = {
  status: ReminderStoreStatus;
  /** Latest version per `d`, including terminal states. */
  reminders: readonly Reminder[];
  /** Clock (unix seconds) all due computations of this snapshot use. */
  now: number;
  error: string | null;
};

/** Desktop's due-poll interval; the precise next-due timer is never longer. */
const POLL_INTERVAL_MS = 30_000;

/**
 * One author-private reminder set per Relay + identity. It keeps the REQ
 * `{kinds:[30300], authors:[me]}` open without `since`: the Relay re-publishes
 * a stored reminder at its `not_before`, and a reconnect replays every stored
 * reminder, so a client that missed the re-publish still sees it as due.
 */
export class ReminderStore {
  readonly pubkey: string;
  private byId = new Map<string, Reminder>();
  /** Parsed result per event id; re-publishes and reconnect replays skip decryption. */
  private parsed = new Map<string, Reminder | null>();
  private listeners = new Set<() => void>();
  private snapshot: ReminderSnapshot;
  private retainers = 0;
  private client: BuzzRelayClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopStateWatch: (() => void) | null = null;
  private generation = 0;
  private ingestQueue: Promise<void> = Promise.resolve();
  private opening = false;
  private timer: number | undefined;

  constructor(pubkey: string) {
    this.pubkey = pubkey.toLowerCase();
    this.snapshot = { status: "loading", reminders: [], now: nowSeconds(), error: null };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReminderSnapshot => this.snapshot;

  /** Keep the live subscription open while at least one consumer holds the store. */
  retain(client: BuzzRelayClient): () => void {
    this.retainers += 1;
    if (this.client !== client) this.attach(client);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retainers -= 1;
      if (this.retainers > 0) return;
      this.detach();
      // Do not keep decrypted reminders in memory once the workspace is gone (sign-out).
      this.byId.clear();
      this.parsed.clear();
      this.snapshot = { status: "loading", reminders: [], now: nowSeconds(), error: null };
    };
  }

  private attach(client: BuzzRelayClient): void {
    this.detach();
    this.client = client;
    if (!canEncryptToSelf()) {
      this.update({ status: "unsupported", error: t("collab.reminders.signerUnsupported") });
      return;
    }
    // Re-open after a failed connect or a CLOSED: the client only replays REQs it holds.
    this.stopStateWatch = client.onStateChange((state) => {
      if (state === "connected") void this.open();
    });
    void this.open();
    this.schedule();
  }

  private detach(): void {
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.opening = false;
    this.stopStateWatch?.();
    this.stopStateWatch = null;
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.client = null;
  }

  private async open(): Promise<void> {
    const client = this.client;
    if (!client || this.opening || this.unsubscribe) return;
    this.opening = true;
    const generation = ++this.generation;
    if (this.snapshot.status !== "ready") this.update({ status: "loading", error: null });
    try {
      const unsubscribe = await client.subscribe(
        { kinds: [KIND_EVENT_REMINDER], authors: [this.pubkey] },
        (event) => {
          this.ingestQueue = this.ingestQueue.then(() => this.ingest(event, generation));
        },
        {
          onEose: () => {
            this.ingestQueue = this.ingestQueue.then(() => {
              if (generation === this.generation) this.update({ status: "ready", error: null });
            });
          },
          onClosed: (error) => {
            if (generation !== this.generation) return;
            this.unsubscribe = null;
            this.opening = false;
            this.update({ status: "error", error: error.message });
          },
        },
      );
      if (generation !== this.generation) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({
        status: "error",
        error: error instanceof Error ? error.message : t("collab.reminders.loadFailed"),
      });
    } finally {
      if (generation === this.generation) this.opening = false;
    }
  }

  private async ingest(event: NostrEvent, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (this.parsed.has(event.id)) {
      // The Relay's due-time re-publish carries the already-known event: re-evaluate due.
      this.update({});
      return;
    }
    if (event.kind !== KIND_EVENT_REMINDER || event.pubkey.toLowerCase() !== this.pubkey) return;
    let plaintext: string;
    try {
      plaintext = await decryptNip44FromSelf(event.content);
    } catch {
      // Not cached: a locked or dismissed signer is transient, so the next delivery
      // (reconnect replay or the Relay's due-time re-publish) retries the decrypt.
      return;
    }
    // Released or re-subscribed while decrypting (e.g. sign-out): drop the plaintext.
    if (generation !== this.generation) return;
    const reminder = reminderFromEvent(event, plaintext, this.pubkey);
    // A decrypted but invalid payload is deterministic, so it is cached as ignored.
    this.parsed.set(event.id, reminder);
    if (reminder) this.accept(reminder);
  }

  private accept(reminder: Reminder): void {
    if (!supersedes(reminder, this.byId.get(reminder.id))) return;
    this.byId.set(reminder.id, reminder);
    this.update({ reminders: [...this.byId.values()] });
  }

  /** Record a reminder this client just published (the live echo is then a no-op). */
  applyPublished(reminder: Reminder): void {
    this.parsed.set(reminder.eventId, reminder);
    this.accept(reminder);
  }

  private update(patch: Partial<ReminderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, now: nowSeconds() };
    for (const listener of this.listeners) listener();
    if (this.client) this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    const now = nowSeconds();
    const next = nextDueAt(this.snapshot.reminders, now);
    const delay =
      next === null ? POLL_INTERVAL_MS : Math.min(POLL_INTERVAL_MS, (next - now) * 1_000 + 250);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.update({});
    }, delay);
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

const stores = new Map<string, ReminderStore>();

/** The shared store for a Relay + identity; never shared across either. */
export function getReminderStore(relayUrl: string, pubkey: string): ReminderStore {
  const key = `${relayUrl}|${pubkey.toLowerCase()}`;
  let store = stores.get(key);
  if (!store) {
    store = new ReminderStore(pubkey);
    stores.set(key, store);
  }
  return store;
}

async function publishReminder(
  client: BuzzRelayClient,
  store: ReminderStore,
  id: string,
  content: ReminderContent,
  transition: ReminderTransition,
  previousCreatedAt: number | null,
): Promise<Reminder> {
  const now = nowSeconds();
  const ciphertext = await encryptNip44ToSelf(serializeReminderContent(content));
  const { event } = await client.publish({
    kind: KIND_EVENT_REMINDER,
    created_at: previousCreatedAt === null ? now : nextCreatedAt(previousCreatedAt, now),
    content: ciphertext,
    tags: reminderTags(id, transition, now),
  });
  const reminder: Reminder = {
    id,
    ...(transition.status === "pending" ? { notBefore: transition.notBefore } : {}),
    content,
    createdAt: event.created_at,
    eventId: event.id,
  };
  store.applyPublished(reminder);
  return reminder;
}

export function createReminder(
  client: BuzzRelayClient,
  store: ReminderStore,
  input: { target: ReminderTarget; notBefore: number; note?: string },
): Promise<Reminder> {
  const note = input.note?.trim();
  return publishReminder(
    client,
    store,
    randomReminderId(),
    { target: input.target, ...(note ? { note } : {}), status: "pending" },
    { status: "pending", notBefore: input.notBefore },
    null,
  );
}

/** Snooze (pending + new `not_before`), complete or cancel: republish the same `d`. */
export function transitionReminder(
  client: BuzzRelayClient,
  store: ReminderStore,
  reminder: Reminder,
  transition: ReminderTransition,
): Promise<Reminder> {
  return publishReminder(
    client,
    store,
    reminder.id,
    { ...reminder.content, status: transition.status },
    transition,
    reminder.createdAt,
  );
}
