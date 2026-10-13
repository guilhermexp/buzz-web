import { PassThrough } from "node:stream";
import { HttpError } from "./lib.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Map a JSON-RPC error object to the public error contract. */
export function mcpError(error) {
  const message = typeof error?.message === "string" ? error.message.slice(0, 500) : "MCP error";
  if (error?.code === -32601 || error?.code === -32602 || error?.code === -32600) {
    return new HttpError(400, "mcp_invalid_request", message);
  }
  return new HttpError(502, "mcp_error", message);
}

export function isValidCallId(value) {
  return typeof value === "string" && CALL_ID_PATTERN.test(value);
}

/** One buzz-dev-mcp server over stdio inside a workspace container. */
class McpSession {
  constructor({ runtime, record, log }) {
    this.runtime = runtime;
    this.record = record;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.calls = new Map();
    this.closed = false;
    this.pid = null;
    this.lineBuffer = "";
    this.tools = null;
  }

  async start() {
    const pidFile = "/tmp/.buzz-mcp.pid";
    const { exec, stream } = await this.runtime.execInteractive(
      this.record.container,
      ["/bin/sh", "-c", 'echo $$ >"$1"; exec /opt/buzz/bin/buzz-dev-mcp', "sh", pidFile],
      { tty: false, env: ["RUST_LOG=warn"] },
    );
    this.exec = exec;
    this.stream = stream;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.runtime.demux(stream, stdout, stderr);
    stdout.on("data", (chunk) => this.receive(chunk));
    stderr.on("data", () => {});
    stream.on("end", () => this.fail("mcp_unavailable", "MCP server exited"));
    stream.on("close", () => this.fail("mcp_unavailable", "MCP server exited"));
    stream.on("error", () => this.fail("mcp_unavailable", "MCP server connection failed"));
    const result = await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "buzz-agent-control", version: "0.2.0" },
      },
      REQUEST_TIMEOUT_MS,
    );
    this.notify("notifications/initialized", {});
    const read = await this.runtime.execCollect(this.record.container, ["cat", pidFile]);
    const pid = Number.parseInt(read.stdout.toString("utf8"), 10);
    if (Number.isInteger(pid) && pid > 1) this.pid = pid;
    return result;
  }

  receive(chunk) {
    this.lineBuffer += chunk.toString("utf8");
    if (this.lineBuffer.length > MAX_LINE_BYTES) {
      this.lineBuffer = "";
      this.fail("mcp_error", "MCP server sent an oversized message");
      return;
    }
    let newline = this.lineBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.lineBuffer.slice(0, newline).trim();
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (line) this.dispatch(line);
      newline = this.lineBuffer.indexOf("\n");
    }
  }

  dispatch(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.method) return; // notifications / server requests
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(mcpError(message.error));
    else pending.resolve(message.result);
  }

  send(message) {
    if (this.closed) throw new HttpError(502, "mcp_unavailable", "MCP server is not running");
    this.stream.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeoutMs, onId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (method === "tools/call") {
          this.notify("notifications/cancelled", { requestId: id, reason: "timeout" });
        }
        reject(new HttpError(504, "mcp_timeout", "MCP request timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      onId?.(id);
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async listTools() {
    if (!this.tools) {
      const result = await this.request("tools/list", {}, REQUEST_TIMEOUT_MS);
      this.tools = Array.isArray(result?.tools) ? result.tools : [];
    }
    return this.tools;
  }

  async call(callId, name, args) {
    if (this.calls.has(callId)) throw new HttpError(409, "conflict", "callId is already in use");
    const call = { requestId: null, cancelled: false, reject: null };
    this.calls.set(callId, call);
    try {
      return await new Promise((resolve, reject) => {
        call.reject = reject;
        this.request("tools/call", { name, arguments: args }, CALL_TIMEOUT_MS, (id) => {
          call.requestId = id;
        }).then(resolve, reject);
      });
    } finally {
      this.calls.delete(callId);
    }
  }

  /** Send `notifications/cancelled` and settle the caller's request as cancelled. */
  cancel(callId) {
    const call = this.calls.get(callId);
    if (!call || call.requestId === null) return false;
    call.cancelled = true;
    const pending = this.pending.get(call.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(call.requestId);
    }
    this.notify("notifications/cancelled", { requestId: call.requestId, reason: "Cancelled by user" });
    call.reject(new HttpError(409, "cancelled", "The tool call was cancelled"));
    return true;
  }

  fail(code, message) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new HttpError(code === "revoked" ? 403 : 502, code, message));
    }
    this.pending.clear();
    this.onClosed?.();
  }

  async close(code = "mcp_unavailable", message = "MCP session closed") {
    this.fail(code, message);
    this.stream?.destroy();
    await this.runtime.killSession(this.record.container, this.pid).catch(() => {});
  }
}

/** One lazily started MCP session per workspace, torn down on revocation or deletion. */
export class McpService {
  constructor({ runtime, log = console }) {
    this.runtime = runtime;
    this.log = log;
    this.sessions = new Map();
  }

  key(record) {
    return record.container;
  }

  async session(record) {
    const key = this.key(record);
    let entry = this.sessions.get(key);
    if (!entry) {
      const session = new McpSession({ runtime: this.runtime, record, log: this.log });
      const ready = session.start().then(
        () => session,
        async (error) => {
          await session.close();
          throw error;
        },
      );
      entry = { session, ready, record };
      session.onClosed = () => {
        if (this.sessions.get(key) === entry) this.sessions.delete(key);
      };
      this.sessions.set(key, entry);
    }
    return entry.ready;
  }

  async listTools(record) {
    return (await this.session(record)).listTools();
  }

  async call(record, { callId, name, arguments: args }) {
    if (!isValidCallId(callId)) throw new HttpError(400, "bad_request", "callId must be 1-64 [A-Za-z0-9_-]");
    if (typeof name !== "string" || !name) throw new HttpError(400, "bad_request", "name is required");
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      throw new HttpError(400, "bad_request", "arguments must be an object");
    }
    const session = await this.session(record);
    return session.call(callId, name, args ?? {});
  }

  cancel(record, callId) {
    const entry = this.sessions.get(this.key(record));
    return Boolean(entry && entry.session.cancel(callId));
  }

  async closeWhere(predicate, code, message) {
    const targets = [...this.sessions.values()].filter((entry) => predicate(entry.record));
    await Promise.all(targets.map((entry) => entry.session.close(code, message)));
    return targets.length;
  }
}
