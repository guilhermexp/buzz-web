import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { AgentService } from "./agents.mjs";
import { loadConfig } from "./config.mjs";
import { ContainerRuntime } from "./docker.mjs";
import { CAPABILITIES, GrantStore, grantAllows } from "./grants.mjs";
import { corsHeaders, Router, securityHeaders, sendError, sendJson } from "./http.mjs";
import {
  HttpError,
  normalizeRelayUrl,
  parseJsonObject,
  pruneSeenEventIds,
  readRequestBody,
  verifyNip98Request,
} from "./lib.mjs";
import { McpService } from "./mcp.mjs";
import { StateStore } from "./state.mjs";
import { TerminalService, TicketStore } from "./terminal.mjs";
import { MAX_FILE_BYTES, WorkspaceService } from "./workspaces.mjs";

const config = loadConfig();
const log = {
  info: (message) => console.log(`[agent-control] ${message}`),
  error: (message) => console.error(`[agent-control] ${message}`),
};

const runtime = new ContainerRuntime({
  socketPath: config.dockerSocket,
  runtimeDir: new URL("./runtime", import.meta.url).pathname,
  binDir: config.binDir,
  limits: config.limits,
});
await runtime.ensureImage(log);
const state = new StateStore(config.stateDir);
const workspaces = new WorkspaceService({ runtime, state, dataRoot: config.dataRoot, log });
const terminals = new TerminalService({
  runtime,
  reconnectSeconds: config.terminal.reconnectSeconds,
  maxSeconds: config.terminal.maxSeconds,
  log,
});
const tickets = new TicketStore({ ttlSeconds: config.terminal.ticketSeconds });
const mcp = new McpService({ runtime, log });
const agents = new AgentService({
  runtime,
  state,
  dataRoot: config.dataRoot,
  socketRoot: config.socketRoot,
  llm: config.llm,
  log,
});
const seenEventIds = new Map();
/** Every owner|community|capability granted since start: losing one is a revocation. */
const everGranted = new Set();

function capabilityKey(owner, community, capability) {
  return `${owner}|${community}|${capability}`;
}

async function enforceGrants(store) {
  for (const grant of store.grants.values()) {
    for (const capability of grant.capabilities) {
      everGranted.add(capabilityKey(grant.owner, grant.community, capability));
    }
  }
  const lost = (capability) => (item) =>
    !store.allows(item.owner, item.community, capability, item.workspaceId ?? item.id);
  tickets.revokeWhere(lost("terminal"));
  const killed = await terminals.terminateWhere(lost("terminal"), "revoked");
  const closed = await mcp.closeWhere(lost("mcp"), "revoked", "Grant revoked");
  const stopped = await agents.stopWhere(
    (record) => !store.allows(record.owner, record.community, "agents"),
  );
  if (killed || closed || stopped) {
    log.info(`revocation: ${killed} terminal(s), ${closed} MCP session(s), ${stopped} agent(s) stopped`);
  }
}

const grants = new GrantStore(config.grantsFile, {
  onChange: (store) => {
    enforceGrants(store).catch((error) => log.error(`grant enforcement failed: ${error.message}`));
  },
  log,
});
grants.watch();
await agents.reconcile();

function remoteAddress(request) {
  return (request.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

const WORKSPACE_CAPABILITIES = ["terminal", "files", "mcp"];

function denied(ctx, capabilities, workspaceId) {
  const hasResources = workspaceId
    ? workspaces.exists(ctx.owner, ctx.community, workspaceId)
    : workspaces.records(ctx.owner, ctx.community).length > 0 ||
      agents.records(ctx.owner, ctx.community).length > 0;
  const revoked =
    capabilities.some((capability) =>
      everGranted.has(capabilityKey(ctx.owner, ctx.community, capability)),
    ) ||
    (!ctx.grant && hasResources);
  return revoked
    ? new HttpError(403, "revoked", "Authority for this operation was revoked")
    : new HttpError(403, "forbidden", "No operator grant covers this operation");
}

/** Re-read the live grant and require one of `capabilities` (for `workspaceId`, if given). */
function requireCapability(ctx, capability, workspaceId) {
  const capabilities = Array.isArray(capability) ? capability : [capability];
  const current = grants.lookup(ctx.owner, ctx.community);
  ctx.grant = current;
  if (!capabilities.some((item) => grantAllows(current, item, workspaceId))) {
    throw denied(ctx, capabilities, workspaceId);
  }
}

function authenticate(request, body) {
  pruneSeenEventIds(seenEventIds);
  const owner = verifyNip98Request({
    authorization: request.headers.authorization,
    method: request.method,
    url: `${config.publicBaseUrl}${request.url}`,
    body,
    seenEventIds,
  });
  const relay = new URL(request.url, "http://agent-control.invalid").searchParams.get("relay");
  const community = normalizeRelayUrl(relay);
  if (!community) throw new HttpError(400, "bad_request", "relay query parameter is required");
  return { owner, community, grant: grants.lookup(owner, community) };
}

function grantView(grant) {
  return {
    capabilities: CAPABILITIES.filter((capability) => grant.capabilities.has(capability)),
    workspaces: grant.workspaces === "*" ? ["*"] : [...grant.workspaces],
    maxWorkspaces: grant.maxWorkspaces,
    maxAgents: grant.maxAgents,
  };
}

function workspaceFor(ctx, id, capability) {
  requireCapability(ctx, capability, id);
  return workspaces.get(ctx.owner, ctx.community, id);
}

const router = new Router()
  .add("GET", "/v1/grant", (ctx) => {
    if (!ctx.grant) throw denied(ctx, CAPABILITIES);
    return { grant: grantView(ctx.grant) };
  })
  .add("GET", "/v1/agents", async (ctx) => {
    requireCapability(ctx, "agents");
    return { agents: await agents.list(ctx.owner, ctx.community) };
  })
  .add("POST", "/v1/agents", (ctx, _params, body) => {
    requireCapability(ctx, "agents");
    return [201, agents.create(ctx.owner, ctx.community, ctx.grant, parseJsonObject(body))];
  })
  .add("GET", "/v1/agents/:pubkey", async (ctx, { pubkey }) => {
    requireCapability(ctx, "agents");
    return { agent: await agents.describe(agents.get(ctx.owner, ctx.community, pubkey)) };
  })
  .add("PATCH", "/v1/agents/:pubkey", async (ctx, { pubkey }, body) => {
    requireCapability(ctx, "agents");
    const record = agents.get(ctx.owner, ctx.community, pubkey);
    return { agent: await agents.update(record, parseJsonObject(body)) };
  })
  .add("DELETE", "/v1/agents/:pubkey", async (ctx, { pubkey }) => {
    requireCapability(ctx, "agents");
    await agents.remove(agents.get(ctx.owner, ctx.community, pubkey));
    return { deleted: true };
  })
  .add("POST", "/v1/agents/:pubkey/:action", async (ctx, { pubkey, action }, body) => {
    requireCapability(ctx, "agents");
    const record = agents.get(ctx.owner, ctx.community, pubkey);
    if (action === "authorize") {
      return { agent: await agents.authorize(record, parseJsonObject(body).authTag) };
    }
    if (action === "start") return { agent: await agents.start(record) };
    if (action === "stop") return { agent: await agents.stop(record) };
    if (action === "restart") return { agent: await agents.restart(record) };
    throw new HttpError(404, "not_found", "Unknown agent action");
  })
  .add("GET", "/v1/agents/:pubkey/logs", async (ctx, { pubkey }, _body, url) => {
    requireCapability(ctx, "agents");
    const record = agents.get(ctx.owner, ctx.community, pubkey);
    return { lines: await agents.logs(record, url.searchParams.get("tail")) };
  })
  .add("GET", "/v1/workspaces", async (ctx) => {
    requireCapability(ctx, WORKSPACE_CAPABILITIES);
    return { workspaces: await workspaces.list(ctx.owner, ctx.community) };
  })
  .add("POST", "/v1/workspaces", async (ctx, _params, body) => {
    const input = parseJsonObject(body);
    requireCapability(ctx, WORKSPACE_CAPABILITIES, typeof input.id === "string" ? input.id : "");
    return [201, { workspace: await workspaces.create(ctx.owner, ctx.community, ctx.grant, input) }];
  })
  .add("DELETE", "/v1/workspaces/:id", async (ctx, { id }) => {
    requireCapability(ctx, WORKSPACE_CAPABILITIES, id);
    const record = workspaces.get(ctx.owner, ctx.community, id);
    const match = (item) =>
      (item.workspaceId ?? item.id) === id &&
      item.owner === ctx.owner &&
      item.community === ctx.community;
    await terminals.terminateWhere(match, "deleted");
    await mcp.closeWhere(match, "mcp_unavailable", "Workspace deleted");
    await workspaces.remove(record);
    return { deleted: true };
  })
  .add("POST", "/v1/workspaces/:id/terminal-tickets", async (ctx, { id }) => {
    const record = workspaceFor(ctx, id, "terminal");
    await workspaces.ensureRunning(record);
    return [201, tickets.issue({ owner: ctx.owner, community: ctx.community, workspaceId: record.id })];
  })
  .add("GET", "/v1/workspaces/:id/files", async (ctx, { id }, _body, url) => {
    const record = workspaceFor(ctx, id, "files");
    return workspaces.listFiles(record, url.searchParams.get("path"));
  })
  .add("GET", "/v1/workspaces/:id/file", async (ctx, { id }, _body, url) => {
    const record = workspaceFor(ctx, id, "files");
    const file = await workspaces.readFile(record, url.searchParams.get("path"));
    return {
      raw: file.bytes,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      },
    };
  })
  .add("PUT", "/v1/workspaces/:id/file", async (ctx, { id }, body, url) => {
    const record = workspaceFor(ctx, id, "files");
    return workspaces.writeFile(record, url.searchParams.get("path"), body);
  })
  .add("DELETE", "/v1/workspaces/:id/file", async (ctx, { id }, _body, url) => {
    const record = workspaceFor(ctx, id, "files");
    return workspaces.deleteFile(record, url.searchParams.get("path"));
  })
  .add("GET", "/v1/workspaces/:id/mcp/tools", async (ctx, { id }) => {
    const record = workspaceFor(ctx, id, "mcp");
    await workspaces.ensureRunning(record);
    return { tools: await mcp.listTools(record) };
  })
  .add("POST", "/v1/workspaces/:id/mcp/calls", async (ctx, { id }, body) => {
    const record = workspaceFor(ctx, id, "mcp");
    await workspaces.ensureRunning(record);
    const input = parseJsonObject(body);
    const result = await mcp.call(record, input);
    return { callId: input.callId, result };
  })
  .add("POST", "/v1/workspaces/:id/mcp/calls/:callId/cancel", async (ctx, { id, callId }) => {
    const record = workspaceFor(ctx, id, "mcp");
    if (!mcp.cancel(record, callId)) throw new HttpError(404, "not_found", "No such running call");
    return { cancelled: true };
  });

function isFileUpload(request, pathname) {
  return request.method === "PUT" && /^\/v1\/workspaces\/[^/]+\/file$/.test(pathname);
}

async function handle(request, response) {
  const url = new URL(request.url || "/", "http://agent-control.invalid");
  const cors = corsHeaders(request.headers.origin, config.allowedOrigins);
  if (config.trustedProxies.size && !config.trustedProxies.has(remoteAddress(request))) {
    throw new HttpError(403, "untrusted_proxy", "Untrusted proxy");
  }
  if (request.method === "OPTIONS") {
    response.writeHead(cors["Access-Control-Allow-Origin"] ? 204 : 403, { ...securityHeaders(), ...cors });
    response.end();
    return;
  }
  if (request.headers.origin && !cors["Access-Control-Allow-Origin"]) {
    throw new HttpError(403, "origin_not_allowed", "Origin is not allowed");
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { status: "ok" }, cors);
    return;
  }
  const { handler, params } = router.match(request.method, url.pathname);
  const body = await readRequestBody(request, isFileUpload(request, url.pathname) ? MAX_FILE_BYTES : 64 * 1024);
  const ctx = authenticate(request, body);
  const result = await handler(ctx, params, body, url);
  if (result?.raw) {
    response.writeHead(200, {
      ...securityHeaders(),
      ...cors,
      ...result.headers,
      "Content-Length": result.raw.length,
    });
    response.end(result.raw);
    return;
  }
  const [status, value] = Array.isArray(result) ? result : [200, result];
  sendJson(response, status, value, cors);
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    if (!(error instanceof HttpError)) log.error(`request failed: ${error?.stack ?? error}`);
    sendError(response, error, corsHeaders(request.headers.origin, config.allowedOrigins));
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

function rejectUpgrade(socket, status, code) {
  const body = JSON.stringify({ error: { code, message: code } });
  socket.end(
    `HTTP/1.1 ${status} ${code}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://agent-control.invalid");
  const match = /^\/v1\/workspaces\/([^/]+)\/terminal$/.exec(url.pathname);
  if (!match) return rejectUpgrade(socket, 404, "not_found");
  if (config.trustedProxies.size && !config.trustedProxies.has(remoteAddress(request))) {
    return rejectUpgrade(socket, 403, "untrusted_proxy");
  }
  const origin = request.headers.origin;
  if (origin && !config.allowedOrigins.has(origin)) return rejectUpgrade(socket, 403, "origin_not_allowed");
  const binding = tickets.consume(url.searchParams.get("ticket"));
  const workspaceId = decodeURIComponent(match[1]);
  if (!binding || binding.workspaceId !== workspaceId) return rejectUpgrade(socket, 401, "invalid_ticket");
  const ctx = { owner: binding.owner, community: binding.community, grant: null };
  try {
    requireCapability(ctx, "terminal", workspaceId);
  } catch (error) {
    return rejectUpgrade(socket, 403, error.code);
  }
  let record;
  try {
    record = workspaces.get(ctx.owner, ctx.community, workspaceId);
  } catch {
    return rejectUpgrade(socket, 404, "not_found");
  }
  const sessionId = url.searchParams.get("session");
  let existing = null;
  if (sessionId) {
    existing = terminals.findReconnectable(sessionId, { ...ctx, workspaceId });
    if (!existing) return rejectUpgrade(socket, 410, "session_gone");
  } else {
    const live = [...terminals.sessions.values()].filter((session) => session.owner === ctx.owner);
    if (live.length >= config.terminal.maxPerOwner) return rejectUpgrade(socket, 429, "too_many_sessions");
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    if (existing) {
      terminals.attach(existing, ws);
      return;
    }
    terminals
      .open({
        ...ctx,
        record,
        cols: url.searchParams.get("cols"),
        rows: url.searchParams.get("rows"),
      })
      .then((session) => {
        if (ws.readyState !== ws.OPEN) {
          void terminals.terminate(session, "detached");
          return;
        }
        terminals.attach(session, ws);
      })
      .catch((error) => {
        log.error(`terminal open failed: ${error.message}`);
        ws.send(JSON.stringify({ type: "exit", code: null, reason: "start_failed" }));
        ws.close(1011, "start_failed");
      });
  });
});

server.listen(config.listenPort, config.listenHost, () => {
  log.info(`listening on ${config.listenHost}:${config.listenPort} (image ${runtime.image})`);
});
