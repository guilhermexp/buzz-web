import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import {
  clearWorkerEnrollments,
  deleteWorkerEnrollment,
  putWorkerEnrollment,
} from "@/features/push/lib/push-idb";
import {
  buildActiveLeasePlaintext,
  buildLeaseTemplate,
  buildPushSubscriptions,
  LEASE_REFRESH_MARGIN_SECONDS,
  LEASE_TTL_SECONDS,
  leaseEndpoint,
  newInstallationId,
  nextGeneration,
  type PushDescriptor,
  parsePushDescriptor,
  type RevokedLeasePlaintext,
} from "@/features/push/lib/push-lease";
import {
  DEFAULT_PREFERENCES,
  listEnrollments,
  type PushEnrollmentRecord,
  type PushPreferences,
  readEnrollment,
  writeEnrollment,
} from "@/features/push/lib/push-store";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";
import { encryptNip44ToPeer } from "@/shared/lib/nostr-signer";

export type PushSupport = "supported" | "unsupported" | "insecure";

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  return "supported";
}

export class PushPermissionError extends Error {
  readonly permission: NotificationPermission;
  constructor(permission: NotificationPermission) {
    super(t("push.errorPermission"));
    this.name = "PushPermissionError";
    this.permission = permission;
  }
}

export async function fetchPushDescriptor(relayUrl: string): Promise<PushDescriptor | null> {
  const response = await fetch(relayHttpOrigin(relayUrl), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error(t("push.errorRelayInfo", { status: response.status }));
  return parsePushDescriptor(await response.json());
}

export async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  const scope = import.meta.env.BASE_URL;
  const existing = await navigator.serviceWorker.getRegistration(scope);
  if (!existing) await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
  return navigator.serviceWorker.ready;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, applicationServerKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = base64UrlToBytes(applicationServerKey);
  const actual = new Uint8Array(current);
  return (
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  );
}

/** Joined DMs that notify for every message, honoring the user's DM choice. */
export function notifiedChannelIds(
  channels: BuzzChannel[],
  preferences: PushPreferences,
): string[] {
  const joined = new Map(
    channels.filter((channel) => channel.isMember && !channel.archived).map((c) => [c.id, c]),
  );
  const ids = preferences.channelIds.filter(
    (id) => joined.get(id)?.type !== "dm" && joined.has(id),
  );
  if (preferences.directMessages) {
    for (const channel of joined.values()) if (channel.type === "dm") ids.push(channel.id);
  }
  return ids;
}

/**
 * Changes exactly when the lease's channel inputs change: joined channels
 * (DM status included) or the mute state of any of them. The bridge
 * republishes the lease whenever this key changes.
 */
export function leaseRefreshKey(
  channels: BuzzChannel[],
  mutedChannelIds: ReadonlySet<string>,
): string {
  return channels
    .filter((channel) => channel.isMember && !channel.archived)
    .map((channel) => `${channel.id}:${channel.type}:${mutedChannelIds.has(channel.id) ? 1 : 0}`)
    .sort()
    .join(",");
}

type LeaseContext = {
  client: BuzzRelayClient;
  relayUrl: string;
  pubkey: string;
  channels: BuzzChannel[];
  /** Muted channels from the relay user state; never notified. */
  mutedChannelIds: ReadonlySet<string>;
  /** Shown as the notification title by the service worker. */
  communityName: string;
};

async function publishLease(
  context: LeaseContext,
  descriptor: PushDescriptor,
  subscription: PushSubscription,
  preferences: PushPreferences,
): Promise<PushEnrollmentRecord> {
  const previous = readEnrollment(context.relayUrl, context.pubkey);
  const subscriptions = buildPushSubscriptions({
    pubkey: context.pubkey,
    channelIds: notifiedChannelIds(context.channels, preferences),
    mutedChannelIds: context.mutedChannelIds,
    eligibleKinds: descriptor.pushKinds,
  });
  const generation = nextGeneration(previous?.generation ?? 0, Date.now());
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + LEASE_TTL_SECONDS;
  const installationId = previous?.installationId ?? newInstallationId();
  const plaintext = buildActiveLeasePlaintext({
    origin: descriptor.origin,
    generation,
    endpoint: leaseEndpoint(subscription.toJSON()),
    subscriptions,
  });
  const content = await encryptNip44ToPeer(descriptor.relayPubkey, JSON.stringify(plaintext));
  await context.client.publish(
    buildLeaseTemplate({
      installationId,
      keyId: descriptor.keyId,
      expiration,
      content,
      createdAt: now,
    }),
  );
  const record: PushEnrollmentRecord = {
    relayUrl: context.relayUrl,
    pubkey: context.pubkey,
    installationId,
    generation,
    active: true,
    endpoint: subscription.endpoint,
    origin: descriptor.origin,
    expiration,
    fingerprint: JSON.stringify(subscriptions),
    preferences,
  };
  writeEnrollment(record);
  await putWorkerEnrollment({
    origin: descriptor.origin,
    relayUrl: context.relayUrl,
    pubkey: context.pubkey,
    title: t("push.notificationTitle", { community: context.communityName }),
    body: t("push.notificationBody"),
  });
  return record;
}

/**
 * Opt in from a user gesture: request permission, subscribe with the relay's
 * VAPID key and publish an encrypted lease. Other identities' enrollments
 * are retired first because one browser subscription serves the profile.
 */
export async function enablePush(
  context: LeaseContext & { preferences?: PushPreferences },
): Promise<PushEnrollmentRecord> {
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") throw new PushPermissionError(permission);
  const descriptor = await fetchPushDescriptor(context.relayUrl);
  if (!descriptor) throw new Error(t("push.relayUnsupported"));
  await retireForeignEnrollments(context.pubkey);
  const registration = await pushRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, descriptor.applicationServerKey)) {
    // A different application server key cannot share the subscription;
    // replacing it invalidates enrollments made with the old key.
    await dropBrowserSubscription();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(descriptor.applicationServerKey),
  });
  const preferences =
    context.preferences ??
    readEnrollment(context.relayUrl, context.pubkey)?.preferences ??
    DEFAULT_PREFERENCES;
  return publishLease(context, descriptor, subscription, preferences);
}

/**
 * Republish an active lease when preferences, joined DMs, mutes or expiry
 * changed. No-op (returns the record) when nothing changed; marks the record
 * inactive when the browser subscription is gone.
 */
export async function refreshPush(
  context: LeaseContext & { preferences?: PushPreferences; force?: boolean },
): Promise<PushEnrollmentRecord | null> {
  const record = readEnrollment(context.relayUrl, context.pubkey);
  if (!record?.active || Notification.permission !== "granted") return record;
  const registration = await pushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription || subscription.endpoint !== record.endpoint) {
    const stale = { ...record, active: false, endpoint: null };
    writeEnrollment(stale);
    if (record.origin) await deleteWorkerEnrollment(record.origin);
    return stale;
  }
  const preferences = context.preferences ?? record.preferences;
  const descriptor = await fetchPushDescriptor(context.relayUrl);
  if (!descriptor || !sameKey(subscription, descriptor.applicationServerKey)) return record;
  const fingerprint = JSON.stringify(
    buildPushSubscriptions({
      pubkey: context.pubkey,
      channelIds: notifiedChannelIds(context.channels, preferences),
      mutedChannelIds: context.mutedChannelIds,
      eligibleKinds: descriptor.pushKinds,
    }),
  );
  const now = Math.floor(Date.now() / 1000);
  if (
    !context.force &&
    fingerprint === record.fingerprint &&
    record.expiration - now > LEASE_REFRESH_MARGIN_SECONDS
  ) {
    return record;
  }
  return publishLease(context, descriptor, subscription, preferences);
}

async function publishRevocation(
  client: BuzzRelayClient,
  record: PushEnrollmentRecord,
): Promise<PushEnrollmentRecord> {
  const descriptor = await fetchPushDescriptor(record.relayUrl);
  if (!descriptor) throw new Error(t("push.relayUnsupported"));
  const generation = nextGeneration(record.generation, Date.now());
  const now = Math.floor(Date.now() / 1000);
  const plaintext: RevokedLeasePlaintext = {
    v: 1,
    origin: descriptor.origin,
    generation,
    active: false,
  };
  const content = await encryptNip44ToPeer(descriptor.relayPubkey, JSON.stringify(plaintext));
  await client.publish(
    buildLeaseTemplate({
      installationId: record.installationId,
      keyId: descriptor.keyId,
      expiration: now + LEASE_TTL_SECONDS,
      content,
      createdAt: now,
    }),
  );
  const revoked = { ...record, generation, active: false, endpoint: null, fingerprint: null };
  writeEnrollment(revoked);
  if (record.origin) await deleteWorkerEnrollment(record.origin);
  return revoked;
}

/** Unsubscribe the browser when no remembered enrollment still uses it. */
async function unsubscribeIfUnused(): Promise<void> {
  if (listEnrollments().some((record) => record.active)) return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

/** Opt out for this community: revoke the lease, then drop the subscription if unused. */
export async function disablePush(context: {
  client: BuzzRelayClient;
  relayUrl: string;
  pubkey: string;
}): Promise<void> {
  const record = readEnrollment(context.relayUrl, context.pubkey);
  if (record?.active) await publishRevocation(context.client, record);
  await unsubscribeIfUnused();
}

/**
 * Sign-out retirement, called while the signer is still active: revoke this
 * community's lease and unsubscribe the browser so leases this identity holds
 * in other communities die with the endpoint (the relay disables on 404/410).
 */
export async function retirePushEnrollment(context: {
  client: BuzzRelayClient | null;
  relayUrl: string;
  pubkey: string;
}): Promise<void> {
  if (detectPushSupport() !== "supported") return;
  const record = readEnrollment(context.relayUrl, context.pubkey);
  try {
    if (record?.active && context.client) await publishRevocation(context.client, record);
  } finally {
    await dropBrowserSubscription();
  }
}

/**
 * Identity switch without sign-out: enrollments of any other identity must
 * not keep delivering to this browser profile, and they cannot be revoked
 * without that identity's key, so the shared subscription is dropped.
 */
export async function retireForeignEnrollments(pubkey: string): Promise<boolean> {
  if (detectPushSupport() !== "supported") return false;
  const foreign = listEnrollments().some((record) => record.active && record.pubkey !== pubkey);
  if (!foreign) return false;
  await dropBrowserSubscription();
  return true;
}

/** Unsubscribe the profile's push subscription; every enrollment on it is dead. */
async function dropBrowserSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  for (const record of listEnrollments()) {
    if (record.active) writeEnrollment({ ...record, active: false, endpoint: null });
  }
  await clearWorkerEnrollments();
}
