const CACHE = "buzz-web-static-v1";

// Shared with web/src/features/push/lib/push-idb.ts — keep in sync.
const PUSH_DB_NAME = "buzz-push";
const PUSH_DB_VERSION = 1;
const ENROLLMENTS = "enrollments";
const RECEIVED = "received";
const RECEIVED_LIMIT = 50;
const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_ID = /^[0-9a-f]{64}$/;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.includes("/assets/")
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
});

function openPushDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME, PUSH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENROLLMENTS)) {
        db.createObjectStore(ENROLLMENTS, { keyPath: "origin" });
      }
      if (!db.objectStoreNames.contains(RECEIVED)) {
        db.createObjectStore(RECEIVED, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function findEnrollment(origin) {
  const db = await openPushDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(ENROLLMENTS, "readonly").objectStore(ENROLLMENTS).get(origin);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function recordReceived(entry) {
  const db = await openPushDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(RECEIVED, "readwrite");
      const store = transaction.objectStore(RECEIVED);
      store.add(entry);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const excess = keys.result.length - RECEIVED_LIMIT;
        for (const key of keys.result.slice(0, Math.max(0, excess))) store.delete(key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** The relay payload carries routing ids only: {v, origin, channel, event, kind}. */
function parsePayload(data) {
  if (!data) return null;
  try {
    const payload = data.json();
    if (payload?.v !== 1 || typeof payload.origin !== "string") return null;
    return {
      origin: payload.origin,
      channel:
        typeof payload.channel === "string" && CHANNEL_ID.test(payload.channel)
          ? payload.channel
          : null,
      event:
        typeof payload.event === "string" && EVENT_ID.test(payload.event) ? payload.event : null,
      kind: Number.isInteger(payload.kind) ? payload.kind : null,
    };
  } catch {
    return null;
  }
}

function deepLink(enrollment, payload) {
  const url = new URL(self.registration.scope);
  url.searchParams.set("community", enrollment.relayUrl);
  if (payload.channel) url.searchParams.set("channel", payload.channel);
  if (payload.event) url.searchParams.set("event", payload.event);
  return url.toString();
}

async function handlePush(data) {
  const payload = parsePayload(data);
  const enrollment = payload ? await findEnrollment(payload.origin) : null;
  const entry = {
    receivedAt: Date.now(),
    origin: payload?.origin ?? null,
    channel: payload?.channel ?? null,
    event: payload?.event ?? null,
    kind: payload?.kind ?? null,
    shown: false,
    url: null,
  };
  // Pushes for communities this profile no longer enrolls (retired between
  // send and receipt) are recorded but never presented.
  if (payload && enrollment) {
    entry.url = deepLink(enrollment, payload);
    const options = { body: enrollment.body, data: { url: entry.url } };
    if (payload.event) options.tag = `buzz-push-${payload.event}`;
    try {
      await self.registration.showNotification(enrollment.title, options);
      entry.shown = true;
    } catch (error) {
      entry.error = String(error);
    }
  }
  await recordReceived(entry);
  if (entry.error) throw new Error(entry.error);
}
self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event.data));
});

async function openFromNotification(url) {
  const scope = self.registration.scope;
  const target = typeof url === "string" && url.startsWith(scope) ? url : scope;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => client.url.startsWith(scope));
  if (existing) {
    // The open app resolves the link itself after re-checking access.
    existing.postMessage({ type: "buzz-push-open", url: target });
    await existing.focus();
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event.notification.data?.url));
});
