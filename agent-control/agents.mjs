import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { nip19 } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { MANAGED_LABEL } from "./docker.mjs";
import { agentAuthChallenge, HttpError, PUBKEY_PATTERN, sha256Hex, verifyAgentAuthTag } from "./lib.mjs";
import { communityKey, removeEmptyDir } from "./workspaces.mjs";

const RESPOND_TO = ["owner-only", "allowlist", "anyone", "nobody"];
const CHANNEL_ADD_POLICIES = ["anyone", "owner_only", "nobody"];
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

function stringField(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, "bad_request", `${label} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) {
    throw new HttpError(400, "bad_request", `${label} must be a string of at most ${max} characters`);
  }
  return value;
}

/** Validate and normalize an agent config, merged over `previous` (PATCH semantics). */
export function normalizeAgentConfig(input, previous, defaults) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "bad_request", "config must be an object");
  }
  const merged = { ...previous, ...input };
  const model = stringField(merged.model, "config.model", 128) ?? defaults.model;
  if (!model) throw new HttpError(400, "bad_request", "config.model is required");
  const respondTo = merged.respondTo ?? "owner-only";
  if (!RESPOND_TO.includes(respondTo)) {
    throw new HttpError(400, "bad_request", `config.respondTo must be one of ${RESPOND_TO.join(", ")}`);
  }
  const allowlist = merged.respondToAllowlist ?? [];
  if (!Array.isArray(allowlist) || allowlist.length > 64 || allowlist.some((p) => !PUBKEY_PATTERN.test(p))) {
    throw new HttpError(400, "bad_request", "config.respondToAllowlist must be hex pubkeys");
  }
  const channels = merged.channels ?? [];
  if (!Array.isArray(channels) || channels.length > 64 || channels.some((c) => !CHANNEL_PATTERN.test(c))) {
    throw new HttpError(400, "bad_request", "config.channels must be channel ids");
  }
  const channelAddPolicy = merged.channelAddPolicy ?? "owner_only";
  if (!CHANNEL_ADD_POLICIES.includes(channelAddPolicy)) {
    throw new HttpError(400, "bad_request", "config.channelAddPolicy is invalid");
  }
  const parallelism = merged.parallelism ?? 1;
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 8) {
    throw new HttpError(400, "bad_request", "config.parallelism must be 1-8");
  }
  const config = {
    model,
    respondTo,
    respondToAllowlist: [...new Set(allowlist)],
    channels: [...new Set(channels)],
    channelAddPolicy,
    parallelism,
  };
  const personaRef = stringField(merged.personaRef, "config.personaRef", 256);
  const systemPrompt = stringField(merged.systemPrompt, "config.systemPrompt", 16_000);
  if (personaRef) config.personaRef = personaRef;
  if (systemPrompt) config.systemPrompt = systemPrompt;
  return config;
}

/** Replace every configured secret and any bech32 private key with a redaction marker. */
export function redactSecrets(text, secrets) {
  let output = text.replace(/nsec1[02-9ac-hj-np-z]{20,}/g, "[redacted-nsec]");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) output = output.split(secret).join("[redacted]");
  }
  return output;
}

/** Split a non-TTY `docker logs` buffer (8-byte multiplexed frames) into timestamped lines. */
export function parseDockerLogs(buffer) {
  const lines = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset] === 2 ? "stderr" : "stdout";
    const size = buffer.readUInt32BE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + size).toString("utf8");
    offset += 8 + size;
    for (const raw of chunk.split("\n")) {
      if (!raw) continue;
      const space = raw.indexOf(" ");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colour escapes
      const text = raw.slice(space + 1).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
      lines.push({ ts: raw.slice(0, space), stream, text });
    }
  }
  return lines;
}

function loopbackTarget(rawUrl) {
  const url = new URL(rawUrl);
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  const secure = url.protocol === "wss:" || url.protocol === "https:";
  const port = Number.parseInt(url.port || (secure ? "443" : "80"), 10);
  return { host: "127.0.0.1", port };
}

function relayHttpOrigin(relayUrl) {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

/** Managed agents: one contained buzz-acp + buzz-agent + buzz-dev-mcp per agent key. */
export class AgentService {
  constructor({ runtime, state, dataRoot, socketRoot, llm, log = console, fetchImpl = fetch }) {
    this.runtime = runtime;
    this.state = state;
    this.dataRoot = dataRoot;
    this.socketRoot = socketRoot;
    this.llm = llm;
    this.log = log;
    this.fetch = fetchImpl;
    this.forwarders = new Map();
  }

  records(owner, community) {
    return Object.values(this.state.agents).filter(
      (record) => record.owner === owner && record.community === community,
    );
  }

  all() {
    return Object.values(this.state.agents);
  }

  get(owner, community, pubkey) {
    const record = this.state.agents[String(pubkey).toLowerCase()];
    if (!record || record.owner !== owner || record.community !== community) {
      throw new HttpError(404, "not_found", "Agent not found");
    }
    return record;
  }

  dataDir(record) {
    return join(this.dataRoot, record.owner, communityKey(record.community), "_agents", record.pubkey);
  }

  socketDir(record) {
    return join(this.socketRoot, record.pubkey.slice(0, 16));
  }

  async describe(record) {
    const info = await this.runtime.inspect(record.container);
    let status = "stopped";
    let lastExit = record.lastExit;
    if (info) {
      const state = info.State;
      if (state.Restarting || state.Status === "created") status = "starting";
      else if (state.Running) status = "running";
      else {
        status = record.desired === "running" ? "error" : "stopped";
        if (state.FinishedAt && !state.FinishedAt.startsWith("0001")) {
          lastExit = {
            code: state.ExitCode,
            at: Math.floor(Date.parse(state.FinishedAt) / 1000),
            ...(state.OOMKilled ? { reason: "oom" } : state.Error ? { reason: state.Error } : {}),
          };
        }
      }
    } else if (record.desired === "running") {
      status = "error";
    }
    return {
      pubkey: record.pubkey,
      name: record.name,
      status,
      authorized: record.authorized,
      config: record.config,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(lastExit ? { lastExit } : {}),
    };
  }

  async list(owner, community) {
    const records = this.records(owner, community).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(records.map((record) => this.describe(record)));
  }

  create(owner, community, grant, input) {
    const name = stringField(input.name, "name", 64, { required: true }).trim();
    if (!name) throw new HttpError(400, "bad_request", "name is required");
    if (this.records(owner, community).length >= grant.maxAgents) {
      throw new HttpError(409, "quota_exceeded", "Agent limit reached for this grant");
    }
    const config = normalizeAgentConfig(input.config ?? {}, {}, { model: this.llm.defaultModel });
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    const now = Math.floor(Date.now() / 1000);
    this.state.writeSecret(pubkey, { secretKeyHex: bytesToHex(secretKey), authTag: null });
    this.state.agents[pubkey] = {
      pubkey,
      owner,
      community,
      name,
      config,
      container: `buzz-agent-${pubkey.slice(0, 16)}`,
      desired: "stopped",
      authorized: false,
      createdAt: now,
      updatedAt: now,
    };
    this.state.save();
    return { pubkey, authChallenge: agentAuthChallenge(pubkey) };
  }

  async authorize(record, authTag) {
    const tag = verifyAgentAuthTag(authTag, { ownerHex: record.owner, agentHex: record.pubkey });
    const secret = this.state.readSecret(record.pubkey);
    this.state.writeSecret(record.pubkey, { ...secret, authTag: tag });
    await this.publishProfile(record, tag);
    record.authorized = true;
    record.updatedAt = Math.floor(Date.now() / 1000);
    this.state.save();
    return this.describe(record);
  }

  async update(record, input) {
    const config =
      input.config === undefined
        ? record.config
        : normalizeAgentConfig(input.config, record.config, { model: this.llm.defaultModel });
    const name = input.name === undefined ? record.name : stringField(input.name, "name", 64, { required: true }).trim();
    const profileChanged = name !== record.name || config.channelAddPolicy !== record.config.channelAddPolicy;
    record.name = name;
    record.config = config;
    record.updatedAt = Math.floor(Date.now() / 1000);
    this.state.save();
    if (record.authorized && profileChanged) {
      await this.publishProfile(record, this.state.readSecret(record.pubkey).authTag);
    }
    // A running agent picks up the new configuration by being recreated.
    const info = await this.runtime.inspect(record.container);
    if (info?.State.Running) return this.restart(record);
    return this.describe(record);
  }

  /** Sign and submit the agent's kind 0 (carrying the NIP-OA tag) and kind 10100 policy. */
  async publishProfile(record, authTag) {
    const secret = hexToBytes(this.state.readSecret(record.pubkey).secretKeyHex);
    const now = Math.floor(Date.now() / 1000);
    const profile = finalizeEvent(
      { kind: 0, created_at: now, tags: [authTag], content: JSON.stringify({ name: record.name, display_name: record.name, bot: true }) },
      secret,
    );
    const policy = finalizeEvent(
      {
        kind: 10100,
        created_at: now,
        tags: [],
        content: JSON.stringify({ channel_add_policy: record.config.channelAddPolicy }),
      },
      secret,
    );
    for (const event of [profile, policy]) await this.submitEvent(record.community, event, secret, authTag);
  }

  async submitEvent(community, event, secret, authTag) {
    const url = `${relayHttpOrigin(community)}/events`;
    const body = JSON.stringify(event);
    const auth = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["u", url],
          ["method", "POST"],
          ["payload", sha256Hex(body)],
        ],
      },
      secret,
    );
    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,
        "Content-Type": "application/json",
        "x-auth-tag": JSON.stringify(authTag),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.accepted === false) {
      const message = typeof result.message === "string" ? result.message : `HTTP ${response.status}`;
      throw new HttpError(502, "relay_rejected", `Relay rejected kind ${event.kind}: ${message}`);
    }
  }

  /** Host-side unix sockets that let the contained agent reach loopback-only upstreams. */
  async ensureForwarders(record) {
    const existing = this.forwarders.get(record.pubkey);
    if (existing) return existing.map((entry) => entry.spec);
    const dir = this.socketDir(record);
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    chmodSync(dir, 0o755);
    const targets = [];
    const relay = loopbackTarget(record.community);
    if (relay) targets.push({ name: "relay", ...relay });
    const llm = this.llm.baseUrl ? loopbackTarget(this.llm.baseUrl) : null;
    if (llm && !(relay && llm.port === relay.port)) targets.push({ name: "llm", ...llm });
    const entries = [];
    for (const target of targets) {
      const path = join(dir, `${target.name}.sock`);
      rmSync(path, { force: true });
      const server = createServer((client) => {
        const upstream = createConnection({ host: target.host, port: target.port });
        client.pipe(upstream).pipe(client);
        client.on("error", () => upstream.destroy());
        upstream.on("error", () => client.destroy());
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, resolve);
      });
      chmodSync(path, 0o666);
      entries.push({ server, spec: target });
    }
    this.forwarders.set(record.pubkey, entries);
    return entries.map((entry) => entry.spec);
  }

  closeForwarders(record) {
    for (const entry of this.forwarders.get(record.pubkey) ?? []) entry.server.close();
    this.forwarders.delete(record.pubkey);
    rmSync(this.socketDir(record), { recursive: true, force: true });
  }

  agentEnv(record, secret) {
    const config = record.config;
    const env = {
      BUZZ_PRIVATE_KEY: nip19.nsecEncode(hexToBytes(secret.secretKeyHex)),
      BUZZ_RELAY_URL: record.community,
      BUZZ_AUTH_TAG: JSON.stringify(secret.authTag),
      BUZZ_ACP_AGENT_COMMAND: "buzz-agent",
      BUZZ_ACP_AGENT_ARGS: "",
      BUZZ_ACP_MCP_COMMAND: "buzz-dev-mcp",
      MCP_HOOK_SERVERS: "*",
      BUZZ_ACP_AGENTS: String(config.parallelism),
      BUZZ_ACP_MULTIPLE_EVENT_HANDLING: "steer",
      BUZZ_ACP_DEDUP: "queue",
      BUZZ_ACP_MODEL: config.model,
      BUZZ_ACP_RESPOND_TO: config.respondTo,
      BUZZ_ACP_RELAY_OBSERVER: "true",
      BUZZ_ACP_SUBSCRIBE: "mentions",
      BUZZ_AGENT_PROVIDER: this.llm.provider,
      BUZZ_AGENT_MODEL: config.model,
      OPENAI_COMPAT_MODEL: config.model,
      OPENAI_COMPAT_API: this.llm.api,
      RUST_LOG: "info",
    };
    if (this.llm.baseUrl) env.OPENAI_COMPAT_BASE_URL = this.llm.baseUrl;
    if (this.llm.apiKey) env.OPENAI_COMPAT_API_KEY = this.llm.apiKey;
    if (config.systemPrompt) env.BUZZ_ACP_SYSTEM_PROMPT = config.systemPrompt;
    if (config.respondToAllowlist.length) {
      env.BUZZ_ACP_RESPOND_TO_ALLOWLIST = config.respondToAllowlist.join(",");
    }
    if (config.channels.length) env.BUZZ_ACP_CHANNELS = config.channels.join(",");
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }

  async createContainer(record) {
    const secret = this.state.readSecret(record.pubkey);
    const forwards = await this.ensureForwarders(record);
    const env = this.agentEnv(record, secret);
    const hash = createHash("sha256").update(JSON.stringify(env)).digest("hex").slice(0, 16);
    const existing = await this.runtime.inspect(record.container);
    if (existing && existing.Config.Labels?.["buzz.config-hash"] === hash) return;
    await this.runtime.removeContainer(record.container);
    const dataDir = this.dataDir(record);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    await this.runtime.chownForContainerUser(dataDir);
    const listeners = forwards
      .map(
        (target) =>
          `socat TCP-LISTEN:${target.port},bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/buzz/${target.name}.sock &`,
      )
      .join(" ");
    await this.runtime.docker.createContainer({
      name: record.container,
      Image: this.runtime.image,
      Cmd: ["/bin/sh", "-c", `${listeners} exec buzz-acp`],
      User: "1000:1000",
      WorkingDir: "/workspace",
      Env: env,
      Labels: { [MANAGED_LABEL]: "agent", "buzz.agent": record.pubkey, "buzz.config-hash": hash },
      HostConfig: this.runtime.hostConfig({
        binds: [`${dataDir}:/workspace`, `${this.socketDir(record)}:/run/buzz:ro`],
        restartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
      }),
    });
  }

  /** Start and report what Docker observed a moment later (crash-on-start shows as error). */
  async start(record) {
    if (!record.authorized) {
      throw new HttpError(409, "not_authorized", "Authorize the agent before starting it");
    }
    await this.createContainer(record);
    const info = await this.runtime.inspect(record.container);
    if (!info.State.Running) await this.runtime.container(record.container).start();
    record.desired = "running";
    record.updatedAt = Math.floor(Date.now() / 1000);
    this.state.save();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const current = await this.runtime.inspect(record.container);
      if (!current?.State.Running) break;
    }
    return this.describe(record);
  }

  async stop(record) {
    record.desired = "stopped";
    record.updatedAt = Math.floor(Date.now() / 1000);
    this.state.save();
    const info = await this.runtime.inspect(record.container);
    if (info?.State.Running || info?.State.Restarting) {
      await this.runtime.container(record.container).stop({ t: 10 }).catch((error) => {
        if (error.statusCode !== 304) throw error;
      });
    }
    return this.describe(record);
  }

  async restart(record) {
    await this.stop(record);
    await this.runtime.removeContainer(record.container);
    return this.start(record);
  }

  async remove(record) {
    await this.runtime.removeContainer(record.container);
    this.closeForwarders(record);
    const dataDir = this.dataDir(record);
    await this.runtime.wipeDir(dataDir).catch((error) => {
      this.log.error?.(`agent data wipe failed: ${error.message}`);
    });
    removeEmptyDir(dataDir);
    this.state.deleteSecret(record.pubkey);
    delete this.state.agents[record.pubkey];
    this.state.save();
  }

  async logs(record, tail) {
    const lines = Math.max(1, Math.min(Number.parseInt(tail ?? "200", 10) || 200, 2000));
    const info = await this.runtime.inspect(record.container);
    if (!info) return [];
    const buffer = await this.runtime.container(record.container).logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: lines,
    });
    const secret = this.state.readSecret(record.pubkey);
    const secrets = [
      secret.secretKeyHex,
      nip19.nsecEncode(hexToBytes(secret.secretKeyHex)),
      secret.authTag?.[3],
      this.llm.apiKey,
    ];
    return parseDockerLogs(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).map((line) => ({
      ...line,
      text: redactSecrets(line.text, secrets),
    }));
  }

  /** After a service restart, re-open sockets for agents Docker may still be running. */
  async reconcile() {
    for (const record of this.all()) {
      if (record.desired !== "running") continue;
      try {
        await this.ensureForwarders(record);
      } catch (error) {
        this.log.error?.(`agent ${record.pubkey.slice(0, 8)} reconcile failed: ${error.message}`);
      }
    }
  }

  async stopWhere(predicate) {
    const targets = this.all().filter((record) => record.desired === "running" && predicate(record));
    for (const record of targets) await this.stop(record);
    return targets.length;
  }
}
