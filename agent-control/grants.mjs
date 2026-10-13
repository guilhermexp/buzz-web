import { readFileSync, statSync } from "node:fs";
import { normalizeRelayUrl, PUBKEY_PATTERN } from "./lib.mjs";

export const CAPABILITIES = Object.freeze(["agents", "terminal", "files", "mcp"]);
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function grantKey(owner, community) {
  return `${owner}\n${community}`;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 64) {
    throw new Error(`${label} must be an integer between 0 and 64`);
  }
  return value;
}

/**
 * Parse the operator grants document:
 * `{"version":1,"owners":{"<owner hex>":{"<relay url>":{"capabilities":[…],"workspaces":["*"|id…],
 * "maxWorkspaces":n,"maxAgents":n}}}}`. Throws on any malformed entry (fail closed).
 */
export function parseGrants(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("grants file must be valid JSON");
  }
  if (!doc || typeof doc !== "object" || doc.version !== 1) {
    throw new Error("grants file must be an object with version 1");
  }
  const owners = doc.owners ?? {};
  if (!owners || typeof owners !== "object" || Array.isArray(owners)) {
    throw new Error("grants.owners must be an object");
  }
  const grants = new Map();
  for (const [ownerValue, communities] of Object.entries(owners)) {
    const owner = ownerValue.toLowerCase();
    if (!PUBKEY_PATTERN.test(owner)) throw new Error(`Invalid owner pubkey: ${ownerValue}`);
    if (!communities || typeof communities !== "object" || Array.isArray(communities)) {
      throw new Error(`grants for ${owner} must map relay URLs to grants`);
    }
    for (const [relayValue, entry] of Object.entries(communities)) {
      const community = normalizeRelayUrl(relayValue);
      if (!community) throw new Error(`Invalid community relay URL: ${relayValue}`);
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.capabilities)) {
        throw new Error(`Grant ${owner} @ ${community} needs a capabilities array`);
      }
      const capabilities = new Set();
      for (const capability of entry.capabilities) {
        if (!CAPABILITIES.includes(capability)) {
          throw new Error(`Unknown capability ${String(capability)} for ${owner}`);
        }
        capabilities.add(capability);
      }
      const rawWorkspaces = entry.workspaces ?? [];
      if (!Array.isArray(rawWorkspaces)) throw new Error(`workspaces for ${owner} must be an array`);
      let workspaces;
      if (rawWorkspaces.includes("*")) {
        workspaces = "*";
      } else {
        workspaces = new Set();
        for (const id of rawWorkspaces) {
          if (typeof id !== "string" || !WORKSPACE_ID_PATTERN.test(id)) {
            throw new Error(`Invalid workspace id ${String(id)} for ${owner}`);
          }
          workspaces.add(id);
        }
      }
      grants.set(grantKey(owner, community), {
        owner,
        community,
        capabilities,
        workspaces,
        maxWorkspaces: positiveInteger(entry.maxWorkspaces, 3, "maxWorkspaces"),
        maxAgents: positiveInteger(entry.maxAgents, 4, "maxAgents"),
      });
    }
  }
  return grants;
}

export function isValidWorkspaceId(id) {
  return typeof id === "string" && WORKSPACE_ID_PATTERN.test(id);
}

/** True when `grant` exists, includes `capability`, and (if given) covers `workspaceId`. */
export function grantAllows(grant, capability, workspaceId) {
  if (!grant || !grant.capabilities.has(capability)) return false;
  if (workspaceId === undefined) return true;
  return grant.workspaces === "*" || grant.workspaces.has(workspaceId);
}

/**
 * Live view of the grants file. Reloads on change (stat polling survives atomic renames);
 * an unreadable or invalid file revokes everything (fail closed). `onChange` runs after
 * every successful or failed reload so callers can terminate sessions that lost authority.
 */
export class GrantStore {
  constructor(path, { onChange = () => {}, log = console, pollMs = 500 } = {}) {
    this.path = path;
    this.onChange = onChange;
    this.log = log;
    this.pollMs = pollMs;
    this.grants = new Map();
    this.reload();
  }

  /** Identity of the file version last loaded (missing file = null). */
  fingerprint() {
    try {
      const stat = statSync(this.path);
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  }

  reload() {
    this.loaded = this.fingerprint();
    try {
      this.grants = parseGrants(readFileSync(this.path, "utf8"));
      this.log.info?.(`grants loaded: ${this.grants.size} owner/community grant(s)`);
    } catch (error) {
      this.grants = new Map();
      this.log.error?.(`grants rejected, all access revoked: ${error.message}`);
    }
    this.onChange(this);
  }

  watch() {
    this.timer = setInterval(() => {
      if (this.fingerprint() !== this.loaded) this.reload();
    }, this.pollMs);
    this.timer.unref?.();
  }

  close() {
    clearInterval(this.timer);
  }

  lookup(owner, community) {
    return this.grants.get(grantKey(owner, community)) ?? null;
  }

  allows(owner, community, capability, workspaceId) {
    return grantAllows(this.lookup(owner, community), capability, workspaceId);
  }
}
