import { describe, expect, it } from "vitest";
import {
  countDue,
  dueSince,
  groupReminders,
  hasNavigableTarget,
  nextCreatedAt,
  nextDueAt,
  parseNotBefore,
  parseReminderContent,
  type Reminder,
  randomReminderId,
  reminderFromEvent,
  reminderPreview,
  reminderTags,
  serializeReminderContent,
  supersedes,
  terminalExpiration,
} from "@/features/reminders/lib/reminder-codec";
import type { NostrEvent } from "@/shared/api/nostr-types";

const OWNER = "a".repeat(64);
const TARGET = {
  eventId: "b".repeat(64),
  channelId: "11111111-1111-4111-8111-111111111111",
  preview: "ship the release notes",
  authorPubkey: "c".repeat(64),
};

function event(tags: string[][], overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "e".repeat(64),
    pubkey: OWNER,
    kind: 30300,
    created_at: 1_000,
    content: "ciphertext",
    tags,
    sig: "f".repeat(128),
    ...overrides,
  };
}

function reminder(
  id: string,
  status: Reminder["content"]["status"],
  notBefore?: number,
  createdAt = 1,
): Reminder {
  return {
    id,
    ...(notBefore !== undefined ? { notBefore } : {}),
    content: { status, target: TARGET },
    createdAt,
    eventId: id.padEnd(64, "0"),
  };
}

describe("not_before parsing mirrors the Relay validator", () => {
  it("rejects leading zeros, signs, decimals and values above 2^53-1", () => {
    expect(parseNotBefore("0")).toBe(0);
    expect(parseNotBefore("1717000000")).toBe(1_717_000_000);
    expect(parseNotBefore("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    for (const raw of ["007", "", "-1", "+5", "1.5", "1e9", " 12", "9007199254740992"]) {
      expect(parseNotBefore(raw)).toBeUndefined();
    }
  });
});

describe("reminder tags", () => {
  it("pending carries not_before and no expiration; terminal carries expiration 30–90 days out", () => {
    const pending = reminderTags("abc", { status: "pending", notBefore: 2_000.9 }, 1_000);
    expect(pending).toEqual([
      ["d", "abc"],
      ["not_before", "2000"],
      ["alt", "Encrypted reminder"],
    ]);
    for (const random of [0, 0.5, 0.999999]) {
      const done = reminderTags("abc", { status: "done" }, 1_000, random);
      expect(done.find((tag) => tag[0] === "not_before")).toBeUndefined();
      const expiration = Number(done.find((tag) => tag[0] === "expiration")?.[1]);
      expect(expiration - 1_000).toBeGreaterThanOrEqual(30 * 86_400);
      expect(expiration - 1_000).toBeLessThanOrEqual(90 * 86_400);
    }
    expect(terminalExpiration(0, 1)).toBeLessThanOrEqual(90 * 86_400);
  });

  it("d tags carry 128 random bits as lowercase hex", () => {
    const ids = new Set(Array.from({ length: 50 }, randomReminderId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("replacements are strictly newer than the version they supersede", () => {
    expect(nextCreatedAt(1_000, 900)).toBe(1_001);
    expect(nextCreatedAt(1_000, 1_000)).toBe(1_001);
    expect(nextCreatedAt(1_000, 2_000)).toBe(2_000);
  });
});

describe("decrypted content", () => {
  it("round-trips Desktop's shape", () => {
    const content = { target: TARGET, note: "follow up", status: "pending" as const };
    expect(parseReminderContent(serializeReminderContent(content))).toEqual(content);
  });

  it("tolerates a NIP-ER target id and missing optional target fields, as non-navigable", () => {
    const parsed = parseReminderContent(
      JSON.stringify({ target: { id: TARGET.eventId, relays: [] }, status: "done" }),
    );
    expect(parsed?.target).toEqual({
      eventId: TARGET.eventId,
      channelId: "",
      preview: "",
      authorPubkey: "",
    });
    expect(hasNavigableTarget(parsed?.target)).toBe(false);
    expect(hasNavigableTarget(TARGET)).toBe(true);
  });

  it("fails closed on malformed plaintext", () => {
    for (const plaintext of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ status: "snoozed", note: "x" }),
      JSON.stringify({ status: "pending" }),
      JSON.stringify({ status: "pending", note: "" }),
      JSON.stringify({ status: "pending", note: 4 }),
      JSON.stringify({ status: "pending", target: "evt" }),
      JSON.stringify({ status: "pending", target: { eventId: 1 } }),
      JSON.stringify({ status: "pending", target: { ...TARGET, preview: 7 } }),
    ]) {
      expect(parseReminderContent(plaintext)).toBeNull();
    }
    expect(parseReminderContent(JSON.stringify({ status: "pending", note: "call" }))).toEqual({
      status: "pending",
      note: "call",
    });
  });
});

describe("events → reminders", () => {
  const plaintext = serializeReminderContent({ target: TARGET, status: "pending" });

  it("reads d and not_before from an owned reminder", () => {
    const parsed = reminderFromEvent(
      event([
        ["d", "r1"],
        ["not_before", "1500"],
      ]),
      plaintext,
      OWNER.toUpperCase(),
    );
    expect(parsed).toMatchObject({ id: "r1", notBefore: 1_500, createdAt: 1_000 });
  });

  it("ignores foreign, malformed or ambiguous events", () => {
    const valid = [
      ["d", "r1"],
      ["not_before", "1500"],
    ];
    expect(
      reminderFromEvent(event(valid, { pubkey: "d".repeat(64) }), plaintext, OWNER),
    ).toBeNull();
    expect(reminderFromEvent(event(valid, { kind: 30078 }), plaintext, OWNER)).toBeNull();
    expect(reminderFromEvent(event([["not_before", "1500"]]), plaintext, OWNER)).toBeNull();
    expect(reminderFromEvent(event([["d", ""]]), plaintext, OWNER)).toBeNull();
    expect(
      reminderFromEvent(
        event([
          ["d", "a"],
          ["d", "b"],
        ]),
        plaintext,
        OWNER,
      ),
    ).toBeNull();
    expect(
      reminderFromEvent(
        event([
          ["d", "r1"],
          ["not_before", "01500"],
        ]),
        plaintext,
        OWNER,
      ),
    ).toBeNull();
    expect(
      reminderFromEvent(
        event([
          ["d", "r1"],
          ["not_before", "1"],
          ["not_before", "2"],
        ]),
        plaintext,
        OWNER,
      ),
    ).toBeNull();
  });

  it("keeps the newest version per d, breaking created_at ties by the lower id", () => {
    const current = reminder("r1", "pending", 5, 10);
    expect(supersedes({ ...current, createdAt: 9 }, current)).toBe(false);
    expect(supersedes({ ...current, createdAt: 11 }, current)).toBe(true);
    expect(supersedes({ ...current, eventId: "0".repeat(64) }, current)).toBe(true);
    expect(supersedes({ ...current, eventId: "z".repeat(64) }, current)).toBe(false);
    expect(supersedes(current, undefined)).toBe(true);
  });
});

describe("due computation", () => {
  const reminders = [
    reminder("past", "pending", 90),
    reminder("now", "pending", 100),
    reminder("soon", "pending", 130),
    reminder("later", "pending", 500),
    reminder("done", "done", undefined, 50),
    reminder("cancelled", "cancelled", undefined, 60),
  ];

  it("announces only reminders crossing not_before after the watermark", () => {
    expect(dueSince(reminders, 95, 100).map((item) => item.id)).toEqual(["now"]);
    expect(dueSince(reminders, 100, 100)).toEqual([]);
    expect(dueSince(reminders, 0, 1_000).map((item) => item.id)).toEqual([
      "past",
      "now",
      "soon",
      "later",
    ]);
  });

  it("badge count includes only pending reminders at or past not_before", () => {
    expect(countDue(reminders, 89)).toBe(0);
    expect(countDue(reminders, 100)).toBe(2);
    expect(countDue(reminders, 10_000)).toBe(4);
  });

  it("schedules the earliest future pending not_before", () => {
    expect(nextDueAt(reminders, 100)).toBe(130);
    expect(nextDueAt(reminders, 600)).toBeNull();
  });

  it("groups due, upcoming and completed; cancelled is hidden", () => {
    const groups = groupReminders(reminders, 100);
    expect(groups.due.map((item) => item.id)).toEqual(["past", "now"]);
    expect(groups.upcoming.map((item) => item.id)).toEqual(["soon", "later"]);
    expect(groups.completed.map((item) => item.id)).toEqual(["done"]);
  });
});

describe("preview excerpt", () => {
  it("strips markdown, collapses whitespace and bounds length by characters", () => {
    expect(reminderPreview("**Ship** the [notes](https://example.com)\n\n`now`")).toBe(
      "Ship the notes now",
    );
    const long = reminderPreview("🙂".repeat(200));
    expect(Array.from(long)).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });
});
