import { describe, expect, it } from "vitest";
import type { Reminder } from "@/features/reminders/lib/reminder-codec";
import {
  claimDueReminders,
  reminderWatermarkKey,
} from "@/features/reminders/lib/reminder-delivery";
import { parseCustomDateTime, presetTimestamp } from "@/features/reminders/lib/reminder-time";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function pending(id: string, notBefore: number): Reminder {
  return {
    id,
    notBefore,
    content: { status: "pending", note: id },
    createdAt: 1,
    eventId: id.padEnd(64, "0"),
  };
}

describe("presets", () => {
  // Wednesday 2026-10-14 10:30 local
  const wednesday = new Date(2026, 9, 14, 10, 30, 0);
  const seconds = (date: Date) => Math.floor(date.getTime() / 1_000);

  it("relative presets add whole durations", () => {
    expect(presetTimestamp("in30Minutes", wednesday) - seconds(wednesday)).toBe(1_800);
    expect(presetTimestamp("in3Hours", wednesday) - seconds(wednesday)).toBe(10_800);
  });

  it("tomorrow and next Monday land at 09:00 local and are always in the future", () => {
    expect(presetTimestamp("tomorrow9", wednesday)).toBe(seconds(new Date(2026, 9, 15, 9)));
    expect(presetTimestamp("nextMonday9", wednesday)).toBe(seconds(new Date(2026, 9, 19, 9)));
    // On a Monday before 9am, "next Monday" is still a week out, never today.
    const mondayEarly = new Date(2026, 9, 19, 7, 0);
    expect(presetTimestamp("nextMonday9", mondayEarly)).toBe(seconds(new Date(2026, 9, 26, 9)));
  });
});

describe("custom date-time", () => {
  const now = new Date(2026, 9, 14, 10, 30, 15);

  it("accepts only well-formed local times strictly in the future", () => {
    expect(parseCustomDateTime("2026-10-14", "10:31", now)).toBe(
      Math.floor(new Date(2026, 9, 14, 10, 31).getTime() / 1_000),
    );
    expect(parseCustomDateTime("2026-10-14", "10:30", now)).toBeNull();
    expect(parseCustomDateTime("2026-10-14", "10:30:15", now)).toBeNull();
    expect(parseCustomDateTime("2026-10-14", "", now)).toBeNull();
    expect(parseCustomDateTime("14/10/2026", "11:00", now)).toBeNull();
    expect(parseCustomDateTime("2026-13-40", "11:00", now)).toBeNull();
  });
});

describe("due announcement watermark", () => {
  const key = reminderWatermarkKey("wss://relay.example.com", "A".repeat(64));

  it("is scoped by relay and identity", () => {
    expect(key).toBe(
      `buzz:web:reminders:watermark:v1:wss%3A%2F%2Frelay.example.com:${"a".repeat(64)}`,
    );
    expect(reminderWatermarkKey("wss://other.example.com", "a".repeat(64))).not.toBe(key);
  });

  it("seeds on first run without replaying history", () => {
    const storage = new MemoryStorage();
    expect(claimDueReminders(storage, key, [pending("old", 50)], 100)).toEqual([]);
    expect(storage.getItem(key)).toBe("100");
  });

  it("announces each reminder once, including ones that came due while closed", () => {
    const storage = new MemoryStorage();
    storage.setItem(key, "100");
    const reminders = [pending("b", 150), pending("a", 120), pending("future", 400)];
    expect(claimDueReminders(storage, key, reminders, 200).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    // A reload (same storage) or a second tab does not announce them again.
    expect(claimDueReminders(storage, key, reminders, 200)).toEqual([]);
    expect(claimDueReminders(storage, key, reminders, 300)).toEqual([]);
    expect(claimDueReminders(storage, key, reminders, 400).map((item) => item.id)).toEqual([
      "future",
    ]);
  });

  it("never moves backwards when a tab's clock lags", () => {
    const storage = new MemoryStorage();
    storage.setItem(key, "500");
    expect(claimDueReminders(storage, key, [pending("x", 450)], 480)).toEqual([]);
    expect(storage.getItem(key)).toBe("500");
  });

  it("a snoozed reminder announces again at its new time", () => {
    const storage = new MemoryStorage();
    storage.setItem(key, "100");
    expect(claimDueReminders(storage, key, [pending("r", 110)], 120)).toHaveLength(1);
    expect(claimDueReminders(storage, key, [pending("r", 200)], 210)).toHaveLength(1);
  });
});
