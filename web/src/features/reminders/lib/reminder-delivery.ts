import { dueSince, type Reminder } from "@/features/reminders/lib/reminder-codec";

type WatermarkStorage = Pick<Storage, "getItem" | "setItem">;

export function reminderWatermarkKey(relayUrl: string, pubkey: string): string {
  return [
    "buzz:web:reminders:watermark:v1",
    encodeURIComponent(relayUrl),
    pubkey.toLowerCase(),
  ].join(":");
}

/**
 * Pending reminders to announce now, advancing the persisted watermark to `now`.
 * The first run for a Relay + identity seeds the watermark to `now` instead of 0,
 * so history is never replayed; a reminder that came due while the app was
 * closed (after the last watermark) is announced exactly once on the next run.
 * The watermark never moves backwards, so a stale tab cannot re-announce.
 */
export function claimDueReminders(
  storage: WatermarkStorage,
  key: string,
  reminders: readonly Reminder[],
  now: number,
): Reminder[] {
  const stored = storage.getItem(key);
  const parsed = stored === null ? Number.NaN : Number(stored);
  if (!Number.isFinite(parsed)) {
    storage.setItem(key, String(now));
    return [];
  }
  if (now <= parsed) return [];
  storage.setItem(key, String(now));
  return dueSince(reminders, parsed, now).sort(
    (left, right) => (left.notBefore ?? 0) - (right.notBefore ?? 0),
  );
}

/** Serialize the claim across tabs of the same origin so only one tab announces. */
export async function claimDueRemindersExclusive(
  key: string,
  reminders: readonly Reminder[],
  now: number,
): Promise<Reminder[]> {
  if (!navigator.locks) return claimDueReminders(localStorage, key, reminders, now);
  return navigator.locks.request(key, () => claimDueReminders(localStorage, key, reminders, now));
}
