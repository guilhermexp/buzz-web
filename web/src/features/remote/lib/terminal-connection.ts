export type TerminalSize = { cols: number; rows: number };

export type TerminalState =
  | { phase: "connecting" }
  | { phase: "open"; sessionId: string }
  | { phase: "reconnecting"; attempt: number }
  | { phase: "exited"; code: number | null; reason: string | null }
  | { phase: "failed"; error: unknown };

/** The subset of the browser WebSocket the connection uses (a seam for tests). */
export type TerminalSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
};

export type TerminalConnectionOptions = {
  issueTicket: () => Promise<string>;
  socketUrl: (ticket: string, sessionId: string | null, size: TerminalSize) => string;
  size: () => TerminalSize;
  onOutput: (data: string) => void;
  onState: (state: TerminalState) => void;
  createSocket?: (url: string) => TerminalSocket;
  /** Delays between reconnect attempts; the server keeps a detached session for 60 s. */
  reconnectDelaysMs?: readonly number[];
  schedule?: (callback: () => void, ms: number) => void;
};

const OPEN = 1;
const DEFAULT_DELAYS = [500, 1000, 2000, 4000, 8000, 15_000];

type ServerFrame =
  | { type: "session"; id: string }
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null; reason: string | null };

/** Parse one server frame; unknown or malformed frames are ignored. */
export function parseServerFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  if (value.type === "session" && "id" in value && typeof value.id === "string") {
    return { type: "session", id: value.id };
  }
  if (value.type === "output" && "data" in value && typeof value.data === "string") {
    return { type: "output", data: value.data };
  }
  if (value.type === "exit") {
    const code = "code" in value && typeof value.code === "number" ? value.code : null;
    const reason = "reason" in value && typeof value.reason === "string" ? value.reason : null;
    return { type: "exit", code, reason };
  }
  return null;
}

/**
 * One remote PTY session over the Agent Control WebSocket. Unexpected drops reconnect with a new
 * single-use ticket plus the session id (inside the server's reconnect window); an `exit` frame or
 * an explicit `close()` ends the session for good.
 */
export class TerminalConnection {
  private socket: TerminalSocket | null = null;
  private sessionId: string | null = null;
  private finished = false;
  private attempt = 0;
  private readonly options: TerminalConnectionOptions;

  constructor(options: TerminalConnectionOptions) {
    this.options = options;
  }

  start(): void {
    this.options.onState({ phase: "connecting" });
    void this.connect();
  }

  private async connect(): Promise<void> {
    let ticket: string;
    try {
      ticket = await this.options.issueTicket();
    } catch (error) {
      this.fail(error);
      return;
    }
    if (this.finished) return;
    const url = this.options.socketUrl(ticket, this.sessionId, this.options.size());
    const socket: TerminalSocket = this.options.createSocket?.(url) ?? new WebSocket(url);
    this.socket = socket;
    let opened = false;
    socket.addEventListener("open", () => {
      opened = true;
    });
    socket.addEventListener("message", (event) => this.receive(event.data));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.finished) return;
      if (opened) this.attempt = 0;
      this.reconnect();
    });
  }

  private receive(raw: unknown): void {
    const frame = parseServerFrame(raw);
    if (!frame) return;
    if (frame.type === "session") {
      this.sessionId = frame.id;
      this.attempt = 0;
      this.options.onState({ phase: "open", sessionId: frame.id });
      const size = this.options.size();
      this.resize(size.cols, size.rows);
    } else if (frame.type === "output") {
      this.options.onOutput(frame.data);
    } else {
      this.finished = true;
      this.options.onState({ phase: "exited", code: frame.code, reason: frame.reason });
    }
  }

  private reconnect(): void {
    const delays = this.options.reconnectDelaysMs ?? DEFAULT_DELAYS;
    if (!this.sessionId || this.attempt >= delays.length) {
      this.fail(new Error("session_lost"));
      return;
    }
    const delay = delays[this.attempt];
    this.attempt += 1;
    this.options.onState({ phase: "reconnecting", attempt: this.attempt });
    const schedule = this.options.schedule ?? ((callback, ms) => window.setTimeout(callback, ms));
    schedule(() => {
      if (!this.finished) void this.connect();
    }, delay);
  }

  private fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.options.onState({ phase: "failed", error });
  }

  private sendFrame(frame: Record<string, unknown>): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(frame));
  }

  send(data: string): void {
    this.sendFrame({ type: "input", data });
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sendFrame({ type: "resize", cols, rows });
  }

  /** End the session: the server kills its whole process session immediately. */
  close(): void {
    const wasLive = !this.finished;
    if (wasLive) this.sendFrame({ type: "close" });
    this.finished = true;
    this.socket?.close(1000, "closed");
    this.socket = null;
    if (wasLive) this.options.onState({ phase: "exited", code: null, reason: "closed" });
  }
}
