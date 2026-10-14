import type { NostrEvent } from "@/shared/api/nostr-types";

/** NIP-30 emoji set kind and the Buzz community palette identifier used by desktop. */
export const CUSTOM_EMOJI_SET_KIND = 30030;
export const CUSTOM_EMOJI_SET_D_TAG = "buzz:custom-emoji";

export type CustomEmoji = { shortcode: string; url: string };

const SHORTCODE = /^[a-z0-9_-]{1,64}$/;

function safeEmojiUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `["emoji", shortcode, url]` pairs from one event, keeping only valid shortcodes and http(s) URLs. */
export function customEmojiFromTags(tags: readonly (readonly string[])[]): CustomEmoji[] {
  const emoji: CustomEmoji[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== "emoji") continue;
    const shortcode = tag[1]?.toLowerCase();
    const url = safeEmojiUrl(tag[2]);
    if (!shortcode || !SHORTCODE.test(shortcode) || !url || seen.has(shortcode)) continue;
    seen.add(shortcode);
    emoji.push({ shortcode, url });
  }
  return emoji;
}

/**
 * Union of every member's kind 30030 `buzz:custom-emoji` set, matching desktop:
 * one URL per shortcode, the newest set wins and equal timestamps prefer the smaller URL.
 * The set is replaceable, so only each member's newest version counts: a live update
 * that removed an emoji must not leave it alive through the version it replaced.
 */
export function customEmojiPalette(events: readonly NostrEvent[]): CustomEmoji[] {
  const latestSets = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== CUSTOM_EMOJI_SET_KIND) continue;
    if (!event.tags.some((tag) => tag[0] === "d" && tag[1] === CUSTOM_EMOJI_SET_D_TAG)) continue;
    const author = event.pubkey.toLowerCase();
    const current = latestSets.get(author);
    if (!current || event.created_at > current.created_at) latestSets.set(author, event);
  }
  const winners = new Map<string, { url: string; createdAt: number }>();
  for (const event of latestSets.values()) {
    for (const { shortcode, url } of customEmojiFromTags(event.tags)) {
      const previous = winners.get(shortcode);
      if (
        !previous ||
        event.created_at > previous.createdAt ||
        (event.created_at === previous.createdAt && url < previous.url)
      ) {
        winners.set(shortcode, { url, createdAt: event.created_at });
      }
    }
  }
  return [...winners]
    .map(([shortcode, { url }]) => ({ shortcode, url }))
    .sort((left, right) => left.shortcode.localeCompare(right.shortcode));
}

/** One `emoji` tag per distinct known `:shortcode:` in the body, in order of first use. */
export function customEmojiTags(content: string, palette: readonly CustomEmoji[]): string[][] {
  const byShortcode = new Map(palette.map((emoji) => [emoji.shortcode, emoji.url]));
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/:([a-z0-9_-]+):/gi)) {
    const shortcode = match[1].toLowerCase();
    const url = byShortcode.get(shortcode);
    if (!url || seen.has(shortcode)) continue;
    seen.add(shortcode);
    tags.push(["emoji", shortcode, url]);
  }
  return tags;
}

/** Normalize like the Relay: strip surrounding colons, lowercase, `[a-z0-9_-]{1,64}`. */
export function normalizeShortcode(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  return SHORTCODE.test(value) ? value : null;
}

/** Desktop's file-first naming: drop the extension and collapse invalid runs to `_`. */
export function suggestShortcode(filename: string): string {
  const base = filename
    .trim()
    .replace(/^.*[/\\]/, "")
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return normalizeShortcode(base) ?? "";
}

/** The caller's replacement kind 30030 set after adding (or replacing) or removing one emoji. */
export function ownEmojiSetTemplate(
  own: readonly CustomEmoji[],
  change: { add: CustomEmoji } | { remove: string },
): { kind: number; content: string; tags: string[][] } {
  const target = "add" in change ? change.add.shortcode : change.remove;
  const next = own.filter((emoji) => emoji.shortcode !== target);
  if ("add" in change) next.push(change.add);
  return {
    kind: CUSTOM_EMOJI_SET_KIND,
    content: "",
    tags: [
      ["d", CUSTOM_EMOJI_SET_D_TAG],
      ...next.map((emoji) => ["emoji", emoji.shortcode, emoji.url]),
    ],
  };
}
