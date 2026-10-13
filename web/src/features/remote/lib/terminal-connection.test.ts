import { describe, expect, it } from "vitest";
import {
  parseServerFrame,
  TerminalConnection,
  type TerminalSocket,
  type TerminalState,
} from "@/features/remote/lib/terminal-connection";

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

class FakeSocket implements TerminalSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners[type] ?? []) listener({ data });
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  serverClose() {
    this.readyState = 3;
    this.emit("close");
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

function harness(tickets: (() => Promise<string>)[]) {
  const sockets: FakeSocket[] = [];
  const states: TerminalState[] = [];
  const output: string[] = [];
  const pending: (() => void)[] = [];
  let issued = 0;
  const connection = new TerminalConnection({
    issueTicket: () => tickets[Math.min(issued++, tickets.length - 1)](),
    socketUrl: (ticket, session, size) =>
      `ws://x/terminal?ticket=${ticket}&session=${session ?? ""}&cols=${size.cols}`,
    size: () => ({ cols: 120, rows: 30 }),
    onOutput: (data) => output.push(data),
    onState: (state) => states.push(state),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    reconnectDelaysMs: [10, 10],
    schedule: (callback) => pending.push(callback),
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { connection, sockets, states, output, pending, flush };
}

describe("TerminalConnection", () => {
  it("streams output, sends input/resize frames and reports the session", async () => {
    const h = harness([async () => "t1"]);
    h.connection.start();
    await h.flush();
    const socket = h.sockets[0];
    socket.open();
    socket.emit("message", JSON.stringify({ type: "session", id: "s1" }));
    socket.emit("message", JSON.stringify({ type: "output", data: "$ " }));
    h.connection.send("ls\r");
    expect(last(h.states)).toEqual({ phase: "open", sessionId: "s1" });
    expect(h.output).toEqual(["$ "]);
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: "resize", cols: 120, rows: 30 },
      { type: "input", data: "ls\r" },
    ]);
  });

  it("reconnects a dropped socket with a fresh ticket and the same session id", async () => {
    const h = harness([async () => "t1", async () => "t2"]);
    h.connection.start();
    await h.flush();
    h.sockets[0].open();
    h.sockets[0].emit("message", JSON.stringify({ type: "session", id: "s1" }));
    h.sockets[0].serverClose();
    expect(last(h.states)).toEqual({ phase: "reconnecting", attempt: 1 });
    h.pending.shift()?.();
    await h.flush();
    expect(h.sockets[1].url).toBe("ws://x/terminal?ticket=t2&session=s1&cols=120");
  });

  it("stops after an exit frame and reports revocation reasons", async () => {
    const h = harness([async () => "t1"]);
    h.connection.start();
    await h.flush();
    h.sockets[0].open();
    h.sockets[0].emit("message", JSON.stringify({ type: "session", id: "s1" }));
    h.sockets[0].emit("message", JSON.stringify({ type: "exit", code: null, reason: "revoked" }));
    h.sockets[0].serverClose();
    expect(last(h.states)).toEqual({ phase: "exited", code: null, reason: "revoked" });
    expect(h.pending).toHaveLength(0);
  });

  it("fails without retrying when no session was established or tickets are refused", async () => {
    const refused = harness([() => Promise.reject(new Error("revoked"))]);
    refused.connection.start();
    await refused.flush();
    expect(last(refused.states)).toMatchObject({ phase: "failed" });
    expect(refused.sockets).toHaveLength(0);

    const neverOpened = harness([async () => "t1"]);
    neverOpened.connection.start();
    await neverOpened.flush();
    neverOpened.sockets[0].serverClose();
    expect(last(neverOpened.states)).toMatchObject({ phase: "failed" });
  });

  it("gives up after the bounded reconnect attempts", async () => {
    const h = harness([async () => "t"]);
    h.connection.start();
    await h.flush();
    h.sockets[0].open();
    h.sockets[0].emit("message", JSON.stringify({ type: "session", id: "s1" }));
    for (let attempt = 0; attempt < 2; attempt++) {
      last(h.sockets)?.serverClose();
      h.pending.shift()?.();
      await h.flush();
    }
    last(h.sockets)?.serverClose();
    expect(last(h.states)).toMatchObject({ phase: "failed" });
  });

  it("close() asks the server to end the session and never reconnects", async () => {
    const h = harness([async () => "t1"]);
    h.connection.start();
    await h.flush();
    h.sockets[0].open();
    h.sockets[0].emit("message", JSON.stringify({ type: "session", id: "s1" }));
    h.connection.close();
    expect(JSON.parse(last(h.sockets[0].sent) ?? "{}")).toEqual({ type: "close" });
    expect(h.sockets[0].closed).toBe(true);
    expect(h.pending).toHaveLength(0);
  });
});

describe("parseServerFrame", () => {
  it("ignores malformed and unknown frames", () => {
    expect(parseServerFrame("not json")).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "output", data: 1 }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "other" }))).toBeNull();
    expect(parseServerFrame(new ArrayBuffer(2))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "exit", code: 0 }))).toEqual({
      type: "exit",
      code: 0,
      reason: null,
    });
  });
});
