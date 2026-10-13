export type EmojiEntry = {
  id: string;
  name: string;
  native: string;
  keywords: string[];
};

export type EmojiCategoryId =
  | "people"
  | "nature"
  | "foods"
  | "activity"
  | "places"
  | "objects"
  | "symbols"
  | "flags";

export type EmojiCatalog = {
  categories: { id: EmojiCategoryId; emojis: EmojiEntry[] }[];
  all: EmojiEntry[];
};

type RawEmojiData = {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<
    string,
    { id: string; name: string; keywords?: string[]; skins: { native: string }[] }
  >;
};

let catalogPromise: Promise<EmojiCatalog> | null = null;

export function buildEmojiCatalog(data: RawEmojiData): EmojiCatalog {
  const categories = data.categories.map((category) => ({
    id: category.id as EmojiCategoryId,
    emojis: category.emojis.flatMap((id) => {
      const emoji = data.emojis[id];
      const native = emoji?.skins[0]?.native;
      return emoji && native
        ? [{ id: emoji.id, name: emoji.name, native, keywords: emoji.keywords ?? [] }]
        : [];
    }),
  }));
  return { categories, all: categories.flatMap((category) => category.emojis) };
}

/** Unicode emoji data is ~400 KB, so it loads on first picker use rather than with the app. */
export function loadEmojiCatalog(): Promise<EmojiCatalog> {
  catalogPromise ??= import("@emoji-mart/data")
    .then((module) => buildEmojiCatalog(module.default as unknown as RawEmojiData))
    .catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

/** Rank id/name prefix matches above keyword and substring matches. */
export function searchEmoji(catalog: EmojiCatalog, query: string, limit = 72): EmojiEntry[] {
  const needle = query.trim().toLocaleLowerCase().replace(/^:|:$/g, "");
  if (!needle) return [];
  const scored: { emoji: EmojiEntry; score: number }[] = [];
  for (const emoji of catalog.all) {
    const id = emoji.id.toLocaleLowerCase();
    const name = emoji.name.toLocaleLowerCase();
    let score = 0;
    if (id === needle || name === needle || emoji.native === query.trim()) score = 4;
    else if (id.startsWith(needle) || name.startsWith(needle)) score = 3;
    else if (emoji.keywords.some((keyword) => keyword.toLocaleLowerCase().startsWith(needle)))
      score = 2;
    else if (id.includes(needle) || name.includes(needle)) score = 1;
    if (score) scored.push({ emoji, score });
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.emoji);
}

const RECENT_LIMIT = 24;

export function recentEmojiKey(relayUrl: string, pubkey: string): string {
  return ["buzz:web:emoji-recent:v1", encodeURIComponent(relayUrl), pubkey.toLowerCase()].join(":");
}

/** Recently used values: native glyphs or `:shortcode:` for custom emoji. */
export function readRecentEmoji(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((value): value is string => typeof value === "string" && value.length <= 80)
          .slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function recordRecentEmoji(key: string, value: string): string[] {
  const next = [value, ...readRecentEmoji(key).filter((item) => item !== value)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing; recents stay in memory for this view.
  }
  return next;
}
