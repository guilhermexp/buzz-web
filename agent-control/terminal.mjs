import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

const MAX_BUFFERED_OUTPUT = 256 * 1024;
const MAX_INPUT_FRAME = 64 * 1024;

/** Single-use, short-lived terminal tickets bound to owner + community + workspace. */
export class TicketStore {
  constructor({ ttlSeconds = 30, now = () => Date.now() } = {}) {
    this.ttlMs = Math.min(ttlSeconds, 30) * 1000;
    this.now = now;
    this.tickets = new Map();
  }

  issue(binding) {
    this.prune();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.tickets.set(ticket, { ...binding, expiresAt });
    return { ticket, expiresAt: Math.floor(expiresAt / 1000) };
  }

  /** Consume a ticket: returns its binding once, or null when unknown, used or expired. */
  consume(ticket) {
    if (typeof ticket !== "string") return null;
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    this.tickets.delete(ticket);
    return entry.expiresAt >= this.now() ? entry : null;
  }

  prune() {
    const now = this.now();
    for (const [ticket, entry] of this.tickets) if (entry.expiresAt < now) this.tickets.delete(ticket);
  }

  revokeWhere(predicate) {
    for (const [ticket, entry] of this.tickets) if (predicate(entry)) this.tickets.delete(ticket);
  }
}

function clampDimension(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(number, 500));
}

/**
 * Interactive PTY sessions (`docker exec` with Tty) in workspace containers. A session survives
 * a dropped socket for `reconnectSeconds`; afterwards, on exit, expiry or revocation the whole
 * process session inside the container is killed.
 */
export class TerminalService {
  constructor({ runtime, reconnectSeconds = 60, maxSeconds = 4 * 3600, log = console }) {
    this.runtime = runtime;
    this.reconnectMs = reconnectSeconds * 1000;
    this.maxMs = maxSeconds * 1000;
    this.log = log;
    this.sessions = new Map();
  }

  async open({ owner, community, record, cols, rows }) {
    const id = randomBytes(12).toString("hex");
    const pidFile = `/tmp/.buzz-term-${id}.pid`;
    const { exec, stream } = await this.runtime.execInteractive(
      record.container,
      ["/bin/sh", "-c", 'echo $$ >"$1"; exec /bin/bash -il', "sh", pidFile],
      {
        tty: true,
        env: ["TERM=xterm-256color", "COLORTERM=truecolor"],
        cols: clampDimension(cols, 80),
        rows: clampDimension(rows, 24),
      },
    );
    const session = {
      id,
      owner,
      community,
      workspaceId: record.id,
      container: record.container,
      exec,
      stream,
      pid: null,
      socket: null,
      buffer: [],
      bufferedBytes: 0,
      decoder: new StringDecoder("utf8"),
      detachTimer: null,
      maxTimer: setTimeout(() => void this.terminate(session, "expired"), this.maxMs),
      closed: false,
    };
    this.sessions.set(id, session);
    stream.on("data", (chunk) => this.output(session, session.decoder.write(chunk)));
    stream.on("end", () => void this.finish(session));
    stream.on("close", () => void this.finish(session));
    stream.on("error", () => void this.finish(session));
    session.pid = await this.readPid(record.container, pidFile);
    return session;
  }

  async readPid(container, pidFile) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.runtime.execCollect(container, ["cat", pidFile], { timeoutMs: 5000 });
      const pid = Number.parseInt(result.stdout.toString("utf8"), 10);
      if (result.code === 0 && Number.isInteger(pid) && pid > 1) {
        await this.runtime.execCollect(container, ["rm", "-f", pidFile], { timeoutMs: 5000 });
        return pid;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("terminal process id was not published");
  }

  /** The caller's detached session, or null when it is unknown, foreign or already closed. */
  findReconnectable(sessionId, { owner, community, workspaceId }) {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return null;
    if (session.owner !== owner || session.community !== community) return null;
    if (session.workspaceId !== workspaceId) return null;
    return session;
  }

  attach(session, socket) {
    if (session.socket && session.socket !== socket) session.socket.close(4409, "replaced");
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
    session.socket = socket;
    socket.send(
      JSON.stringify({ type: "session", id: session.id, reconnectSeconds: this.reconnectMs / 1000 }),
    );
    if (session.buffer.length) {
      socket.send(JSON.stringify({ type: "output", data: session.buffer.join("") }));
      session.buffer = [];
      session.bufferedBytes = 0;
    }
    socket.on("message", (raw, isBinary) => this.input(session, raw, isBinary));
    socket.on("close", () => {
      if (session.socket !== socket) return;
      session.socket = null;
      if (session.closed) return;
      session.detachTimer = setTimeout(() => void this.terminate(session, "detached"), this.reconnectMs);
    });
  }

  output(session, text) {
    if (!text) return;
    if (session.socket) {
      session.socket.send(JSON.stringify({ type: "output", data: text }));
      return;
    }
    session.buffer.push(text);
    session.bufferedBytes += text.length;
    while (session.bufferedBytes > MAX_BUFFERED_OUTPUT && session.buffer.length > 1) {
      session.bufferedBytes -= session.buffer.shift().length;
    }
  }

  input(session, raw, isBinary) {
    if (session.closed || isBinary || raw.length > MAX_INPUT_FRAME) return;
    let frame;
    try {
      frame = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (frame?.type === "input" && typeof frame.data === "string") {
      session.stream.write(frame.data);
    } else if (frame?.type === "resize") {
      const cols = clampDimension(frame.cols, 80);
      const rows = clampDimension(frame.rows, 24);
      session.exec.resize({ w: cols, h: rows }).catch(() => {});
    } else if (frame?.type === "close") {
      void this.terminate(session, "closed");
    }
  }

  /** The shell exited by itself: report its status, then clean up leftover jobs. */
  async finish(session) {
    if (session.closed) return;
    session.closed = true;
    let code = null;
    try {
      code = (await session.exec.inspect()).ExitCode;
    } catch {
      code = null;
    }
    await this.cleanup(session, { type: "exit", code }, 1000);
  }

  /** Kill a live session for `reason` (detached, expired, revoked, deleted). */
  async terminate(session, reason) {
    if (session.closed) return;
    session.closed = true;
    await this.cleanup(session, { type: "exit", code: null, reason }, reason === "revoked" ? 4403 : 4000);
  }

  async cleanup(session, frame, closeCode) {
    clearTimeout(session.detachTimer);
    clearTimeout(session.maxTimer);
    this.sessions.delete(session.id);
    const tail = session.decoder.end();
    if (tail && session.socket) session.socket.send(JSON.stringify({ type: "output", data: tail }));
    if (session.socket) {
      session.socket.send(JSON.stringify(frame));
      session.socket.close(closeCode, frame.reason ?? "exit");
    }
    session.stream.destroy();
    try {
      await this.runtime.killSession(session.container, session.pid);
    } catch (error) {
      this.log.error?.(`terminal ${session.id} cleanup failed: ${error.message}`);
    }
  }

  async terminateWhere(predicate, reason) {
    const targets = [...this.sessions.values()].filter(predicate);
    await Promise.all(targets.map((session) => this.terminate(session, reason)));
    return targets.length;
  }
}
