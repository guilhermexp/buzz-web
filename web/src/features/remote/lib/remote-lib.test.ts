import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentControlError, agentControlFetch } from "@/features/remote/lib/agent-control-request";
import { buildMcpArguments, mcpFields } from "@/features/remote/lib/mcp-arguments";
import { terminalSocketUrl } from "@/features/remote/lib/remote-api";
import {
  isEditableText,
  resolveNewFilePath,
  workspaceBreadcrumbs,
} from "@/features/remote/lib/workspace-paths";

// The signer is replaced so the test can read the exact tags the service will verify.
vi.mock("@/shared/lib/nostr-signer", () => ({
  signNostrEvent: async (template: { tags: string[][] }) => ({ ...template, id: "x", sig: "y" }),
}));

const target = {
  baseUrl: "https://buzz.example.com/agent-control",
  relayUrl: "wss://relay.example.com",
};

function authTags(init: RequestInit): Record<string, string> {
  const header = new Headers(init.headers).get("Authorization") ?? "";
  const event: { tags: string[][] } = JSON.parse(atob(header.slice("Nostr ".length)));
  return Object.fromEntries(event.tags);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

afterEach(() => vi.unstubAllGlobals());

describe("signed Agent Control requests", () => {
  it("signs the exact community-bound URL and the digest of binary upload bytes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    });
    const bytes = new Uint8Array([0, 255, 1, 128]);
    await agentControlFetch(target, "PUT", "/v1/workspaces/dev/file", {
      query: { path: "a b/c.bin" },
      bytes,
    });
    const { url, init } = calls[0];
    expect(url).toBe(
      "https://buzz.example.com/agent-control/v1/workspaces/dev/file?relay=wss%3A%2F%2Frelay.example.com&path=a+b%2Fc.bin",
    );
    const tags = authTags(init);
    expect(tags.u).toBe(url);
    expect(tags.method).toBe("PUT");
    expect(tags.payload).toBe(await sha256Hex(bytes));
    expect(tags.nonce).toMatch(/[0-9a-f-]{36}/);
  });

  it("signs GETs over the empty body and surfaces stable error codes", async () => {
    let tags: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      tags = authTags(init);
      return new Response(JSON.stringify({ error: { code: "path_escape", message: "outside" } }), {
        status: 400,
      });
    });
    const failure = agentControlFetch(target, "GET", "/v1/workspaces/dev/files", {
      query: { path: "../etc" },
    });
    await expect(failure).rejects.toMatchObject({ code: "path_escape", status: 400 });
    await expect(failure).rejects.toBeInstanceOf(AgentControlError);
    expect(tags.payload).toBe(await sha256Hex(new Uint8Array()));
  });

  it("keeps the ticket, not the relay parameter, in terminal socket URLs", () => {
    const url = new URL(
      terminalSocketUrl(target, "dev", { ticket: "tk", session: "s1", cols: 80, rows: 24 }),
    );
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/agent-control/v1/workspaces/dev/terminal");
    expect(url.searchParams.get("ticket")).toBe("tk");
    expect(url.searchParams.get("session")).toBe("s1");
    expect(url.searchParams.has("relay")).toBe(false);
  });
});

describe("workspace paths", () => {
  it("rejects names the service would treat as escapes", () => {
    expect(resolveNewFilePath("src", "lib/main.rs")).toBe("src/lib/main.rs");
    expect(resolveNewFilePath("", "./notes.md")).toBe("notes.md");
    for (const bad of ["", "  ", "/etc/passwd", "../x", "a/../../b", "~/x", "a\\b"]) {
      expect(resolveNewFilePath("src", bad)).toBeNull();
    }
  });

  it("builds cumulative breadcrumbs and detects editable text", () => {
    expect(workspaceBreadcrumbs("a/b/c")).toEqual([
      { name: "a", path: "a" },
      { name: "b", path: "a/b" },
      { name: "c", path: "a/b/c" },
    ]);
    expect(isEditableText(new TextEncoder().encode("héllo\n"))).toBe(true);
    expect(isEditableText(new Uint8Array([0x68, 0, 0x69]))).toBe(false);
    expect(isEditableText(new Uint8Array([0xff, 0xfe]))).toBe(false);
    expect(isEditableText(new Uint8Array(11), 10)).toBe(false);
  });
});

describe("MCP argument forms", () => {
  const schema = {
    type: "object",
    required: ["command"],
    properties: {
      timeout_ms: { type: ["integer", "null"] },
      command: { type: "string", description: "Shell command" },
      env: { type: "object" },
      mode: { enum: ["fast", "safe"] },
      dry: { type: "boolean" },
    },
  };

  it("derives typed fields with required ones first", () => {
    const fields = mcpFields(schema);
    expect(fields.map((field) => [field.name, field.kind, field.required])).toEqual([
      ["command", "string", true],
      ["timeout_ms", "integer", false],
      ["env", "json", false],
      ["mode", "enum", false],
      ["dry", "boolean", false],
    ]);
    expect(fields.find((field) => field.name === "mode")?.options).toEqual(["fast", "safe"]);
  });

  it("parses values, omits empty optionals and reports the first invalid field", () => {
    const fields = mcpFields(schema);
    expect(
      buildMcpArguments(fields, { command: "ls -la", timeout_ms: "5000", env: '{"A":"1"}' }),
    ).toEqual({
      ok: true,
      arguments: { command: "ls -la", timeout_ms: 5000, env: { A: "1" } },
    });
    expect(buildMcpArguments(fields, {})).toEqual({
      ok: false,
      field: "command",
      problem: "required",
    });
    expect(buildMcpArguments(fields, { command: "x", timeout_ms: "1.5" })).toMatchObject({
      ok: false,
      problem: "integer",
    });
    expect(buildMcpArguments(fields, { command: "x", env: "{" })).toMatchObject({
      ok: false,
      problem: "json",
    });
  });
});
