import { parseRelayFeatures, type RelayFeatureState } from "@/shared/features/relay-features";
import { t } from "@/shared/i18n";

export type ConfiguredAgent = {
  pubkey: string;
  name: string;
};

/** Additional community preset declared by the deployment (public data only). */
export type ConfiguredCommunity = {
  name: string;
  relayUrl: string;
  addedAt: number;
};

export type RuntimeConfig = {
  communityName: string;
  relayUrl: string;
  /** Extra communities offered in the switcher besides `relayUrl`. */
  communities: ConfiguredCommunity[];
  agents: ConfiguredAgent[];
  agentControlUrl: string | null;
  features: RelayFeatureState;
  demoMode: boolean;
};

function validPubkey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function normalizeRelayUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(t("error.relayUrlRequired"));
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(t("error.relayUrlInvalid"));
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(t("error.relayUrlProtocol"));
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeAgentControlUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = new URL(value, window.location.origin);
  const localHttp =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(t("error.agentControlUrlProtocol"));
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseConfiguredCommunities(value: unknown): ConfiguredCommunity[] {
  if (!Array.isArray(value)) return [];
  const communities: ConfiguredCommunity[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    try {
      const relayUrl = normalizeRelayUrl(candidate.relayUrl);
      const name =
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name.trim().slice(0, 80)
          : new URL(relayUrl).host;
      communities.push({ name, relayUrl, addedAt: 0 });
    } catch {
      // Invalid presets are ignored rather than failing the whole app.
    }
  }
  return communities;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const configUrl = new URL(
    "config.json",
    new URL(import.meta.env.BASE_URL, window.location.origin),
  );
  const response = await fetch(configUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(t("error.webConfigStatus", { status: response.status }));
  const raw = (await response.json()) as Record<string, unknown>;
  const agents = Array.isArray(raw.agents)
    ? raw.agents
        .filter(
          (agent): agent is Record<string, unknown> =>
            typeof agent === "object" && agent !== null && validPubkey(agent.pubkey),
        )
        .map((agent) => ({
          pubkey: String(agent.pubkey).toLowerCase(),
          name: typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : "Agent",
        }))
    : [];

  return {
    communityName:
      typeof raw.communityName === "string" && raw.communityName.trim()
        ? raw.communityName.trim()
        : "Buzz",
    relayUrl: normalizeRelayUrl(raw.relayUrl),
    communities: parseConfiguredCommunities(raw.communities),
    agents,
    agentControlUrl: normalizeAgentControlUrl(raw.agentControlUrl),
    features: parseRelayFeatures(raw.features),
    demoMode: raw.demoMode === true && import.meta.env.VITE_ENABLE_DEMO === "true",
  };
}

export function relayHttpOrigin(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
