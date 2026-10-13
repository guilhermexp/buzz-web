import { normalizeRelayUrl, type RuntimeConfig } from "@/shared/config/runtime-config";
import { parseRelayFeatures } from "@/shared/features/relay-features";

/**
 * A community the user can switch to. The configured community (config.json)
 * is always present and cannot be removed; others are saved in this browser.
 * Only public Relay URLs and display names are stored, never credentials.
 */
export type SavedCommunity = {
  id: string;
  name: string;
  relayUrl: string;
  addedAt: number;
  /** True for the community declared by the deployment's runtime config. */
  configured: boolean;
};

export const SAVED_COMMUNITIES_KEY = "buzz:web:communities:v1";
export const ACTIVE_COMMUNITY_KEY = "buzz:web:active-community:v1";
const MAX_SAVED = 50;

export function communityIdForRelay(relayUrl: string): string {
  return `relay:${relayUrl}`;
}

/** Desktop-compatible default naming: host label without a leading `relay`. */
export function defaultCommunityName(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
    return url.port ? `Local Dev :${url.port}` : "Local Dev";
  }
  const labels = url.hostname.split(".");
  const label = labels[0] === "relay" && labels.length > 2 ? labels[1] : labels[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : url.hostname;
}

export function parseSavedCommunities(raw: string | null): SavedCommunity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const result: SavedCommunity[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    let relayUrl: string;
    try {
      relayUrl = normalizeRelayUrl(candidate.relayUrl);
    } catch {
      continue;
    }
    if (seen.has(relayUrl)) continue;
    seen.add(relayUrl);
    result.push({
      id: communityIdForRelay(relayUrl),
      name:
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name.trim().slice(0, 80)
          : defaultCommunityName(relayUrl),
      relayUrl,
      addedAt: Number.isFinite(candidate.addedAt) ? Number(candidate.addedAt) : 0,
      configured: false,
    });
    if (result.length >= MAX_SAVED) break;
  }
  return result;
}

/** The configured community first, then saved and preset ones without duplicates. */
export function communityList(
  config: Pick<RuntimeConfig, "communityName" | "relayUrl" | "communities">,
  saved: readonly SavedCommunity[],
): SavedCommunity[] {
  const configured: SavedCommunity = {
    id: communityIdForRelay(config.relayUrl),
    name: config.communityName,
    relayUrl: config.relayUrl,
    addedAt: 0,
    configured: true,
  };
  const seen = new Set([configured.relayUrl]);
  const result = [configured];
  for (const community of [...config.communities, ...saved]) {
    if (seen.has(community.relayUrl)) continue;
    seen.add(community.relayUrl);
    result.push({ ...community, id: communityIdForRelay(community.relayUrl), configured: false });
  }
  return result;
}

/**
 * Runtime config for a selected community. Agents, Agent Control and feature
 * flags are deployment facts about the configured Relay only, so other
 * communities never inherit them.
 */
export function configForCommunity(
  config: RuntimeConfig,
  community: SavedCommunity,
): RuntimeConfig {
  if (community.relayUrl === config.relayUrl) return config;
  return {
    ...config,
    communityName: community.name,
    relayUrl: community.relayUrl,
    agents: [],
    agentControlUrl: null,
    features: parseRelayFeatures(undefined),
  };
}
