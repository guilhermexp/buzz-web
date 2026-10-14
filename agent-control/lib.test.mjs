import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  agentAuthChallenge,
  HttpError,
  normalizeRelayUrl,
  sha256Hex,
  verifyAgentAuthTag,
  verifyNip98Request,
} from "./lib.mjs";
import { ReplayStore } from "./replay.mjs";

const NOW = 1_800_000_000;
const URL_A = "http://127.0.0.1:47410/v1/workspaces?relay=ws%3A%2F%2F127.0.0.1%3A47300";

function header({ secretKey, url = URL_A, method = "GET", body = "", createdAt = NOW, tags }) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: createdAt,
      content: "",
      tags: tags ?? [
        ["u", url],
        ["method", method],
        ["payload", sha256Hex(body)],
        ["nonce", `n-${Math.random()}`],
      ],
    },
    secretKey,
  );
  return { event, value: `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}` };
}

function verify(value, overrides = {}) {
  return verifyNip98Request({
    authorization: value,
    method: "GET",
    url: URL_A,
    body: Buffer.alloc(0),
    seenEventIds: new Map(),
    nowSeconds: NOW,
    ...overrides,
  });
}

const rejects = (status, code) => (error) =>
  error instanceof HttpError && error.status === status && error.code === code;

function withStateDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "replay-"));
  try {
    return run(join(dir, "replay.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("accepts a fresh signed request once and rejects its replay", () => {
  const secretKey = generateSecretKey();
  const { value } = header({ secretKey });
  const seenEventIds = new Map();
  assert.equal(verify(value, { seenEventIds }), getPublicKey(secretKey));
  assert.throws(() => verify(value, { seenEventIds }), rejects(409, "replayed"));
});

test("replay rejection survives a restart (new store over the same state dir)", () => {
  withStateDir((path) => {
    const secretKey = generateSecretKey();
    const { event, value } = header({ secretKey });
    const before = new ReplayStore(path, { now: () => NOW });
    assert.equal(verify(value, { seenEventIds: before }), getPublicKey(secretKey));
    const afterRestart = new ReplayStore(path, { now: () => NOW + 30 });
    assert.equal(afterRestart.has(event.id), true);
    assert.throws(
      () => verify(value, { seenEventIds: afterRestart, nowSeconds: NOW + 30 }),
      rejects(409, "replayed"),
    );
    // Past the freshness window the id is pruned on load: the event is rejected as expired anyway.
    const later = new ReplayStore(path, { now: () => NOW + 61 });
    assert.equal(later.has(event.id), false);
    assert.throws(() => verify(value, { seenEventIds: later, nowSeconds: NOW + 61 }), rejects(401, "unauthorized"));
  });
});

test("the durable replay cache fails closed and stays bounded", () => {
  withStateDir((path) => {
    writeFileSync(path, "{ not json");
    assert.throws(() => new ReplayStore(path));
    writeFileSync(path, JSON.stringify({ version: 1, entries: [["zz", 1]] }));
    assert.throws(() => new ReplayStore(path));
    writeFileSync(path, JSON.stringify({ version: 1, entries: [] }));
    chmodSync(path, 0o000);
    if (process.getuid?.() !== 0) assert.throws(() => new ReplayStore(path));
    chmodSync(path, 0o600);

    const store = new ReplayStore(path, { maxEntries: 2, now: () => NOW });
    store.set("a".repeat(64), NOW + 10);
    store.set("b".repeat(64), NOW + 10);
    assert.throws(() => store.set("c".repeat(64), NOW + 10), rejects(503, "replay_capacity"));
    assert.equal(store.has("c".repeat(64)), false);
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(persisted.entries.map(([id]) => id[0]), ["a", "b"]);
    const pruning = new ReplayStore(path, { maxEntries: 2, now: () => NOW + 11 });
    pruning.set("c".repeat(64), NOW + 70);
    assert.equal(pruning.size, 1);
  });
});

test("binds the exact URL including the community query", () => {
  const secretKey = generateSecretKey();
  const other = URL_A.replace("47300", "47320");
  assert.throws(() => verify(header({ secretKey, url: other }).value), rejects(401, "unauthorized"));
});

test("binds method and body digest, including the empty body of a GET", () => {
  const secretKey = generateSecretKey();
  assert.throws(
    () => verify(header({ secretKey, method: "POST" }).value),
    rejects(401, "unauthorized"),
  );
  const body = Buffer.from('{"id":"dev"}');
  const { value } = header({ secretKey, method: "POST", body: body.toString() });
  assert.throws(
    () => verify(value, { method: "POST", body: Buffer.from('{"id":"other"}') }),
    rejects(401, "unauthorized"),
  );
  assert.equal(verify(value, { method: "POST", body }), getPublicKey(secretKey));
});

test("rejects stale and future-dated authorizations", () => {
  const secretKey = generateSecretKey();
  assert.throws(() => verify(header({ secretKey, createdAt: NOW - 61 }).value), rejects(401, "unauthorized"));
  assert.throws(() => verify(header({ secretKey, createdAt: NOW + 61 }).value), rejects(401, "unauthorized"));
});

test("requires a nonce and exactly one of each binding tag", () => {
  const secretKey = generateSecretKey();
  const base = [
    ["u", URL_A],
    ["method", "GET"],
    ["payload", sha256Hex("")],
  ];
  assert.throws(() => verify(header({ secretKey, tags: base }).value), rejects(401, "unauthorized"));
  const doubled = [...base, ["nonce", "a"], ["u", URL_A]];
  assert.throws(() => verify(header({ secretKey, tags: doubled }).value), rejects(401, "unauthorized"));
});

test("rejects tampered events and wrong kinds", () => {
  const secretKey = generateSecretKey();
  const { event } = header({ secretKey });
  const tampered = { ...event, created_at: event.created_at + 1 };
  const encoded = `Nostr ${Buffer.from(JSON.stringify(tampered)).toString("base64")}`;
  assert.throws(() => verify(encoded), rejects(401, "unauthorized"));
  assert.throws(() => verify("Bearer abc"), rejects(401, "unauthorized"));
});

test("verifies only unconditional NIP-OA tags signed by the owner for that agent", () => {
  const ownerKey = generateSecretKey();
  const owner = getPublicKey(ownerKey);
  const agent = getPublicKey(generateSecretKey());
  const digest = createHash("sha256").update(agentAuthChallenge(agent)).digest();
  const sig = bytesToHex(schnorr.sign(new Uint8Array(digest), ownerKey));
  assert.deepEqual(verifyAgentAuthTag(["auth", owner, "", sig], { ownerHex: owner, agentHex: agent }), [
    "auth",
    owner,
    "",
    sig,
  ]);
  const otherAgent = getPublicKey(generateSecretKey());
  assert.throws(
    () => verifyAgentAuthTag(["auth", owner, "", sig], { ownerHex: owner, agentHex: otherAgent }),
    rejects(400, "invalid_auth_tag"),
  );
  const stranger = getPublicKey(generateSecretKey());
  assert.throws(
    () => verifyAgentAuthTag(["auth", owner, "", sig], { ownerHex: stranger, agentHex: agent }),
    rejects(400, "invalid_auth_tag"),
  );
  assert.throws(
    () => verifyAgentAuthTag(["auth", owner, "kind=1", sig], { ownerHex: owner, agentHex: agent }),
    rejects(400, "invalid_auth_tag"),
  );
});

test("normalizes community relay URLs and rejects non-websocket or decorated URLs", () => {
  assert.equal(normalizeRelayUrl("ws://127.0.0.1:47300/"), "ws://127.0.0.1:47300");
  assert.equal(normalizeRelayUrl("wss://relay.example.com"), "wss://relay.example.com");
  assert.equal(normalizeRelayUrl("https://relay.example.com"), null);
  assert.equal(normalizeRelayUrl("wss://u:p@relay.example.com"), null);
  assert.equal(normalizeRelayUrl("wss://relay.example.com/?x=1"), null);
  assert.equal(normalizeRelayUrl(""), null);
});
