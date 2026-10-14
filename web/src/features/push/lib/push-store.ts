/**
 * Per community + identity enrollment state in localStorage. Holds no
 * secrets: the installation id and generation are needed to replace or
 * revoke the relay lease; the browser keeps the push keys itself.
 */

const PREFIX = "buzz:web:push:v1:";

export type PushPreferences = {
  /** Notify for every message in joined direct messages. */
  directMessages: boolean;
  /** Non-DM channels notified for every message (mentions always notify). */
  channelIds: string[];
};

export type PushEnrollmentRecord = {
  relayUrl: string;
  pubkey: string;
  installationId: string;
  generation: number;
  active: boolean;
  /** Push-service endpoint URL the active lease points at. */
  endpoint: string | null;
  origin: string | null;
  expiration: number;
  /** Fingerprint of the published subscriptions, to detect needed refreshes. */
  fingerprint: string | null;
  preferences: PushPreferences;
};

export const DEFAULT_PREFERENCES: PushPreferences = { directMessages: true, channelIds: [] };

export function pushStorageKey(relayUrl: string, pubkey: string): string {
  return `${PREFIX}${encodeURIComponent(relayUrl)}:${pubkey.toLowerCase()}`;
}

function parseRecord(raw: string | null): PushEnrollmentRecord | null {
  if (!raw) return null;
  try {
    const value: Partial<PushEnrollmentRecord> | null = JSON.parse(raw);
    if (
      !value ||
      typeof value.relayUrl !== "string" ||
      typeof value.pubkey !== "string" ||
      typeof value.installationId !== "string" ||
      !Number.isSafeInteger(value.generation) ||
      typeof value.active !== "boolean"
    ) {
      return null;
    }
    const preferences = value.preferences;
    return {
      relayUrl: value.relayUrl,
      pubkey: value.pubkey,
      installationId: value.installationId,
      generation: Number(value.generation),
      active: value.active,
      endpoint: typeof value.endpoint === "string" ? value.endpoint : null,
      origin: typeof value.origin === "string" ? value.origin : null,
      expiration: Number.isSafeInteger(value.expiration) ? Number(value.expiration) : 0,
      fingerprint: typeof value.fingerprint === "string" ? value.fingerprint : null,
      preferences: {
        directMessages:
          typeof preferences?.directMessages === "boolean"
            ? preferences.directMessages
            : DEFAULT_PREFERENCES.directMessages,
        channelIds: Array.isArray(preferences?.channelIds)
          ? preferences.channelIds.filter((id): id is string => typeof id === "string")
          : [],
      },
    };
  } catch {
    return null;
  }
}

export function readEnrollment(relayUrl: string, pubkey: string): PushEnrollmentRecord | null {
  return parseRecord(window.localStorage.getItem(pushStorageKey(relayUrl, pubkey)));
}

export function writeEnrollment(record: PushEnrollmentRecord): void {
  window.localStorage.setItem(
    pushStorageKey(record.relayUrl, record.pubkey),
    JSON.stringify(record),
  );
}

/** Every enrollment this browser profile remembers, across communities and identities. */
export function listEnrollments(): PushEnrollmentRecord[] {
  const records: PushEnrollmentRecord[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const record = parseRecord(window.localStorage.getItem(key));
    if (record) records.push(record);
  }
  return records;
}
