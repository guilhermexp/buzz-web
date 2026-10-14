import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const FONT_SIZES = ["smaller", "default", "larger"] as const;
export const CONVERSATION_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const THREAD_LAYOUTS = ["split", "focus"] as const;

export type FontSizePreference = (typeof FONT_SIZES)[number];
export type ConversationDensity = (typeof CONVERSATION_DENSITIES)[number];
export type ThreadLayout = (typeof THREAD_LAYOUTS)[number];

export type DisplayPreferences = {
  fontSize: FontSizePreference;
  density: ConversationDensity;
  threadLayout: ThreadLayout;
};

/**
 * Device-wide readability preferences, matching Buzz Desktop (which also keeps
 * them per device, not per community). They contain no Relay or identity data,
 * so one browser-scoped, versioned key is used rather than a Relay+pubkey key.
 */
export const DISPLAY_PREFERENCES_KEY = "buzz:web:display-preferences:v1";

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  fontSize: "default",
  density: "comfortable",
  threadLayout: "split",
};

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseDisplayPreferences(raw: string | null): DisplayPreferences {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw ?? "null") as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // Corrupt values fall back to defaults.
  }
  return {
    fontSize: pick(FONT_SIZES, parsed.fontSize, DEFAULT_DISPLAY_PREFERENCES.fontSize),
    density: pick(CONVERSATION_DENSITIES, parsed.density, DEFAULT_DISPLAY_PREFERENCES.density),
    threadLayout: pick(
      THREAD_LAYOUTS,
      parsed.threadLayout,
      DEFAULT_DISPLAY_PREFERENCES.threadLayout,
    ),
  };
}

export function readDisplayPreferences(storage: Storage = localStorage): DisplayPreferences {
  try {
    return parseDisplayPreferences(storage.getItem(DISPLAY_PREFERENCES_KEY));
  } catch {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
}

export function writeDisplayPreferences(
  preferences: DisplayPreferences,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be full or blocked; the preference still applies to this tab.
  }
}

/** Font size and density are CSS-variable scales keyed off <html> attributes. */
export function applyDisplayPreferences(preferences: DisplayPreferences, root: HTMLElement): void {
  root.dataset.fontSize = preferences.fontSize;
  root.dataset.conversationDensity = preferences.density;
}

const listeners = new Set<(preferences: DisplayPreferences) => void>();

export function useDisplayPreferences() {
  const [preferences, setPreferences] = useState(readDisplayPreferences);

  useLayoutEffect(() => {
    applyDisplayPreferences(preferences, document.documentElement);
  }, [preferences]);

  useEffect(() => {
    listeners.add(setPreferences);
    const onStorage = (event: StorageEvent) => {
      if (event.key === DISPLAY_PREFERENCES_KEY || event.key === null) {
        setPreferences(readDisplayPreferences());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setPreferences);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((patch: Partial<DisplayPreferences>) => {
    const next = { ...readDisplayPreferences(), ...patch };
    writeDisplayPreferences(next);
    for (const listener of listeners) listener(next);
  }, []);

  return { preferences, update };
}
