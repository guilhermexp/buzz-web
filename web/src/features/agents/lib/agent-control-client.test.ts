import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentControlClient, AgentControlError } from "@/features/agents/lib/agent-control-client";
import {
  activateLocalSigner,
  clearActiveSigner,
  signAgentAuthorization,
} from "@/shared/lib/nostr-signer";

const BASE = "http://127.0.0.1:47410";
const RELAY = "ws://127.0.0.1:47300";
const AGENT = getPublicKey(generateSecretKey());

function respond(status: number, body: unknown) {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function signedAuth(init: RequestInit | undefined) {
  const header = new Headers(init?.headers).get("Authorization") ?? "";
  return JSON.parse(atob(header.slice("Nostr ".length))) as { pubkey: string; tags: string[][] };
}

afterEach(() => {
  clearActiveSigner();
  vi.unstubAllGlobals();
});

describe("AgentControlClient", () => {
  it("signs every request with the relay-scoped URL, method, payload hash and nonce", async () => {
    const secret = generateSecretKey();
    activateLocalSigner(secret);
    const fetchMock = respond(200, { agents: [] });
    vi.stubGlobal("fetch", fetchMock);
    await new AgentControlClient(BASE, RELAY).list();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/v1/agents?relay=${encodeURIComponent(RELAY)}`);
    const auth = signedAuth(init);
    expect(auth.pubkey).toBe(getPublicKey(secret));
    expect(auth.tags).toContainEqual(["u", url]);
    expect(auth.tags).toContainEqual(["method", "GET"]);
    expect(auth.tags.find((tag) => tag[0] === "payload")?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.tags.find((tag) => tag[0] === "nonce")?.[1]).toBeTruthy();
  });

  it("refuses to sign a NIP-OA challenge that is not the unconditional preimage for the agent", async () => {
    activateLocalSigner(generateSecretKey());
    vi.stubGlobal(
      "fetch",
      respond(201, { pubkey: AGENT, authChallenge: `nostr:agent-auth:${AGENT}:kind=1` }),
    );
    await expect(new AgentControlClient(BASE, RELAY).create("a", {})).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("surfaces stable service error codes without inventing success", async () => {
    activateLocalSigner(generateSecretKey());
    vi.stubGlobal("fetch", respond(403, { error: { code: "forbidden", message: "no grant" } }));
    const failure = new AgentControlClient(BASE, RELAY).lifecycle(AGENT, "start");
    await expect(failure).rejects.toBeInstanceOf(AgentControlError);
    await expect(failure).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("drops malformed agents from list responses", async () => {
    activateLocalSigner(generateSecretKey());
    vi.stubGlobal(
      "fetch",
      respond(200, {
        agents: [
          { pubkey: AGENT, name: "ok", status: "running", config: { respondTo: "bogus" } },
          { pubkey: "not-hex", status: "running" },
          { pubkey: AGENT, status: "exploded" },
        ],
      }),
    );
    const agents = await new AgentControlClient(BASE, RELAY).list();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.config.respondTo).toBe("owner-only");
  });
});

describe("signAgentAuthorization", () => {
  it("produces a verifiable unconditional NIP-OA tag and never reveals the owner key", () => {
    const secret = generateSecretKey();
    const owner = activateLocalSigner(secret);
    const tag = signAgentAuthorization(AGENT);
    expect(tag.slice(0, 3)).toEqual(["auth", owner, ""]);
    const digest = sha256(utf8ToBytes(`nostr:agent-auth:${AGENT}:`));
    expect(schnorr.verify(hexToBytes(tag[3]), digest, hexToBytes(owner))).toBe(true);
    expect(() => signAgentAuthorization(owner)).toThrow();
  });
});
