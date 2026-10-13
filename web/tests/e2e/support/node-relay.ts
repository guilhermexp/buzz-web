import { type EventTemplate, finalizeEvent, type NostrEvent } from "nostr-tools/pure";

type Filter = Record<string, unknown>;
type Waiter = (message: unknown[]) => boolean;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Minimal NIP-42 authenticated Relay client for live acceptance assertions.
 * It reads and writes through the same public WebSocket contract as clients.
 */
export class NodeRelayClient {
  private readonly socket: WebSocket;
  private readonly waiters = new Set<Waiter>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      for (const waiter of [...this.waiters]) {
        if (waiter(message)) this.waiters.delete(waiter);
      }
    });
  }

  static async connect(relayUrl: string, secretKey: Uint8Array): Promise<NodeRelayClient> {
    const socket = new WebSocket(relayUrl);
    const client = new NodeRelayClient(socket);
    const challenge = client.next((message) =>
      message[0] === "AUTH" && typeof message[1] === "string" ? message[1] : undefined,
    );
    const opened = Promise.withResolvers<void>();
    socket.addEventListener("open", () => opened.resolve(), { once: true });
    socket.addEventListener("error", () => opened.reject(new Error("relay connection failed")), {
      once: true,
    });
    await opened.promise;
    const auth = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["relay", relayUrl],
          ["challenge", await challenge],
        ],
      },
      secretKey,
    );
    const accepted = client.next((message) =>
      message[0] === "OK" && message[1] === auth.id ? message : undefined,
    );
    socket.send(JSON.stringify(["AUTH", auth]));
    const ok = await accepted;
    if (ok[2] !== true) throw new Error(`relay rejected AUTH: ${String(ok[3])}`);
    return client;
  }

  private next<T>(
    match: (message: unknown[]) => T | undefined | Error,
    timeoutMs = 15_000,
  ): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const waiter: Waiter = (message) => {
      const value = match(message);
      if (value === undefined) return false;
      clearTimeout(timer);
      if (value instanceof Error) reject(value);
      else resolve(value);
      return true;
    };
    const timer = setTimeout(() => {
      this.waiters.delete(waiter);
      reject(new Error("timed out waiting for relay message"));
    }, timeoutMs);
    this.waiters.add(waiter);
    return promise;
  }

  async publish(template: EventTemplate, secretKey: Uint8Array): Promise<NostrEvent> {
    const event = finalizeEvent(template, secretKey);
    const ok = this.next((message) =>
      message[0] === "OK" && message[1] === event.id ? message : undefined,
    );
    this.socket.send(JSON.stringify(["EVENT", event]));
    const response = await ok;
    if (response[2] !== true) throw new Error(`relay rejected event: ${String(response[3])}`);
    return event;
  }

  async query(filters: Filter[]): Promise<NostrEvent[]> {
    const id = `live-${crypto.randomUUID()}`;
    const events: NostrEvent[] = [];
    const done = this.next<true>((message) => {
      if (message[1] !== id) return undefined;
      if (message[0] === "EVENT") {
        events.push(message[2] as NostrEvent);
        return undefined;
      }
      if (message[0] === "EOSE") return true;
      if (message[0] === "CLOSED") return new Error(`query closed: ${String(message[2])}`);
      return undefined;
    });
    this.socket.send(JSON.stringify(["REQ", id, ...filters]));
    await done;
    this.socket.send(JSON.stringify(["CLOSE", id]));
    return events;
  }

  /** Poll until `predicate` holds for a fresh query, or fail with context. */
  async waitFor(
    filters: Filter[],
    predicate: (events: NostrEvent[]) => boolean,
    timeoutMs = 30_000,
  ): Promise<NostrEvent[]> {
    const deadline = Date.now() + timeoutMs;
    let events: NostrEvent[] = [];
    while (Date.now() < deadline) {
      events = await this.query(filters);
      if (predicate(events)) return events;
      await delay(500);
    }
    throw new Error(`relay state did not converge; last ${events.length} event(s)`);
  }

  close(): void {
    this.socket.close();
  }
}
