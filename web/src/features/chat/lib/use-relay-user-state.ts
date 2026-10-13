import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";
import {
  canEncryptToSelf,
  decryptNip44FromSelf,
  encryptNip44ToSelf,
} from "@/shared/lib/nostr-signer";

const USER_STATE_KIND = 30078;
const STAR_D_TAG = "channel-stars";
const MUTE_D_TAG = "channel-mutes";
const READ_D_TAG_PREFIX = "read-state:";
const PUBLISH_DELAY_MS = 5_000;
const RETRY_DELAY_MS = 5_000;
const MAX_CONTEXTS = 1_000;
const MAX_CONTEXT_BYTES = 32_000;

type PreferenceEntry = { enabled: boolean; updatedAt: number };
type PreferenceStore = Record<string, PreferenceEntry>;
type DirtyState = { stars: boolean; mutes: boolean; reads: boolean };

type ParsedReadState = {
  clientId: string;
  contexts: Record<string, number>;
};

type LocalUserState = {
  version: 1;
  clientId: string;
  slotId: string;
  stars: PreferenceStore;
  mutes: PreferenceStore;
  contexts: Record<string, number>;
};

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function relayUserStateStorageKey(relayUrl: string, pubkey: string): string {
  return `buzz:web:relay-user-state:v1:${encodeURIComponent(relayUrl)}:${pubkey.toLowerCase()}`;
}

function defaultLocalState(): LocalUserState {
  return {
    version: 1,
    clientId: randomHex(8),
    slotId: randomHex(16),
    stars: {},
    mutes: {},
    contexts: {},
  };
}

function validTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4_294_967_295;
}

export function parsePreferenceStore(value: unknown, field: "starred" | "muted"): PreferenceStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: PreferenceStore = {};
  for (const [channelId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    const enabled = typeof entry.enabled === "boolean" ? entry.enabled : entry[field];
    if (typeof enabled !== "boolean" || !validTimestamp(entry.updatedAt)) continue;
    store[channelId] = { enabled, updatedAt: entry.updatedAt };
  }
  return store;
}

export function compactReadContexts(value: Record<string, number>): Record<string, number> {
  const entries = Object.entries(value);
  const durable = entries.filter(
    ([contextId]) => !contextId.startsWith("msg:") && !contextId.startsWith("thread:"),
  );
  const prunable = entries
    .filter(([contextId]) => contextId.startsWith("msg:") || contextId.startsWith("thread:"))
    .sort((left, right) => right[1] - left[1]);
  const prioritized = [...durable.sort((left, right) => right[1] - left[1]), ...prunable];
  const retained: Array<[string, number]> = [];
  let serializedBytes = 2;
  const encoder = new TextEncoder();
  for (const entry of prioritized) {
    if (retained.length >= MAX_CONTEXTS) break;
    const pairBytes = encoder.encode(JSON.stringify(entry[0])).length + 1 + String(entry[1]).length;
    const nextBytes = serializedBytes + (retained.length ? 1 : 0) + pairBytes;
    if (nextBytes > MAX_CONTEXT_BYTES) continue;
    retained.push(entry);
    serializedBytes = nextBytes;
  }
  return Object.fromEntries(retained);
}

function sanitizeReadContexts(value: unknown, wireFormat: boolean): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const contexts: Record<string, number> = {};
  for (const [wireId, timestamp] of Object.entries(value as Record<string, unknown>)) {
    if (!validTimestamp(timestamp)) continue;
    if (wireFormat && wireId.startsWith("ov_")) continue;
    const contextId = wireFormat && wireId.startsWith("esc:") ? wireId.slice(4) : wireId;
    if (new TextEncoder().encode(contextId).length <= 256) contexts[contextId] = timestamp;
  }
  return compactReadContexts(contexts);
}

export function parseReadContexts(value: unknown): Record<string, number> {
  return sanitizeReadContexts(value, true);
}

export function parseReadStatePayload(value: unknown): ParsedReadState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.v !== 1) return null;
  if (
    typeof payload.client_id !== "string" ||
    new TextEncoder().encode(payload.client_id).length < 1 ||
    new TextEncoder().encode(payload.client_id).length > 64
  ) {
    return null;
  }
  if (
    !payload.contexts ||
    typeof payload.contexts !== "object" ||
    Array.isArray(payload.contexts)
  ) {
    return null;
  }
  if (Object.keys(payload.contexts as Record<string, unknown>).length > 10_000) return null;
  return {
    clientId: payload.client_id,
    contexts: parseReadContexts(payload.contexts),
  };
}

export function readStateCoordinate(event: NostrEvent): string | null {
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  const readTags = event.tags.filter(
    (tag) => tag.length === 2 && tag[0] === "t" && tag[1] === "read-state",
  );
  const dTag = dTags[0]?.[1];
  return dTags.length === 1 && readTags.length === 1 && /^read-state:[0-9a-f]{32}$/.test(dTag ?? "")
    ? dTag
    : null;
}

export function serializeReadContexts(contexts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(contexts).map(([contextId, timestamp]) => [
      contextId.startsWith("ov_") || contextId.startsWith("esc:") ? `esc:${contextId}` : contextId,
      timestamp,
    ]),
  );
}

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function isNewerCoordinateEvent(
  event: NostrEvent,
  current: { createdAt: number; id: string } | undefined,
): boolean {
  return (
    !current ||
    event.created_at > current.createdAt ||
    (event.created_at === current.createdAt && event.id.localeCompare(current.id) < 0)
  );
}

function readLocalState(key: string): LocalUserState {
  const fallback = defaultLocalState();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as Record<
      string,
      unknown
    > | null;
    if (parsed?.version !== 1) return fallback;
    return {
      version: 1,
      clientId:
        typeof parsed.clientId === "string" &&
        parsed.clientId.length > 0 &&
        parsed.clientId.length <= 64
          ? parsed.clientId
          : fallback.clientId,
      slotId:
        typeof parsed.slotId === "string" && /^[0-9a-f]{32}$/.test(parsed.slotId)
          ? parsed.slotId
          : fallback.slotId,
      stars: parsePreferenceStore(parsed.stars, "starred"),
      mutes: parsePreferenceStore(parsed.mutes, "muted"),
      contexts: sanitizeReadContexts(parsed.contexts, false),
    };
  } catch {
    return fallback;
  }
}

export function mergePreferenceStores(
  left: PreferenceStore,
  right: PreferenceStore,
): PreferenceStore {
  const result = { ...left };
  for (const [channelId, incoming] of Object.entries(right)) {
    const current = result[channelId];
    if (!current || incoming.updatedAt > current.updatedAt) result[channelId] = incoming;
  }
  return result;
}

export function mergeReadContexts(
  left: Record<string, number>,
  right: Record<string, number>,
): Record<string, number> {
  const result = { ...left };
  for (const [contextId, timestamp] of Object.entries(right)) {
    result[contextId] = Math.max(result[contextId] ?? 0, timestamp);
  }
  return compactReadContexts(result);
}

function preferencesPayload(store: PreferenceStore, field: "starred" | "muted") {
  return {
    version: 1,
    channels: Object.fromEntries(
      Object.entries(store).map(([channelId, entry]) => [
        channelId,
        { [field]: entry.enabled, updatedAt: entry.updatedAt },
      ]),
    ),
  };
}

export function useRelayUserState({
  client,
  demo,
  relayUrl,
  pubkey,
}: {
  client: BuzzRelayClient | null;
  demo: boolean;
  relayUrl: string;
  pubkey: string;
}) {
  const storageKey = useMemo(() => relayUserStateStorageKey(relayUrl, pubkey), [pubkey, relayUrl]);
  const initial = useMemo(() => readLocalState(storageKey), [storageKey]);
  const [stars, setStars] = useState(initial.stars);
  const [mutes, setMutes] = useState(initial.mutes);
  const [contexts, setContexts] = useState(initial.contexts);
  const [syncAvailable, setSyncAvailable] = useState(() => !demo && canEncryptToSelf());
  const [hydrated, setHydrated] = useState(() => demo || !canEncryptToSelf());
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const dirtyRef = useRef<DirtyState>({ stars: false, mutes: false, reads: false });
  const publishTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const initialRetryTimer = useRef<number | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const schedulePublishRef = useRef<(key: keyof DirtyState) => void>(() => undefined);
  const mountedRef = useRef(true);
  const latestRef = useRef({ stars, mutes, contexts });
  const lastCreatedAt = useRef<Record<string, number>>({});
  const lastCoordinateEvent = useRef<Record<string, { createdAt: number; id: string }>>({});
  const clientId = useRef(initial.clientId);
  const slotId = useRef(initial.slotId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      if (initialRetryTimer.current !== null) window.clearTimeout(initialRetryTimer.current);
    };
  }, []);

  useEffect(() => {
    latestRef.current = { stars, mutes, contexts };
    const value: LocalUserState = {
      version: 1,
      clientId: clientId.current,
      slotId: slotId.current,
      stars,
      mutes,
      contexts,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Local state remains available for this browser session.
    }
  }, [contexts, mutes, stars, storageKey]);

  const applyRemoteEvent = useCallback(
    async (event: NostrEvent) => {
      if (event.pubkey.toLowerCase() !== pubkey.toLowerCase()) return;
      const dTags = event.tags.filter((tag) => tag[0] === "d");
      const dTag = dTags[0]?.[1];
      if (dTags.length !== 1 || !dTag) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(await decryptNip44FromSelf(event.content)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!isNewerCoordinateEvent(event, lastCoordinateEvent.current[dTag])) return;
      const readState = readStateCoordinate(event) ? parseReadStatePayload(parsed) : null;
      if (
        !readState &&
        !(
          (dTag === STAR_D_TAG || dTag === MUTE_D_TAG) &&
          parsed.version === 1 &&
          parsed.channels &&
          typeof parsed.channels === "object" &&
          !Array.isArray(parsed.channels)
        )
      ) {
        return;
      }
      lastCoordinateEvent.current[dTag] = { createdAt: event.created_at, id: event.id };
      lastCreatedAt.current[dTag] = Math.max(lastCreatedAt.current[dTag] ?? 0, event.created_at);
      if (dTag === STAR_D_TAG && parsed.version === 1) {
        setStars((current) => {
          const next = mergePreferenceStores(
            current,
            parsePreferenceStore(parsed.channels, "starred"),
          );
          latestRef.current = { ...latestRef.current, stars: next };
          return next;
        });
      } else if (dTag === MUTE_D_TAG && parsed.version === 1) {
        setMutes((current) => {
          const next = mergePreferenceStores(
            current,
            parsePreferenceStore(parsed.channels, "muted"),
          );
          latestRef.current = { ...latestRef.current, mutes: next };
          return next;
        });
      } else if (readState) {
        const ownCoordinate = `${READ_D_TAG_PREFIX}${slotId.current}`;
        const slotChanged = dTag === ownCoordinate && readState.clientId !== clientId.current;
        if (slotChanged) {
          slotId.current = randomHex(16);
        }
        const current = latestRef.current.contexts;
        const next = mergeReadContexts(current, readState.contexts);
        const changed = !sameNumberRecord(current, next);
        latestRef.current = { ...latestRef.current, contexts: next };
        setContexts(slotChanged && !changed ? { ...next } : next);
        if (
          slotChanged ||
          (changed && (dTag !== ownCoordinate || readState.clientId !== clientId.current))
        ) {
          schedulePublishRef.current("reads");
        }
      }
    },
    [pubkey],
  );

  const publishOne = useCallback(
    async (dTag: string, topic: string, payload: unknown) => {
      if (!client) return;
      const content = await encryptNip44ToSelf(JSON.stringify(payload));
      const createdAt = Math.max(
        Math.floor(Date.now() / 1_000),
        (lastCreatedAt.current[dTag] ?? 0) + 1,
      );
      const result = await client.publish({
        kind: USER_STATE_KIND,
        content,
        created_at: createdAt,
        tags: [
          ["d", dTag],
          ["t", topic],
        ],
      });
      lastCreatedAt.current[dTag] = result.event.created_at;
      lastCoordinateEvent.current[dTag] = {
        createdAt: result.event.created_at,
        id: result.event.id,
      };
    },
    [client],
  );

  const fetchOwnReadCoordinate = useCallback(async () => {
    if (!client) return;
    const dTag = `${READ_D_TAG_PREFIX}${slotId.current}`;
    const events = await client.query({
      kinds: [USER_STATE_KIND],
      authors: [pubkey],
      "#d": [dTag],
      limit: 10,
    });
    for (const event of events.sort((left, right) => {
      if (left.created_at !== right.created_at) return left.created_at - right.created_at;
      return right.id.localeCompare(left.id);
    })) {
      await applyRemoteEvent(event);
    }
  }, [applyRemoteEvent, client, pubkey]);

  const fetchRemotePreference = useCallback(
    async (dTag: string, field: "starred" | "muted"): Promise<PreferenceStore> => {
      if (!client) return {};
      const events = await client.query({
        kinds: [USER_STATE_KIND],
        authors: [pubkey],
        "#d": [dTag],
        limit: 10,
      });
      const event = events
        .filter((candidate) => candidate.pubkey.toLowerCase() === pubkey.toLowerCase())
        .sort((left, right) => right.created_at - left.created_at)[0];
      if (!event) return {};
      try {
        const parsed = JSON.parse(await decryptNip44FromSelf(event.content)) as Record<
          string,
          unknown
        >;
        if (parsed.version !== 1) return {};
        lastCreatedAt.current[dTag] = Math.max(lastCreatedAt.current[dTag] ?? 0, event.created_at);
        return parsePreferenceStore(parsed.channels, field);
      } catch {
        return {};
      }
    },
    [client, pubkey],
  );

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current !== null || !mountedRef.current) return;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      void flushRef.current();
    }, RETRY_DELAY_MS);
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (!client || !syncAvailable) return Promise.resolve();
    if (flushPromiseRef.current) return flushPromiseRef.current;

    const operation = (async () => {
      while (Object.values(dirtyRef.current).some(Boolean)) {
        const dirty = dirtyRef.current;
        dirtyRef.current = { stars: false, mutes: false, reads: false };
        const current = latestRef.current;
        try {
          if (dirty.stars) {
            const merged = mergePreferenceStores(
              mergePreferenceStores(
                current.stars,
                await fetchRemotePreference(STAR_D_TAG, "starred"),
              ),
              latestRef.current.stars,
            );
            latestRef.current = { ...latestRef.current, stars: merged };
            setStars(merged);
            await publishOne(STAR_D_TAG, STAR_D_TAG, preferencesPayload(merged, "starred"));
          }
          if (dirty.mutes) {
            const merged = mergePreferenceStores(
              mergePreferenceStores(
                current.mutes,
                await fetchRemotePreference(MUTE_D_TAG, "muted"),
              ),
              latestRef.current.mutes,
            );
            latestRef.current = { ...latestRef.current, mutes: merged };
            setMutes(merged);
            await publishOne(MUTE_D_TAG, MUTE_D_TAG, preferencesPayload(merged, "muted"));
          }
          if (dirty.reads) {
            await fetchOwnReadCoordinate();
            const merged = mergeReadContexts(current.contexts, latestRef.current.contexts);
            latestRef.current = { ...latestRef.current, contexts: merged };
            setContexts(merged);
            await publishOne(`${READ_D_TAG_PREFIX}${slotId.current}`, "read-state", {
              v: 1,
              client_id: clientId.current,
              contexts: serializeReadContexts(merged),
            });
          }
        } catch (error) {
          dirtyRef.current = {
            stars: dirtyRef.current.stars || dirty.stars,
            mutes: dirtyRef.current.mutes || dirty.mutes,
            reads: dirtyRef.current.reads || dirty.reads,
          };
          if (mountedRef.current) {
            setSyncError(error instanceof Error ? error.message : t("error.userStateSync"));
            scheduleRetry();
          }
          return;
        }
      }
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
      if (mountedRef.current) setSyncError(null);
    })();
    flushPromiseRef.current = operation;
    void operation.finally(() => {
      if (flushPromiseRef.current === operation) flushPromiseRef.current = null;
    });
    return operation;
  }, [
    client,
    fetchOwnReadCoordinate,
    fetchRemotePreference,
    publishOne,
    scheduleRetry,
    syncAvailable,
  ]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedulePublish = useCallback(
    (key: keyof DirtyState) => {
      dirtyRef.current[key] = true;
      if (!syncAvailable) return;
      if (publishTimer.current !== null) window.clearTimeout(publishTimer.current);
      publishTimer.current = window.setTimeout(() => {
        publishTimer.current = null;
        void flush();
      }, PUBLISH_DELAY_MS);
    },
    [flush, syncAvailable],
  );

  useEffect(() => {
    schedulePublishRef.current = schedulePublish;
  }, [schedulePublish]);

  useEffect(() => {
    if (!client || demo) {
      setHydrated(true);
      return;
    }
    if (!canEncryptToSelf()) {
      setSyncAvailable(false);
      setHydrated(true);
      return;
    }
    setSyncAvailable(true);
    if (syncAttempt === 0) setHydrated(false);
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void Promise.all([
      client.query({
        kinds: [USER_STATE_KIND],
        authors: [pubkey],
        "#d": [STAR_D_TAG, MUTE_D_TAG],
        limit: 2,
      }),
      client.query({
        kinds: [USER_STATE_KIND],
        authors: [pubkey],
        "#t": ["read-state"],
        limit: 500,
      }),
    ])
      .then(async (events) => {
        for (const event of events.flat().sort((left, right) => {
          if (left.created_at !== right.created_at) return left.created_at - right.created_at;
          return right.id.localeCompare(left.id);
        })) {
          if (cancelled) return;
          await applyRemoteEvent(event);
        }
        if (!cancelled) {
          setHydrated(true);
          setSyncError(null);
        }
      })
      .then(async () => {
        if (cancelled) return;
        const stop = await client.subscribe(
          {
            kinds: [USER_STATE_KIND],
            authors: [pubkey],
            since: Math.floor(Date.now() / 1_000) - 2,
          },
          (event) => void applyRemoteEvent(event),
        );
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch((error) => {
        if (!cancelled) {
          setHydrated(true);
          setSyncError(error instanceof Error ? error.message : t("error.userStateSync"));
          if (initialRetryTimer.current === null) {
            initialRetryTimer.current = window.setTimeout(() => {
              initialRetryTimer.current = null;
              if (mountedRef.current) setSyncAttempt((attempt) => attempt + 1);
            }, RETRY_DELAY_MS);
          }
        }
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (publishTimer.current !== null) window.clearTimeout(publishTimer.current);
      publishTimer.current = null;
      void flush();
    };
  }, [applyRemoteEvent, client, demo, flush, pubkey, syncAttempt]);

  const setChannelStarred = useCallback(
    (channelId: string, enabled: boolean) => {
      const updatedAt = Math.max(
        Math.floor(Date.now() / 1_000),
        (latestRef.current.stars[channelId]?.updatedAt ?? 0) + 1,
      );
      const next = { ...latestRef.current.stars, [channelId]: { enabled, updatedAt } };
      latestRef.current = { ...latestRef.current, stars: next };
      setStars(next);
      schedulePublish("stars");
    },
    [schedulePublish],
  );
  const setChannelMuted = useCallback(
    (channelId: string, enabled: boolean) => {
      const updatedAt = Math.max(
        Math.floor(Date.now() / 1_000),
        (latestRef.current.mutes[channelId]?.updatedAt ?? 0) + 1,
      );
      const next = { ...latestRef.current.mutes, [channelId]: { enabled, updatedAt } };
      latestRef.current = { ...latestRef.current, mutes: next };
      setMutes(next);
      schedulePublish("mutes");
    },
    [schedulePublish],
  );
  const markContextRead = useCallback(
    (contextId: string, timestamp: number) => {
      if (!validTimestamp(timestamp)) return;
      if ((latestRef.current.contexts[contextId] ?? 0) >= timestamp) return;
      const next = compactReadContexts({ ...latestRef.current.contexts, [contextId]: timestamp });
      latestRef.current = { ...latestRef.current, contexts: next };
      setContexts(next);
      schedulePublish("reads");
    },
    [schedulePublish],
  );

  const starredChannelIds = useMemo(
    () =>
      new Set(
        Object.entries(stars)
          .filter(([, entry]) => entry.enabled)
          .map(([channelId]) => channelId),
      ),
    [stars],
  );
  const mutedChannelIds = useMemo(
    () =>
      new Set(
        Object.entries(mutes)
          .filter(([, entry]) => entry.enabled)
          .map(([channelId]) => channelId),
      ),
    [mutes],
  );

  return {
    starredChannelIds,
    mutedChannelIds,
    contexts,
    hydrated,
    syncAvailable,
    syncError,
    setChannelStarred,
    setChannelMuted,
    markContextRead,
    /** Publishes pending changes now (used before the workspace's client is disposed). */
    flush,
  };
}
