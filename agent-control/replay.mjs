import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { HttpError } from "./lib.mjs";

const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Durable NIP-98 replay cache: event id → unix second after which the event is stale anyway.
 * Every accepted id is written (temp file + fsync + rename) before the request proceeds, so a
 * restart cannot reopen the freshness window. Unreadable or malformed state throws (fail closed:
 * the service refuses to start); a failed write or a full cache rejects the request.
 */
export class ReplayStore {
  constructor(path, { maxEntries = 100_000, now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.path = path;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw new Error(`replay cache ${path} is unreadable: ${error.code ?? error.message}`);
    }
    let document;
    try {
      document = JSON.parse(text);
    } catch {
      throw new Error(`replay cache ${path} is not valid JSON`);
    }
    if (!document || document.version !== 1 || !Array.isArray(document.entries)) {
      throw new Error(`replay cache ${path} has an unknown format`);
    }
    for (const entry of document.entries) {
      if (
        !Array.isArray(entry) ||
        !EVENT_ID_PATTERN.test(entry[0]) ||
        !Number.isSafeInteger(entry[1])
      ) {
        throw new Error(`replay cache ${path} contains a malformed entry`);
      }
      this.entries.set(entry[0], entry[1]);
    }
    this.prune();
  }

  get size() {
    return this.entries.size;
  }

  has(eventId) {
    return this.entries.has(eventId);
  }

  /** Remember `eventId` until `expiresAt`; resolves only once the entry is durable. */
  set(eventId, expiresAt) {
    this.prune();
    if (this.entries.size >= this.maxEntries) {
      throw new HttpError(503, "replay_capacity", "Too many recent authorizations; retry shortly");
    }
    this.entries.set(eventId, expiresAt);
    try {
      this.persist();
    } catch {
      this.entries.delete(eventId);
      throw new HttpError(503, "replay_store_unavailable", "Replay protection is unavailable");
    }
    return this;
  }

  /** Drop ids whose events are past the freshness window (they would be rejected as expired). */
  prune() {
    const now = this.now();
    for (const [eventId, expiresAt] of this.entries) {
      if (expiresAt < now) this.entries.delete(eventId);
    }
  }

  persist() {
    const temp = `${this.path}.${process.pid}.tmp`;
    const body = JSON.stringify({ version: 1, entries: [...this.entries] });
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.path);
  }
}
