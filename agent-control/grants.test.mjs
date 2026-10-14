import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GrantStore, grantAllows, parseGrants } from "./grants.mjs";

const OWNER = "a".repeat(64);
const OTHER = "b".repeat(64);
const RELAY_A = "ws://127.0.0.1:47300";
const RELAY_B = "ws://127.0.0.1:47320";

function doc(owners) {
  return JSON.stringify({ version: 1, owners });
}

test("grants bind owner, community, capability and workspace", () => {
  const grants = parseGrants(
    doc({
      [OWNER]: {
        [`${RELAY_A}/`]: { capabilities: ["terminal", "files"], workspaces: ["dev"] },
        [RELAY_B]: { capabilities: ["mcp"], workspaces: ["*"], maxWorkspaces: 1 },
      },
    }),
  );
  const a = grants.get(`${OWNER}\n${RELAY_A}`);
  assert.equal(grantAllows(a, "terminal", "dev"), true);
  assert.equal(grantAllows(a, "terminal", "other"), false);
  assert.equal(grantAllows(a, "mcp", "dev"), false);
  assert.equal(grantAllows(a, "files"), true);
  const b = grants.get(`${OWNER}\n${RELAY_B}`);
  assert.equal(grantAllows(b, "mcp", "anything"), true);
  assert.equal(b.maxWorkspaces, 1);
  assert.equal(grants.get(`${OTHER}\n${RELAY_A}`), undefined);
  assert.equal(grantAllows(undefined, "files"), false);
});

test("malformed grants are rejected as a whole", () => {
  assert.throws(() => parseGrants("{"));
  assert.throws(() => parseGrants(JSON.stringify({ version: 2, owners: {} })));
  assert.throws(() => parseGrants(doc({ nope: {} })));
  assert.throws(() => parseGrants(doc({ [OWNER]: { "https://x": { capabilities: [] } } })));
  assert.throws(() => parseGrants(doc({ [OWNER]: { [RELAY_A]: { capabilities: ["root"] } } })));
  assert.throws(() =>
    parseGrants(doc({ [OWNER]: { [RELAY_A]: { capabilities: ["files"], workspaces: ["../x"] } } })),
  );
});

test("the live store reloads atomically replaced files and fails closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grants-"));
  const path = join(dir, "grants.json");
  writeFileSync(path, doc({ [OWNER]: { [RELAY_A]: { capabilities: ["terminal"], workspaces: ["*"] } } }));
  const changes = [];
  const store = new GrantStore(path, {
    pollMs: 20,
    log: {},
    onChange: (current) => changes.push(current.allows(OWNER, RELAY_A, "terminal", "dev")),
  });
  try {
    store.watch();
    assert.equal(store.allows(OWNER, RELAY_A, "terminal", "dev"), true);
    const waitForChange = async (count) => {
      for (let attempt = 0; attempt < 200 && changes.length < count; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    writeFileSync(`${path}.next`, doc({}));
    renameSync(`${path}.next`, path);
    await waitForChange(2);
    assert.equal(store.allows(OWNER, RELAY_A, "terminal", "dev"), false);
    writeFileSync(path, doc({ [OWNER]: { [RELAY_A]: { capabilities: ["terminal"], workspaces: ["*"] } } }));
    await waitForChange(3);
    assert.equal(store.allows(OWNER, RELAY_A, "terminal", "dev"), true);
    writeFileSync(path, "{ not json");
    await waitForChange(4);
    assert.equal(store.allows(OWNER, RELAY_A, "terminal", "dev"), false);
    assert.deepEqual(changes, [true, false, true, false]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
