import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAgentConfig, parseDockerLogs, redactSecrets } from "./agents.mjs";
import { loadConfig } from "./config.mjs";
import { corsHeaders, Router } from "./http.mjs";
import { HttpError } from "./lib.mjs";
import { isValidCallId, mcpError } from "./mcp.mjs";
import { normalizeWorkspacePath } from "./paths.mjs";
import { TicketStore } from "./terminal.mjs";
import { helperError, parseListing } from "./workspaces.mjs";

const escape = (error) => error instanceof HttpError && error.code === "path_escape";

test("workspace paths reject absolute, parent, home and control-character forms", () => {
  assert.equal(normalizeWorkspacePath(""), "");
  assert.equal(normalizeWorkspacePath(undefined), "");
  assert.equal(normalizeWorkspacePath("./src//main.rs/"), "src/main.rs");
  for (const bad of ["/etc/passwd", "../x", "a/../../b", "a/..", "~/x", "a\\..\\b", "a\u0000b", "a\nb"]) {
    assert.throws(() => normalizeWorkspacePath(bad), escape, bad);
  }
  assert.throws(() => normalizeWorkspacePath("a".repeat(1025)), HttpError);
});

test("in-container helper statuses map to stable public errors", () => {
  assert.equal(helperError(3, "path_escape").code, "path_escape");
  assert.equal(helperError(3, "").status, 400);
  assert.equal(helperError(4, "not_found").status, 404);
  assert.equal(helperError(5, "not_a_directory").code, "not_a_directory");
  assert.equal(helperError(6, "workspace_root").code, "workspace_root");
  assert.equal(helperError(127, "").code, "runtime_error");
});

test("directory listings keep names with tabs and hide in-flight uploads", () => {
  const raw = Buffer.from(
    "f\t12\t1791000000.5\tb.txt\0d\t4096\t1791000001.0\tsrc\0f\t0\t1.0\t.buzz-upload.AbC123\0l\t4\t2.0\tweird\tname\0",
  );
  assert.deepEqual(parseListing(raw), [
    { name: "src", type: "directory", size: 4096, modifiedAt: 1791000001 },
    { name: "b.txt", type: "file", size: 12, modifiedAt: 1791000000 },
    { name: "weird\tname", type: "symlink", size: 4, modifiedAt: 2 },
  ]);
});

test("terminal tickets are single-use, expire, and never exceed 30 seconds", () => {
  let now = 1_000_000;
  const store = new TicketStore({ ttlSeconds: 300, now: () => now });
  const binding = { owner: "o", community: "c", workspaceId: "dev" };
  const first = store.issue(binding);
  assert.equal(first.expiresAt, Math.floor((now + 30_000) / 1000));
  assert.deepEqual({ ...store.consume(first.ticket), expiresAt: 0 }, { ...binding, expiresAt: 0 });
  assert.equal(store.consume(first.ticket), null);
  const second = store.issue(binding);
  now += 30_001;
  assert.equal(store.consume(second.ticket), null);
  const third = store.issue(binding);
  store.revokeWhere((entry) => entry.owner === "o");
  assert.equal(store.consume(third.ticket), null);
  assert.equal(store.consume(undefined), null);
});

test("agent configs are validated and PATCH merges over the previous config", () => {
  const defaults = { model: "buzz-synthetic-echo" };
  const created = normalizeAgentConfig({}, {}, defaults);
  assert.deepEqual(created, {
    model: "buzz-synthetic-echo",
    respondTo: "owner-only",
    respondToAllowlist: [],
    channels: [],
    channelAddPolicy: "owner_only",
    parallelism: 1,
  });
  const patched = normalizeAgentConfig({ respondTo: "allowlist", respondToAllowlist: ["c".repeat(64)] }, created, defaults);
  assert.equal(patched.model, "buzz-synthetic-echo");
  assert.deepEqual(patched.respondToAllowlist, ["c".repeat(64)]);
  assert.throws(() => normalizeAgentConfig({ respondTo: "everyone" }, created, defaults), HttpError);
  assert.throws(() => normalizeAgentConfig({ channels: ["a,b"] }, created, defaults), HttpError);
  assert.throws(() => normalizeAgentConfig({ parallelism: 0 }, created, defaults), HttpError);
  assert.throws(() => normalizeAgentConfig({ model: "" }, {}, { model: null }), HttpError);
});

test("logs are demultiplexed and secrets redacted", () => {
  const frame = (stream, text) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const secretHex = "f".repeat(64);
  const nsec = `nsec1${"q".repeat(58)}`;
  const lines = parseDockerLogs(
    Buffer.concat([
      frame(1, "2026-10-13T00:00:00Z hello\n"),
      frame(2, `2026-10-13T00:00:01Z \u001b[32mkey=${secretHex} ${nsec}\u001b[0m\n`),
    ]),
  );
  assert.deepEqual(lines[0], { ts: "2026-10-13T00:00:00Z", stream: "stdout", text: "hello" });
  assert.equal(lines[1].stream, "stderr");
  assert.equal(redactSecrets(lines[1].text, [secretHex]), "key=[redacted] [redacted-nsec]");
});

test("MCP errors map to client and upstream classes; call ids are bounded", () => {
  assert.equal(mcpError({ code: -32602, message: "bad params" }).status, 400);
  assert.equal(mcpError({ code: -32000, message: "boom" }).code, "mcp_error");
  assert.equal(isValidCallId("call_1-a"), true);
  assert.equal(isValidCallId("../x"), false);
  assert.equal(isValidCallId("x".repeat(65)), false);
});

test("router distinguishes unknown paths from wrong methods", () => {
  const router = new Router().add("GET", "/v1/workspaces/:id/files", () => "ok");
  const { params } = router.match("GET", "/v1/workspaces/dev%2Dbox/files");
  assert.equal(params.id, "dev-box");
  assert.throws(() => router.match("POST", "/v1/workspaces/dev/files"), (e) => e.status === 405);
  assert.throws(() => router.match("GET", "/v1/nope"), (e) => e.status === 404);
});

test("CORS only reflects exact allowlisted origins", () => {
  const allowed = new Set(["http://127.0.0.1:47509"]);
  assert.equal(corsHeaders("http://127.0.0.1:47509", allowed)["Access-Control-Allow-Origin"], "http://127.0.0.1:47509");
  assert.deepEqual(corsHeaders("http://127.0.0.1:47509.evil.test", allowed), {});
  assert.deepEqual(corsHeaders(undefined, allowed), {});
});

test("configuration refuses the system Docker socket and insecure public URLs", () => {
  const env = {
    PUBLIC_BASE_URL: "https://buzz.example.com/agent-control",
    DOCKER_HOST: "unix:///run/user/1000/docker.sock",
    GRANTS_FILE: "/etc/buzz/grants.json",
    STATE_DIR: "/var/lib/buzz/state",
    DATA_ROOT: "/var/lib/buzz/data",
    BUZZ_BIN_DIR: "/opt/buzz/bin",
  };
  assert.equal(loadConfig(env).dockerSocket, "/run/user/1000/docker.sock");
  assert.throws(() => loadConfig({ ...env, DOCKER_HOST: "unix:///var/run/docker.sock" }));
  assert.throws(() => loadConfig({ ...env, DOCKER_HOST: "tcp://0.0.0.0:2375" }));
  assert.throws(() => loadConfig({ ...env, PUBLIC_BASE_URL: "http://buzz.example.com" }));
  assert.equal(loadConfig({ ...env, PUBLIC_BASE_URL: "http://127.0.0.1:47410" }).listenHost, "127.0.0.1");
  assert.throws(() => loadConfig({ ...env, ALLOWED_ORIGINS: "http://127.0.0.1:47509/app" }));
});
