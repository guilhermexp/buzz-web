import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { CustomEmoji } from "@/features/composer/lib/custom-emoji";
import {
  type EmojiEntry,
  loadEmojiCatalog,
  readRecentEmoji,
  recentEmojiKey,
  recordRecentEmoji,
  searchEmoji,
} from "@/features/composer/lib/emoji-catalog";
import { CustomEmojiImage } from "@/features/composer/ui/CustomEmojiImage";
import { type MessageKey, t } from "@/shared/i18n";

type PickerItem =
  | { kind: "native"; key: string; label: string; native: string }
  | { kind: "custom"; key: string; label: string; emoji: CustomEmoji };

const nativeItem = (emoji: EmojiEntry): PickerItem => ({
  kind: "native",
  key: emoji.id,
  label: emoji.name,
  native: emoji.native,
});

const customItem = (emoji: CustomEmoji): PickerItem => ({
  kind: "custom",
  key: `custom:${emoji.shortcode}`,
  label: `:${emoji.shortcode}:`,
  emoji,
});

function EmojiSection({
  title,
  items,
  relayUrl,
  onPick,
}: {
  title: string;
  items: PickerItem[];
  relayUrl: string;
  onPick: (item: PickerItem) => void;
}) {
  const headingId = useId();
  if (!items.length) return null;
  return (
    <section aria-labelledby={headingId} className="[content-visibility:auto]">
      <h3
        className="sticky top-0 z-10 bg-popover px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground"
        id={headingId}
      >
        {title}
      </h3>
      <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-9">
        {items.map((item) => (
          <button
            key={item.key}
            aria-label={item.label}
            className="flex aspect-square items-center justify-center rounded text-xl leading-none hover:bg-foreground/8 focus-visible:bg-foreground/10 focus-visible:outline-none"
            title={item.label}
            type="button"
            onClick={() => onPick(item)}
          >
            {item.kind === "native" ? (
              item.native
            ) : (
              <CustomEmojiImage
                className="h-6 w-6 object-contain"
                relayUrl={relayUrl}
                shortcode={item.emoji.shortcode}
                url={item.emoji.url}
              />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Searchable unicode + community custom emoji with per-identity recents. */
export function EmojiPanel({
  relayUrl,
  pubkey,
  customEmoji,
  onSelect,
}: {
  relayUrl: string;
  pubkey: string;
  customEmoji: readonly CustomEmoji[];
  /** Native glyph, or `:shortcode:` for a custom emoji. */
  onSelect: (value: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const recentKey = recentEmojiKey(relayUrl, pubkey);
  const [recent, setRecent] = useState(() => readRecentEmoji(recentKey));
  const catalog = useQuery({
    queryKey: ["composer", "emoji-catalog"],
    queryFn: loadEmojiCatalog,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const byValue = useMemo(() => {
    const map = new Map<string, PickerItem>();
    for (const emoji of catalog.data?.all ?? []) map.set(emoji.native, nativeItem(emoji));
    for (const emoji of customEmoji) map.set(`:${emoji.shortcode}:`, customItem(emoji));
    return map;
  }, [catalog.data, customEmoji]);

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed) return [];
    const needle = trimmed.toLocaleLowerCase().replace(/^:|:$/g, "");
    const custom = customEmoji.filter((emoji) => emoji.shortcode.includes(needle)).map(customItem);
    const native = catalog.data ? searchEmoji(catalog.data, trimmed).map(nativeItem) : [];
    return [...custom, ...native];
  }, [catalog.data, customEmoji, trimmed]);

  const pick = (item: PickerItem) => {
    const value = item.kind === "native" ? item.native : `:${item.emoji.shortcode}:`;
    setRecent(recordRecentEmoji(recentKey, value));
    onSelect(value);
  };

  const recentItems = recent.flatMap((value) => {
    const item = byValue.get(value);
    return item ? [item] : [];
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-2 pt-2">
        <label className="sr-only" htmlFor={searchId}>
          {t("composer.emojiSearch")}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 mt-1 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker opens on an explicit request to search emoji.
          autoFocus
          className="h-8 w-full rounded-md border border-border/80 bg-background pl-7 pr-2 text-sm outline-none focus:border-ring/60"
          id={searchId}
          placeholder={t("composer.emojiSearch")}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              pick(results[0]);
            }
          }}
        />
      </div>
      <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {catalog.isError ? (
          <p className="px-1 py-6 text-center text-xs text-destructive">
            {t("composer.emojiLoadFailed")}
          </p>
        ) : trimmed ? (
          results.length ? (
            <EmojiSection
              items={results}
              relayUrl={relayUrl}
              title={t("composer.emojiResults")}
              onPick={pick}
            />
          ) : (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {t("composer.emojiNoResults", { query: trimmed })}
            </p>
          )
        ) : (
          <>
            <EmojiSection
              items={recentItems}
              relayUrl={relayUrl}
              title={t("composer.emojiRecent")}
              onPick={pick}
            />
            <EmojiSection
              items={customEmoji.map(customItem)}
              relayUrl={relayUrl}
              title={t("composer.emojiCustom")}
              onPick={pick}
            />
            {catalog.data ? (
              catalog.data.categories.map((category) => (
                <EmojiSection
                  key={category.id}
                  items={category.emojis.map(nativeItem)}
                  relayUrl={relayUrl}
                  title={t(`composer.emojiCategory.${category.id}` as MessageKey)}
                  onPick={pick}
                />
              ))
            ) : (
              <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {t("composer.emojiLoading")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
