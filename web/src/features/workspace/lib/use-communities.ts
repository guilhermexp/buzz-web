import { useCallback, useMemo, useState } from "react";
import {
  ACTIVE_COMMUNITY_KEY,
  communityIdForRelay,
  communityList,
  configForCommunity,
  defaultCommunityName,
  parseSavedCommunities,
  SAVED_COMMUNITIES_KEY,
  type SavedCommunity,
} from "@/features/workspace/lib/saved-communities";
import { normalizeRelayUrl, type RuntimeConfig } from "@/shared/config/runtime-config";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked; the selection still applies to this tab.
  }
}

/** The `?community=<relay URL>` deep-link parameter, when it names a known community. */
function deepLinkedRelay(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get("community");
    return value ? normalizeRelayUrl(value) : null;
  } catch {
    return null;
  }
}

export function useCommunities(config: RuntimeConfig) {
  const [saved, setSaved] = useState(() =>
    parseSavedCommunities(readStorage(SAVED_COMMUNITIES_KEY)),
  );
  const communities = useMemo(() => communityList(config, saved), [config, saved]);
  const [activeId, setActiveId] = useState<string>(() => {
    const linked = deepLinkedRelay();
    const known = parseSavedCommunities(readStorage(SAVED_COMMUNITIES_KEY));
    const all = communityList(config, known);
    if (linked && all.some((community) => community.relayUrl === linked)) {
      return communityIdForRelay(linked);
    }
    return readStorage(ACTIVE_COMMUNITY_KEY) ?? communityIdForRelay(config.relayUrl);
  });
  const active = communities.find((community) => community.id === activeId) ?? communities[0];
  const activeConfig = useMemo(() => configForCommunity(config, active), [active, config]);

  const persistSaved = useCallback((next: SavedCommunity[]) => {
    writeStorage(
      SAVED_COMMUNITIES_KEY,
      JSON.stringify(next.map(({ name, relayUrl, addedAt }) => ({ name, relayUrl, addedAt }))),
    );
    setSaved(next);
  }, []);

  const select = useCallback((id: string) => {
    writeStorage(ACTIVE_COMMUNITY_KEY, id);
    setActiveId(id);
  }, []);

  /** Saves a community (validating its Relay URL) and switches to it. */
  const add = useCallback(
    (input: { name: string; relayUrl: string }) => {
      const relayUrl = normalizeRelayUrl(input.relayUrl.trim());
      const id = communityIdForRelay(relayUrl);
      if (!communities.some((community) => community.relayUrl === relayUrl)) {
        persistSaved([
          ...saved,
          {
            id,
            name: input.name.trim().slice(0, 80) || defaultCommunityName(relayUrl),
            relayUrl,
            addedAt: Date.now(),
            configured: false,
          },
        ]);
      }
      select(id);
    },
    [communities, persistSaved, saved, select],
  );

  /** Forgets a saved community on this device only; Relay membership is untouched. */
  const remove = useCallback(
    (id: string) => {
      persistSaved(saved.filter((community) => community.id !== id));
      if (id === activeId) select(communityIdForRelay(config.relayUrl));
    },
    [activeId, config.relayUrl, persistSaved, saved, select],
  );

  const removableIds = useMemo(() => new Set(saved.map((community) => community.id)), [saved]);

  return { communities, active, activeConfig, removableIds, select, add, remove };
}
