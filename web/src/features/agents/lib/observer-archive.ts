import { isRecord } from "@/features/agents/lib/guards";
import type { ObserverFrame } from "@/features/chat/lib/agent-activity";

/**
 * Browser-local archive of kind 24200 observer frames. The relay never stores these frames, so
 * this is strictly what this browser received live while signed in — scoped by relay + owner.
 */
const DB_NAME = "buzz-agent-observer-archive";
const DB_VERSION = 1;
const FRAMES = "frames";
const BY_SCOPE_TIME = "scope_received";
export const DEFAULT_RETENTION_DAYS = 30;
export const RETENTION_CHOICES = [1, 7, 30, 90, 365] as const;
const DAY_MS = 86_400_000;
const MAX_FRAMES_PER_READ = 5_000;

export type ArchivedFrame = {
  id: string;
  scope: string;
  agentPubkey: string;
  channelId: string;
  frame: ObserverFrame;
  receivedAt: number;
};

const listeners = new Map<string, Set<() => void>>();
let database: Promise<IDBDatabase> | null = null;

export function archiveScope(relayUrl: string, ownerPubkey: string): string {
  return `${relayUrl}|${ownerPubkey.toLowerCase()}`;
}

function retentionKey(scope: string): string {
  return `buzz.agents.observer-retention:${scope}`;
}

export function readRetentionDays(scope: string): number {
  const value = Number(globalThis.localStorage?.getItem(retentionKey(scope)));
  return RETENTION_CHOICES.find((choice) => choice === value) ?? DEFAULT_RETENTION_DAYS;
}

export function writeRetentionDays(scope: string, days: number): void {
  globalThis.localStorage?.setItem(retentionKey(scope), String(days));
}

export function retentionCutoff(days: number, now = Date.now()): number {
  return now - days * DAY_MS;
}

export function archiveAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(FRAMES, { keyPath: "id" });
      store.createIndex(BY_SCOPE_TIME, ["scope", "receivedAt"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error(DB_NAME));
    };
  });
  return database;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function notify(scope: string): void {
  for (const listener of listeners.get(scope) ?? []) listener();
}

export function subscribeArchive(scope: string, listener: () => void): () => void {
  const set = listeners.get(scope) ?? new Set();
  set.add(listener);
  listeners.set(scope, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(scope);
  };
}

export async function appendFrames(
  scope: string,
  frames: ReadonlyArray<Omit<ArchivedFrame, "id" | "scope">>,
): Promise<void> {
  if (!frames.length || !archiveAvailable()) return;
  const db = await open();
  const transaction = db.transaction(FRAMES, "readwrite");
  const store = transaction.objectStore(FRAMES);
  for (const record of frames) {
    store.put({
      ...record,
      scope,
      id: `${scope}|${record.agentPubkey}|${record.frame.seq}|${record.frame.timestamp}`,
    } satisfies ArchivedFrame);
  }
  await done(transaction);
  notify(scope);
}

function scopeRange(scope: string, since: number): IDBKeyRange {
  return IDBKeyRange.bound([scope, since], [scope, Number.MAX_SAFE_INTEGER]);
}

function parseArchived(value: unknown): ArchivedFrame | null {
  if (!isRecord(value) || !isRecord(value.frame)) return null;
  if (typeof value.agentPubkey !== "string" || typeof value.channelId !== "string") return null;
  if (typeof value.receivedAt !== "number" || typeof value.id !== "string") return null;
  return value as ArchivedFrame;
}

/** Newest frames within retention for one scope, oldest first. */
export async function readFrames(scope: string, retentionDays: number): Promise<ArchivedFrame[]> {
  if (!archiveAvailable()) return [];
  const db = await open();
  const transaction = db.transaction(FRAMES, "readonly");
  const index = transaction.objectStore(FRAMES).index(BY_SCOPE_TIME);
  const frames: ArchivedFrame[] = [];
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(scopeRange(scope, retentionCutoff(retentionDays)), "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || frames.length >= MAX_FRAMES_PER_READ) {
        resolve();
        return;
      }
      const frame = parseArchived(cursor.value);
      if (frame) frames.push(frame);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  return frames.reverse();
}

/** Delete frames older than retention, or (with `keep`) any frame `keep` rejects. */
export async function pruneFrames(
  scope: string,
  retentionDays: number,
  keep?: (frame: ArchivedFrame) => boolean,
): Promise<number> {
  if (!archiveAvailable()) return 0;
  const db = await open();
  const transaction = db.transaction(FRAMES, "readwrite");
  const index = transaction.objectStore(FRAMES).index(BY_SCOPE_TIME);
  const cutoff = retentionCutoff(retentionDays);
  let removed = 0;
  const request = index.openCursor(scopeRange(scope, 0));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const frame = parseArchived(cursor.value);
    if (!frame || frame.receivedAt < cutoff || (keep && !keep(frame))) {
      cursor.delete();
      removed += 1;
    }
    cursor.continue();
  };
  await done(transaction);
  if (removed) notify(scope);
  return removed;
}

export async function clearArchive(scope: string): Promise<void> {
  await pruneFrames(scope, 0, () => false);
}
