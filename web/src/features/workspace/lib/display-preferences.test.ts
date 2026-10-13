import { describe, expect, it } from "vitest";
import {
  applyDisplayPreferences,
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_KEY,
  parseDisplayPreferences,
  readDisplayPreferences,
  writeDisplayPreferences,
} from "@/features/workspace/lib/display-preferences";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("display preferences", () => {
  it("restores each preference independently after a reload", () => {
    const storage = new MemoryStorage();
    writeDisplayPreferences(
      { fontSize: "larger", density: "compact", threadLayout: "focus" },
      storage,
    );
    expect(readDisplayPreferences(storage)).toEqual({
      fontSize: "larger",
      density: "compact",
      threadLayout: "focus",
    });
    writeDisplayPreferences({ ...readDisplayPreferences(storage), fontSize: "smaller" }, storage);
    expect(readDisplayPreferences(storage)).toEqual({
      fontSize: "smaller",
      density: "compact",
      threadLayout: "focus",
    });
  });

  it("falls back per field for corrupt or unknown stored values", () => {
    expect(parseDisplayPreferences("{not json")).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(parseDisplayPreferences('["larger"]')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(
      parseDisplayPreferences(
        JSON.stringify({ fontSize: "huge", density: "spacious", threadLayout: 1 }),
      ),
    ).toEqual({ fontSize: "default", density: "spacious", threadLayout: "split" });
  });

  it("uses one versioned browser key shared by every community and identity", () => {
    const storage = new MemoryStorage();
    writeDisplayPreferences({ ...DEFAULT_DISPLAY_PREFERENCES, density: "spacious" }, storage);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(DISPLAY_PREFERENCES_KEY);
    expect(DISPLAY_PREFERENCES_KEY).toMatch(/^buzz:web:display-preferences:v\d+$/);
  });

  it("applies preferences as root attributes consumed by the CSS scale", () => {
    const root = { dataset: {} as DOMStringMap } as HTMLElement;
    applyDisplayPreferences(
      { fontSize: "smaller", density: "compact", threadLayout: "focus" },
      root,
    );
    expect(root.dataset).toEqual({ fontSize: "smaller", conversationDensity: "compact" });
  });
});
