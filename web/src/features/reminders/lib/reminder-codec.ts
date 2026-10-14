import type { NostrEvent } from "@/shared/api/nostr-types";

/** NIP-ER event reminder: parameterized-replaceable, author-only on the Relay. */
export const KIND_EVENT_REMINDER = 30300;
export const REMINDER_ALT = "Encrypted reminder";
export const PREVIEW_MAX_LENGTH = 140;

export type ReminderStatus = "pending" | "done" | "cancelled";

/** Buzz Desktop's target shape (not NIP-ER's `{id, a, relays}`); kept for cross-client parity. */
export type ReminderTarget = {
  eventId: string;
  channelId: string;
  preview: string;
  authorPubkey: string;
};

export type ReminderContent = {
  target?: ReminderTarget;
  note?: string;
  status: ReminderStatus;
};

export type Reminder = {
  /** The `d` tag: stable identity of the reminder across snooze/complete/cancel. */
  id: string;
  /** Unix seconds; absent for terminal states. */
  notBefore?: number;
  content: ReminderContent;
  createdAt: number;
  eventId: string;
};

export type ReminderTransition =
  | { status: "pending"; notBefore: number }
  | { status: "done" | "cancelled" };

const DAY_SECONDS = 86_400;
const HEX_ID = /^[0-9a-f]{64}$/;

/** 128 random bits (NIP-ER MUST); UUIDv4 would only carry 122. */
export function randomReminderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Mirrors the Relay's validator: ASCII digits, no leading zero, ≤ 2^53-1. */
export function parseNotBefore(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

/** Terminal states expire 30–90 days out so the Relay can reap them. */
export function terminalExpiration(nowSeconds: number, random: number = Math.random()): number {
  const days = 30 + Math.min(59, Math.floor(random * 60));
  return nowSeconds + days * DAY_SECONDS;
}

/** A replacement must be strictly newer than the version it supersedes. */
export function nextCreatedAt(previousCreatedAt: number, nowSeconds: number): number {
  return Math.max(nowSeconds, previousCreatedAt + 1);
}

export function reminderTags(
  id: string,
  transition: ReminderTransition,
  nowSeconds: number,
  random?: number,
): string[][] {
  const tags = [["d", id]];
  if (transition.status === "pending") {
    tags.push(["not_before", String(Math.floor(transition.notBefore))]);
  } else {
    tags.push(["expiration", String(terminalExpiration(nowSeconds, random))]);
  }
  tags.push(["alt", REMINDER_ALT]);
  return tags;
}

type RawTarget = Partial<
  Record<"eventId" | "id" | "channelId" | "preview" | "authorPubkey", unknown>
>;
type RawContent = Partial<Record<"status" | "note" | "target", unknown>>;

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : null;
}

/**
 * Accept Desktop's `{eventId, channelId, preview, authorPubkey}` and tolerate a
 * NIP-ER `{id, preview}` target (no channel → not navigable). Anything else fails.
 */
function parseTarget(value: unknown): ReminderTarget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as RawTarget;
  const eventId = typeof raw.eventId === "string" ? raw.eventId : raw.id;
  if (typeof eventId !== "string") return null;
  const channelId = optionalString(raw.channelId);
  const preview = optionalString(raw.preview);
  const authorPubkey = optionalString(raw.authorPubkey);
  if (channelId === null || preview === null || authorPubkey === null) return null;
  return { eventId, channelId, preview, authorPubkey };
}

/** Fail closed on any plaintext that is not a well-formed reminder (NIP-ER content rules). */
export function parseReminderContent(plaintext: string): ReminderContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as RawContent;
  const status = raw.status;
  if (status !== "pending" && status !== "done" && status !== "cancelled") return null;
  if (raw.note !== undefined && typeof raw.note !== "string") return null;
  let target: ReminderTarget | undefined;
  if (raw.target !== undefined) {
    const parsedTarget = parseTarget(raw.target);
    if (!parsedTarget) return null;
    target = parsedTarget;
  }
  const note = typeof raw.note === "string" && raw.note.length ? raw.note : undefined;
  if (!target && !note) return null;
  return { status, ...(target ? { target } : {}), ...(note ? { note } : {}) };
}

export function serializeReminderContent(content: ReminderContent): string {
  return JSON.stringify({
    ...(content.target ? { target: content.target } : {}),
    ...(content.note ? { note: content.note } : {}),
    status: content.status,
  });
}

/** Exactly one non-empty `d`; returns null otherwise (the Relay rejects those too). */
export function reminderIdFromEvent(event: NostrEvent): string | null {
  const values = event.tags.filter((tag) => tag[0] === "d").map((tag) => tag[1]);
  return values.length === 1 && values[0] ? values[0] : null;
}

export function reminderFromEvent(
  event: NostrEvent,
  plaintext: string,
  ownerPubkey: string,
): Reminder | null {
  if (event.kind !== KIND_EVENT_REMINDER) return null;
  if (event.pubkey.toLowerCase() !== ownerPubkey.toLowerCase()) return null;
  const id = reminderIdFromEvent(event);
  if (!id) return null;
  const content = parseReminderContent(plaintext);
  if (!content) return null;
  const notBeforeTags = event.tags.filter((tag) => tag[0] === "not_before");
  if (notBeforeTags.length > 1) return null;
  const notBefore = parseNotBefore(notBeforeTags[0]?.[1]);
  if (notBeforeTags.length === 1 && notBefore === undefined) return null;
  return {
    id,
    ...(notBefore !== undefined ? { notBefore } : {}),
    content,
    createdAt: event.created_at,
    eventId: event.id,
  };
}

/** Replaceable-event precedence: newer `created_at`, then the lower event id (NIP-01). */
export function supersedes(incoming: Reminder, current: Reminder | undefined): boolean {
  if (!current) return true;
  if (incoming.createdAt !== current.createdAt) return incoming.createdAt > current.createdAt;
  return incoming.eventId < current.eventId;
}

export function isDue(reminder: Reminder, nowSeconds: number): boolean {
  return (
    reminder.content.status === "pending" &&
    reminder.notBefore !== undefined &&
    reminder.notBefore <= nowSeconds
  );
}

export function countDue(reminders: readonly Reminder[], nowSeconds: number): number {
  let count = 0;
  for (const reminder of reminders) if (isDue(reminder, nowSeconds)) count += 1;
  return count;
}

/**
 * Pending reminders that crossed `notBefore` after the watermark. The strict lower
 * bound means a reminder already due when the watermark was seeded never toasts.
 */
export function dueSince(
  reminders: readonly Reminder[],
  watermark: number,
  nowSeconds: number,
): Reminder[] {
  return reminders.filter(
    (reminder) =>
      reminder.content.status === "pending" &&
      reminder.notBefore !== undefined &&
      reminder.notBefore > watermark &&
      reminder.notBefore <= nowSeconds,
  );
}

/** Earliest future `notBefore`, for scheduling the next local due check. */
export function nextDueAt(reminders: readonly Reminder[], nowSeconds: number): number | null {
  let next: number | null = null;
  for (const reminder of reminders) {
    if (reminder.content.status !== "pending" || reminder.notBefore === undefined) continue;
    if (reminder.notBefore <= nowSeconds) continue;
    if (next === null || reminder.notBefore < next) next = reminder.notBefore;
  }
  return next;
}

export type ReminderGroups = { due: Reminder[]; upcoming: Reminder[]; completed: Reminder[] };

/** Due (oldest first), upcoming (soonest first), completed (newest first); cancelled hidden. */
export function groupReminders(reminders: readonly Reminder[], nowSeconds: number): ReminderGroups {
  const groups: ReminderGroups = { due: [], upcoming: [], completed: [] };
  for (const reminder of reminders) {
    if (reminder.content.status === "done") groups.completed.push(reminder);
    else if (reminder.content.status !== "pending" || reminder.notBefore === undefined) continue;
    else if (reminder.notBefore <= nowSeconds) groups.due.push(reminder);
    else groups.upcoming.push(reminder);
  }
  const byNotBefore = (left: Reminder, right: Reminder) =>
    (left.notBefore ?? 0) - (right.notBefore ?? 0);
  groups.due.sort(byNotBefore);
  groups.upcoming.sort(byNotBefore);
  groups.completed.sort((left, right) => right.createdAt - left.createdAt);
  return groups;
}

/** A target can be opened only with a channel, event id and author (Desktop rule). */
export function hasNavigableTarget(target: ReminderTarget | undefined): target is ReminderTarget {
  return Boolean(
    target?.channelId && target.authorPubkey && HEX_ID.test(target.eventId.toLowerCase()),
  );
}

/** Plain-text excerpt of a message for the reminder preview. */
export function reminderPreview(content: string, maxLength = PREVIEW_MAX_LENGTH): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, " "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  if (characters.length <= maxLength) return plain;
  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}
