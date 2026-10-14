import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  CUSTOM_EMOJI_SET_D_TAG,
  CUSTOM_EMOJI_SET_KIND,
  type CustomEmoji,
  customEmojiPalette,
} from "@/features/composer/lib/custom-emoji";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

const EMPTY: CustomEmoji[] = [];
/** Cache key for the community emoji sets, scoped by Relay and identity. */
export function customEmojiQueryKey(relayUrl: string, pubkey: string) {
  return ["composer", "custom-emoji-sets", relayUrl, pubkey.toLowerCase()];
}

/**
 * The community custom-emoji palette (union of members' kind 30030 `buzz:custom-emoji`
 * sets, like desktop), live-updated while a composer is mounted. Scoped by Relay + identity.
 */
export function useCustomEmojiPalette(
  client: BuzzRelayClient | null,
  relayUrl: string,
  pubkey: string,
): CustomEmoji[] {
  const queryClient = useQueryClient();
  const queryKey = customEmojiQueryKey(relayUrl, pubkey);
  const query = useQuery({
    queryKey,
    enabled: Boolean(client),
    staleTime: 20 * 60_000,
    queryFn: () =>
      client
        ? client.query({
            kinds: [CUSTOM_EMOJI_SET_KIND],
            "#d": [CUSTOM_EMOJI_SET_D_TAG],
            limit: 500,
          })
        : Promise.resolve([]),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey is derived from these inputs.
  useEffect(() => {
    if (!client) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void client
      .subscribe(
        { kinds: [CUSTOM_EMOJI_SET_KIND], "#d": [CUSTOM_EMOJI_SET_D_TAG], limit: 0 },
        (event) =>
          queryClient.setQueryData<NostrEvent[]>(queryKey, (current = []) =>
            current.some((item) => item.id === event.id) ? current : [...current, event],
          ),
      )
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [client, queryClient, relayUrl, pubkey]);

  const events = query.data;
  return useMemo(() => (events ? customEmojiPalette(events) : EMPTY), [events]);
}
