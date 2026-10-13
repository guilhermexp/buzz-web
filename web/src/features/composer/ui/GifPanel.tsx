import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  fetchRelayGifCapability,
  type RelayGif,
  type RelayGifCapability,
  searchRelayGifs,
} from "@/features/composer/lib/gif-api";
import { getLocale, t } from "@/shared/i18n";

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/** The Relay's advertised GIF search, cached per Relay; null means no provider is configured. */
export function useRelayGifCapability(relayUrl: string, enabled: boolean) {
  return useQuery({
    queryKey: ["composer", "gif-capability", relayUrl],
    queryFn: ({ signal }) => fetchRelayGifCapability(relayUrl, signal),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

function GifResults({
  relayUrl,
  pubkey,
  capability,
  onSelect,
}: {
  relayUrl: string;
  pubkey: string;
  capability: RelayGifCapability;
  onSelect: (gif: RelayGif) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 300);
  const results = useQuery({
    queryKey: ["composer", "gif-search", relayUrl, pubkey, debounced],
    queryFn: ({ signal }) =>
      searchRelayGifs(relayUrl, pubkey, capability, debounced, getLocale(), signal),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-2 pt-2">
        <label className="sr-only" htmlFor={searchId}>
          {t("composer.gifSearch")}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 mt-1 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          // biome-ignore lint/a11y/noAutofocus: the GIF tab was explicitly selected to search.
          autoFocus
          className="h-8 w-full rounded-md border border-border/80 bg-background pl-7 pr-2 text-sm outline-none focus:border-ring/60"
          id={searchId}
          maxLength={200}
          placeholder={t("composer.gifSearch")}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto p-2"
        aria-busy={results.isFetching}
      >
        {results.isError ? (
          <p className="px-1 py-6 text-center text-xs text-destructive" role="alert">
            {results.error.message}
          </p>
        ) : !results.data ? (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            {t("composer.gifLoading")}
          </p>
        ) : results.data.length ? (
          <div className="columns-2 gap-1.5 sm:columns-3">
            {results.data.map((gif) => (
              <button
                key={gif.slug}
                aria-label={t("composer.gifAdd", { title: gif.title })}
                className="mb-1.5 block w-full overflow-hidden rounded-md bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
                style={{ aspectRatio: `${gif.preview.width} / ${gif.preview.height}` }}
                title={gif.title}
                type="button"
                onClick={() => onSelect(gif)}
              >
                <picture>
                  {gif.poster ? (
                    <source media="(prefers-reduced-motion: reduce)" srcSet={gif.poster.url} />
                  ) : null}
                  <img
                    alt=""
                    className="block h-full w-full object-cover"
                    decoding="async"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={gif.preview.url}
                  />
                </picture>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {t("composer.gifNoResults")}
          </p>
        )}
      </div>
      <p className="border-t border-border/55 px-2 py-1 text-right text-[10px] text-muted-foreground">
        {t("composer.gifProvider")}
      </p>
    </div>
  );
}

/** GIF tab: real Relay search when advertised, otherwise an explanation of the limitation. */
export function GifPanel({
  relayUrl,
  pubkey,
  onSelect,
}: {
  relayUrl: string;
  pubkey: string;
  onSelect: (gif: RelayGif, capability: RelayGifCapability) => void;
}) {
  const capability = useRelayGifCapability(relayUrl, true);
  if (capability.isPending) {
    return (
      <p className="flex flex-1 items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        {t("composer.gifLoading")}
      </p>
    );
  }
  if (capability.isError || !capability.data) {
    return (
      <p
        className="flex-1 px-4 py-8 text-center text-xs leading-5 text-muted-foreground"
        role="status"
      >
        {capability.isError ? t("composer.gifCapabilityFailed") : t("composer.gifUnavailable")}
      </p>
    );
  }
  const available = capability.data;
  return (
    <GifResults
      capability={available}
      pubkey={pubkey}
      relayUrl={relayUrl}
      onSelect={(gif) => onSelect(gif, available)}
    />
  );
}
