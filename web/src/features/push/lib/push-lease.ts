/**
 * NIP-PL kind:30350 push leases for the relay `webpush` transport.
 *
 * Subscription policy mirrors the Buzz mobile client
 * (mobile/lib/shared/push/push_subscription.dart): exact `#p=self` mentions on
 * every eligible kind, channel-wide traffic only for joined DMs and channels
 * the user explicitly chose, muted channels and self-authored events ignored.
 */

export const PUSH_LEASE_KIND = 30_350;
export const WEBPUSH_TRANSPORT = "webpush";
/** Lease lifetime requested; the relay caps leases at 30 days. */
export const LEASE_TTL_SECONDS = 29 * 24 * 60 * 60;
/** Refresh leases before they get this close to expiry. */
export const LEASE_REFRESH_MARGIN_SECONDS = 7 * 24 * 60 * 60;

const ELIGIBLE_KINDS = [9, 40_002, 45_001, 45_003];
const CHANNEL_KINDS = [9];
const CHANNEL_CHUNK = 50;
const MAX_SUBSCRIPTIONS = 16;
const HELLTHREAD_P_TAGS = 20;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** NIP-11 `push` descriptor fields this client relies on. */
export type PushDescriptor = {
  origin: string;
  keyId: string;
  relayPubkey: string;
  applicationServerKey: string;
  pushKinds: number[];
};

export type PushFilter = {
  kinds: number[];
  authors?: string[];
  "#p"?: string[];
  "#h"?: string[];
};

export type PushLeaseSubscription = {
  filter: PushFilter;
  class: "default";
  ignore?: PushFilter[];
  suppress?: { p_tags_max: number };
};

export type BrowserSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type ActiveLeasePlaintext = {
  v: 1;
  origin: string;
  generation: number;
  active: true;
  transport: typeof WEBPUSH_TRANSPORT;
  endpoint: string;
  subscriptions: PushLeaseSubscription[];
};

export type RevokedLeasePlaintext = { v: 1; origin: string; generation: number; active: false };

/** Active plaintext with exactly the members the relay accepts (unknown fields are rejected). */
export function buildActiveLeasePlaintext(input: {
  origin: string;
  generation: number;
  endpoint: string;
  subscriptions: PushLeaseSubscription[];
}): ActiveLeasePlaintext {
  return {
    v: 1,
    origin: input.origin,
    generation: input.generation,
    active: true,
    transport: WEBPUSH_TRANSPORT,
    endpoint: input.endpoint,
    subscriptions: input.subscriptions,
  };
}

/**
 * NIP-11 `push` member as served; every leaf stays `unknown` and is checked
 * below. Optional chaining tolerates nulls and primitives at each level.
 */
type RawPushDescriptor = {
  origin?: unknown;
  keys?: unknown;
  push_kinds?: unknown;
  class_support?: { webpush?: unknown } | null;
  webpush?: { application_server_key?: unknown } | null;
};
type RawExecutorKey = { id?: unknown; pubkey?: unknown; current?: unknown } | null;

/** Parse the relay's NIP-11 document; null when it cannot deliver Web Push. */
export function parsePushDescriptor(
  info: { push?: RawPushDescriptor | null } | null,
): PushDescriptor | null {
  const push = info?.push;
  if (!push || typeof push !== "object") return null;
  const webpushClasses = push.class_support?.webpush;
  const applicationServerKey = push.webpush?.application_server_key;
  const keys: RawExecutorKey[] = Array.isArray(push.keys) ? push.keys : [];
  const key = keys.find((candidate) => candidate?.current === true) ?? keys[0];
  const pushKinds = Array.isArray(push.push_kinds)
    ? push.push_kinds.filter((kind): kind is number => Number.isInteger(kind))
    : [];
  if (
    typeof push.origin !== "string" ||
    !Array.isArray(webpushClasses) ||
    !webpushClasses.includes("default") ||
    typeof applicationServerKey !== "string" ||
    !/^[A-Za-z0-9_-]{80,100}$/.test(applicationServerKey) ||
    typeof key?.id !== "string" ||
    typeof key.pubkey !== "string" ||
    !HEX64.test(key.pubkey)
  ) {
    return null;
  }
  return {
    origin: push.origin,
    keyId: key.id,
    relayPubkey: key.pubkey,
    applicationServerKey,
    pushKinds,
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/**
 * Desired lease subscriptions. Throws when the channel set exceeds the
 * NIP-PL quotas so the caller can tell the user instead of silently dropping.
 */
export function buildPushSubscriptions(input: {
  pubkey: string;
  /** Channels notified for every message: joined DMs plus chosen channels. */
  channelIds: Iterable<string>;
  mutedChannelIds: Iterable<string>;
  eligibleKinds?: number[];
}): PushLeaseSubscription[] {
  const pubkey = input.pubkey.toLowerCase();
  if (!HEX64.test(pubkey)) throw new Error("push-invalid-pubkey");
  const eligible = input.eligibleKinds?.length
    ? ELIGIBLE_KINDS.filter((kind) => input.eligibleKinds?.includes(kind))
    : ELIGIBLE_KINDS;
  const channels = new Set([...input.channelIds].map((id) => id.toLowerCase()));
  const muted = new Set([...input.mutedChannelIds].map((id) => id.toLowerCase()));
  // Desktop/mobile parity: a mention notifies even in a muted channel (the
  // mention check precedes the mute check); muting only drops the channel's
  // channel-wide traffic, so muted channels simply leave the `#h` set.
  const ignore: PushFilter[] = [{ kinds: eligible, authors: [pubkey] }];
  const suppress = { p_tags_max: HELLTHREAD_P_TAGS };
  const subscriptions: PushLeaseSubscription[] = [
    { filter: { kinds: eligible, "#p": [pubkey] }, class: "default", ignore, suppress },
  ];
  const notified = [...channels].filter((id) => !muted.has(id) && UUID_V4.test(id)).sort();
  for (const ids of chunks(notified, CHANNEL_CHUNK)) {
    subscriptions.push({
      filter: { kinds: CHANNEL_KINDS, "#h": ids },
      class: "default",
      ignore,
      suppress,
    });
  }
  if (subscriptions.length > MAX_SUBSCRIPTIONS) throw new Error("push-too-many-channels");
  return subscriptions;
}

/** Reduce `PushSubscription.toJSON()` to the exact lease endpoint schema. */
export function leaseEndpoint(subscription: PushSubscriptionJSON): string {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!endpoint?.startsWith("https://") || !p256dh || !auth) {
    throw new Error("push-invalid-subscription");
  }
  const json: BrowserSubscriptionJson = { endpoint, keys: { p256dh, auth } };
  return JSON.stringify(json);
}

/**
 * Generations must strictly increase per installation. Millisecond clock
 * values stay below 2^53 and survive lost local state; the stored value
 * guards against clock steps backwards.
 */
export function nextGeneration(previous: number, nowMs: number): number {
  return Math.max(previous + 1, Math.floor(nowMs));
}

/** Unsigned kind:30350 template; `content` is the NIP-44 ciphertext. */
export function buildLeaseTemplate(input: {
  installationId: string;
  keyId: string;
  expiration: number;
  content: string;
  createdAt: number;
}) {
  return {
    kind: PUSH_LEASE_KIND,
    created_at: input.createdAt,
    tags: [
      ["d", input.installationId],
      ["expiration", String(input.expiration)],
      ["exec", input.keyId],
      ["alt", "Buzz push notification lease"],
    ],
    content: input.content,
  };
}

/** 128-bit random installation id (`d` tag), distinct per community. */
export function newInstallationId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
