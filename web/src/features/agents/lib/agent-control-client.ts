import { HEX_PUBKEY, isRecord } from "@/features/agents/lib/guards";
import { t } from "@/shared/i18n";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";

const REQUEST_TIMEOUT_MS = 60_000;

export type ManagedAgentStatus = "running" | "stopped" | "starting" | "error";
export type ManagedRespondTo = "owner-only" | "allowlist" | "anyone" | "nobody";
export type ChannelAddPolicy = "anyone" | "owner_only" | "nobody";

export type ManagedAgentConfig = {
  model: string;
  respondTo: ManagedRespondTo;
  respondToAllowlist: string[];
  channels: string[];
  channelAddPolicy: ChannelAddPolicy;
  personaRef?: string;
  systemPrompt?: string;
  parallelism?: number;
};

export type ManagedAgent = {
  pubkey: string;
  name: string;
  status: ManagedAgentStatus;
  authorized: boolean;
  config: ManagedAgentConfig;
  createdAt: number;
  updatedAt: number;
  lastExit: { code: number | null; at: number; reason?: string } | null;
};

export type AgentLogLine = { ts: string; stream: "stdout" | "stderr"; text: string };

/** A stable agent-control failure; `code` is the service's documented error code. */
export class AgentControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentControlError";
  }
}

const STATUSES: readonly ManagedAgentStatus[] = ["running", "stopped", "starting", "error"];
const RESPOND_TO: readonly ManagedRespondTo[] = ["owner-only", "allowlist", "anyone", "nobody"];
const ADD_POLICIES: readonly ChannelAddPolicy[] = ["anyone", "owner_only", "nobody"];

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseConfig(value: unknown): ManagedAgentConfig {
  const raw = isRecord(value) ? value : {};
  const parallelism = raw.parallelism;
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    respondTo: RESPOND_TO.includes(raw.respondTo as ManagedRespondTo)
      ? (raw.respondTo as ManagedRespondTo)
      : "owner-only",
    respondToAllowlist: strings(raw.respondToAllowlist).map((item) => item.toLowerCase()),
    channels: strings(raw.channels),
    channelAddPolicy: ADD_POLICIES.includes(raw.channelAddPolicy as ChannelAddPolicy)
      ? (raw.channelAddPolicy as ChannelAddPolicy)
      : "owner_only",
    personaRef: optionalText(raw.personaRef),
    systemPrompt: optionalText(raw.systemPrompt),
    parallelism:
      typeof parallelism === "number" && Number.isSafeInteger(parallelism) && parallelism > 0
        ? parallelism
        : undefined,
  };
}

/** Parse one untrusted agent object; anything without a valid pubkey/status is rejected. */
export function parseManagedAgent(value: unknown): ManagedAgent | null {
  if (!isRecord(value)) return null;
  const pubkey = typeof value.pubkey === "string" ? value.pubkey.toLowerCase() : "";
  if (!HEX_PUBKEY.test(pubkey)) return null;
  if (!STATUSES.includes(value.status as ManagedAgentStatus)) return null;
  const lastExit = isRecord(value.lastExit) ? value.lastExit : null;
  return {
    pubkey,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : pubkey,
    status: value.status as ManagedAgentStatus,
    authorized: value.authorized === true,
    config: parseConfig(value.config),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    lastExit: lastExit
      ? {
          code: typeof lastExit.code === "number" ? lastExit.code : null,
          at: typeof lastExit.at === "number" ? lastExit.at : 0,
          reason: optionalText(lastExit.reason),
        }
      : null,
  };
}

export class AgentControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly relayUrl: string,
  ) {}

  /** Every route is scoped to the community relay; the query is part of the signed NIP-98 `u`. */
  private url(path: string, query: Record<string, string> = {}): string {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}${path}`);
    url.searchParams.set("relay", this.relayUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<unknown> {
    const url = this.url(path, options.query);
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const authorization = await makeNip98AuthHeader(url, method, { body });
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: authorization,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AgentControlError("network", t("agents.controlUnreachable"), 0);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      const code = typeof error.code === "string" ? error.code : `http_${response.status}`;
      const message =
        typeof error.message === "string" && error.message.trim()
          ? error.message.slice(0, 300)
          : t("agents.controlStatus", { status: response.status });
      throw new AgentControlError(code, message, response.status);
    }
    return payload;
  }

  private agentFrom(payload: unknown): ManagedAgent {
    const agent = parseManagedAgent(isRecord(payload) ? payload.agent : null);
    if (!agent) throw new AgentControlError("bad_response", t("agents.controlBadResponse"), 200);
    return agent;
  }

  /** The caller's operator capabilities for this relay; 403 (no grant / revoked) means none. */
  async capabilities(): Promise<string[]> {
    try {
      const payload = await this.request("GET", "/v1/grant");
      const grant = isRecord(payload) && isRecord(payload.grant) ? payload.grant : {};
      return Array.isArray(grant.capabilities)
        ? grant.capabilities.filter((value): value is string => typeof value === "string")
        : [];
    } catch (error) {
      if (error instanceof AgentControlError && error.status === 403) return [];
      throw error;
    }
  }

  async list(): Promise<ManagedAgent[]> {
    const payload = await this.request("GET", "/v1/agents");
    const items = isRecord(payload) && Array.isArray(payload.agents) ? payload.agents : [];
    return items.map(parseManagedAgent).filter((agent): agent is ManagedAgent => agent !== null);
  }

  async create(
    name: string,
    config: Partial<ManagedAgentConfig>,
  ): Promise<{ pubkey: string; authChallenge: string }> {
    const payload = await this.request("POST", "/v1/agents", { body: { name, config } });
    const pubkey =
      isRecord(payload) && typeof payload.pubkey === "string" ? payload.pubkey.toLowerCase() : "";
    const challenge =
      isRecord(payload) && typeof payload.authChallenge === "string" ? payload.authChallenge : "";
    // The challenge must be exactly the unconditional NIP-OA preimage for the returned agent;
    // signing anything else would hand the service an attestation for a different statement.
    if (!HEX_PUBKEY.test(pubkey) || challenge !== `nostr:agent-auth:${pubkey}:`) {
      throw new AgentControlError("bad_response", t("agents.controlBadResponse"), 201);
    }
    return { pubkey, authChallenge: challenge };
  }

  async authorize(pubkey: string, authTag: readonly string[]): Promise<ManagedAgent> {
    return this.agentFrom(
      await this.request("POST", `/v1/agents/${pubkey}/authorize`, { body: { authTag } }),
    );
  }

  async update(pubkey: string, config: Partial<ManagedAgentConfig>): Promise<ManagedAgent> {
    return this.agentFrom(
      await this.request("PATCH", `/v1/agents/${pubkey}`, { body: { config } }),
    );
  }

  async lifecycle(pubkey: string, action: "start" | "stop" | "restart"): Promise<ManagedAgent> {
    return this.agentFrom(await this.request("POST", `/v1/agents/${pubkey}/${action}`));
  }

  async remove(pubkey: string): Promise<void> {
    await this.request("DELETE", `/v1/agents/${pubkey}`);
  }

  async logs(pubkey: string, tail = 200): Promise<AgentLogLine[]> {
    const payload = await this.request("GET", `/v1/agents/${pubkey}/logs`, {
      query: { tail: String(tail) },
    });
    const lines = isRecord(payload) && Array.isArray(payload.lines) ? payload.lines : [];
    return lines.flatMap((line): AgentLogLine[] =>
      isRecord(line) && typeof line.text === "string"
        ? [
            {
              ts: typeof line.ts === "string" ? line.ts : "",
              stream: line.stream === "stderr" ? "stderr" : "stdout",
              text: line.text,
            },
          ]
        : [],
    );
  }
}
