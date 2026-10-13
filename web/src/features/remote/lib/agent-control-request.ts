import { t } from "@/shared/i18n";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

/** A failed Agent Control call with the service's stable error code. */
export class AgentControlError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentControlError";
    this.status = status;
    this.code = code;
  }
}

export type RequestBody = string | Uint8Array;

export type AgentControlTarget = {
  /** Public Agent Control base URL from runtime config (no trailing slash). */
  baseUrl: string;
  /** Community Relay URL the request is bound to. */
  relayUrl: string;
};

/** Exact URL the service verifies: every call carries `relay=` so it is part of the signature. */
export function agentControlUrl(
  target: AgentControlTarget,
  path: string,
  query: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ relay: target.relayUrl, ...query });
  return `${target.baseUrl}${path}?${params.toString()}`;
}

async function sha256Hex(body: RequestBody): Promise<string> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** NIP-98 header binding URL, method, body digest (empty body included) and a fresh nonce. */
export async function signAgentControlRequest(
  url: string,
  method: string,
  body: RequestBody,
): Promise<string> {
  const event = await signNostrEvent({
    kind: 27235,
    content: "",
    tags: [
      ["u", url],
      ["method", method],
      ["payload", await sha256Hex(body)],
      ["nonce", crypto.randomUUID()],
    ],
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function field(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object" || !(name in value)) return undefined;
  return Reflect.get(value, name);
}

function errorFromBody(status: number, value: unknown): AgentControlError {
  const error = field(value, "error");
  const code = field(error, "code");
  const message = field(error, "message");
  return new AgentControlError(
    status,
    typeof code === "string" ? code : `http_${status}`,
    typeof message === "string" ? message : t("remote.error.http", { status }),
  );
}

/** Signed request; resolves the raw Response for 2xx, throws AgentControlError otherwise. */
export async function agentControlFetch(
  target: AgentControlTarget,
  method: string,
  path: string,
  options: {
    query?: Record<string, string>;
    json?: unknown;
    bytes?: Uint8Array;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const url = agentControlUrl(target, path, options.query);
  const body: RequestBody =
    options.bytes ?? (options.json === undefined ? "" : JSON.stringify(options.json));
  const headers: Record<string, string> = {
    Authorization: await signAgentControlRequest(url, method, body),
  };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.bytes) headers["Content-Type"] = "application/octet-stream";
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : (body as BodyInit),
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AgentControlError(0, "network_error", t("remote.error.network"));
  }
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw errorFromBody(response.status, value);
  }
  return response;
}

export async function agentControlJson<T>(
  target: AgentControlTarget,
  method: string,
  path: string,
  options?: Parameters<typeof agentControlFetch>[3],
): Promise<T> {
  const response = await agentControlFetch(target, method, path, options);
  return (await response.json()) as T;
}
