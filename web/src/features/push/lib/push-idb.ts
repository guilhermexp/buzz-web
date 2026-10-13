/**
 * IndexedDB shared with the service worker (web/public/sw.js reads the same
 * schema). The page writes one record per enrolled community origin with the
 * localized notification copy the worker shows; the worker appends a bounded
 * log of received pushes. Keep DB_NAME/version/store names in sync with sw.js.
 */

export const PUSH_DB_NAME = "buzz-push";
const PUSH_DB_VERSION = 1;
const ENROLLMENTS = "enrollments";
const RECEIVED = "received";

/** What the worker needs to present and route a push for one community. */
export type WorkerEnrollment = {
  /** NIP-PL descriptor origin carried in every push payload. */
  origin: string;
  relayUrl: string;
  pubkey: string;
  title: string;
  body: string;
};

/** One push the worker received and how it handled it. */
export type ReceivedPush = {
  receivedAt: number;
  origin: string | null;
  channel: string | null;
  event: string | null;
  kind: number | null;
  shown: boolean;
  url: string | null;
};

function openPushDb(): Promise<IDBDatabase> {
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

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openPushDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(name, mode);
      const request = run(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function putWorkerEnrollment(record: WorkerEnrollment): Promise<void> {
  await withStore(ENROLLMENTS, "readwrite", (store) => store.put(record));
}

export async function deleteWorkerEnrollment(origin: string): Promise<void> {
  await withStore(ENROLLMENTS, "readwrite", (store) => store.delete(origin));
}

export async function listWorkerEnrollments(): Promise<WorkerEnrollment[]> {
  return withStore<WorkerEnrollment[]>(ENROLLMENTS, "readonly", (store) => store.getAll());
}

export async function clearWorkerEnrollments(): Promise<void> {
  await withStore(ENROLLMENTS, "readwrite", (store) => store.clear());
}

export async function listReceivedPushes(): Promise<ReceivedPush[]> {
  return withStore<ReceivedPush[]>(RECEIVED, "readonly", (store) => store.getAll());
}
