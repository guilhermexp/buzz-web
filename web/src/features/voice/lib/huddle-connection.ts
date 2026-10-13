import { makeAuthEvent } from "nostr-tools/nip42";
import type { HuddleErrorCode } from "@/features/voice/lib/huddle-types";
import {
  classifyRelayError,
  HUDDLE_PROTOCOL_VERSION,
  type InboundFrame,
  MAX_FRAME_BYTES,
  parseControl,
  parseInboundFrame,
  type RosterPeer,
} from "@/features/voice/lib/huddle-wire";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

export type HuddleConnectionEvents = {
  /** Fires on the first join and after every reconnect with a fresh roster. */
  onJoined: (self: RosterPeer, peers: RosterPeer[]) => void;
  onPeerJoined: (peer: RosterPeer) => void;
  onPeerLeft: (pubkey: string | null, peerIndex: number | null) => void;
  onRoster: (peers: RosterPeer[]) => void;
  onFrame: (frame: InboundFrame) => void;
  onReconnecting: () => void;
  /** The session cannot continue; the socket is closed and will not reopen. */
  onTerminal: (code: HuddleErrorCode) => void;
};

/** A failed handshake: a terminal code, or "retry" for transient failures. */
export class HuddleHandshakeError extends Error {
  constructor(readonly code: HuddleErrorCode | "retry") {
    super(`huddle handshake failed: ${code}`);
  }
}

const HANDSHAKE_TIMEOUT_MS = 10_000;
const INITIAL_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000];
/** Drop media instead of queueing once ~0.5 s of audio is waiting in the socket. */
const MAX_BUFFERED_BYTES = 32 * 1024;

export function huddleAudioUrl(relayUrl: string, ephemeralChannelId: string): string {
  return `${relayUrl.replace(/\/+$/, "")}/huddle/${encodeURIComponent(ephemeralChannelId)}/audio`;
}

function handshakeCode(error: unknown): HuddleErrorCode | "retry" {
  return error instanceof HuddleHandshakeError ? error.code : "retry";
}

/**
 * The authenticated Huddle audio WebSocket (protocol v2). Reconnects with
 * backoff after transient loss; relay errors that end the session (membership
 * revoked, room ended, not a member, …) are terminal.
 */
export class HuddleConnection {
  private socket: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly relayUrl: string,
    private readonly ephemeralChannelId: string,
    private readonly parentChannelId: string,
    private readonly events: HuddleConnectionEvents,
  ) {}

  /** Connect and authenticate, retrying transient failures a few times. */
  async open(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        const code = handshakeCode(error);
        if (this.closed || code !== "retry" || attempt >= INITIAL_ATTEMPTS) {
          this.close();
          throw new HuddleHandshakeError(code === "retry" ? "join" : code);
        }
        await new Promise((resolve) => window.setTimeout(resolve, RECONNECT_DELAYS_MS[attempt]));
      }
    }
  }

  send(frame: Uint8Array<ArrayBuffer>) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || frame.length > MAX_FRAME_BYTES) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
    socket.send(frame);
  }

  /** Tell the relay we are leaving, then close. */
  leave() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "leave" }));
    }
    this.close();
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "leave");
  }

  /** Skip the remaining backoff (e.g. the network came back). */
  retryNow() {
    if (this.closed || this.socket || this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnect();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS_MS[this.attempt];
    if (delay === undefined) {
      this.terminate("connection");
      return;
    }
    this.attempt += 1;
    this.events.onReconnecting();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, delay);
  }

  private reconnect() {
    if (this.closed) return;
    this.connectOnce().then(
      () => {
        this.attempt = 0;
      },
      (error: unknown) => {
        const code = handshakeCode(error);
        if (code === "retry") this.scheduleReconnect();
        else this.terminate(code);
      },
    );
  }

  private terminate(code: HuddleErrorCode) {
    if (this.closed) return;
    this.close();
    this.events.onTerminal(code);
  }

  private connectOnce(): Promise<void> {
    // Executor form: settlement is driven by socket events registered here.
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(huddleAudioUrl(this.relayUrl, this.ephemeralChannelId));
      socket.binaryType = "arraybuffer";
      let joined = false;
      let failed = false;
      let terminal: HuddleErrorCode | null = null;
      const fail = (code: HuddleErrorCode | "retry") => {
        if (joined || failed) return;
        failed = true;
        window.clearTimeout(timeout);
        socket.close();
        reject(new HuddleHandshakeError(code));
      };
      const timeout = window.setTimeout(() => fail("retry"), HANDSHAKE_TIMEOUT_MS);

      const authenticate = async (challenge: string) => {
        try {
          const event = await signNostrEvent(makeAuthEvent(this.relayUrl, challenge), {
            requireActive: true,
          });
          if (failed || socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({
              type: "auth",
              event,
              parent_channel_id: this.parentChannelId,
              protocol_version: HUDDLE_PROTOCOL_VERSION,
            }),
          );
        } catch {
          fail("auth");
        }
      };

      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") {
          if (!joined || this.socket !== socket) return;
          const frame = parseInboundFrame(new Uint8Array(message.data as ArrayBuffer));
          if (frame) this.events.onFrame(frame);
          return;
        }
        const control = parseControl(message.data);
        if (control.type === "error") {
          const code = classifyRelayError(control.code, control.message);
          if (!joined) fail(code);
          else if (code !== "retry") terminal = code;
          return;
        }
        if (!joined) {
          if (control.type === "challenge") void authenticate(control.challenge);
          if (control.type !== "joined" || failed) return;
          if (control.pubkey === null || control.peerIndex === null || this.closed) {
            fail(this.closed ? "join" : "retry");
            return;
          }
          joined = true;
          window.clearTimeout(timeout);
          this.socket = socket;
          this.events.onJoined(
            { pubkey: control.pubkey, peerIndex: control.peerIndex },
            control.peers,
          );
          resolve();
          return;
        }
        if (control.type === "joined") {
          if (control.pubkey !== null && control.peerIndex !== null) {
            this.events.onPeerJoined({ pubkey: control.pubkey, peerIndex: control.peerIndex });
          }
          for (const peer of control.peers) this.events.onPeerJoined(peer);
        } else if (control.type === "left") {
          this.events.onPeerLeft(control.pubkey, control.peerIndex);
        } else if (control.type === "roster") {
          this.events.onRoster(control.peers);
        }
      });

      socket.addEventListener("close", () => {
        if (!joined) {
          fail("retry");
          return;
        }
        if (this.socket !== socket) return;
        this.socket = null;
        if (this.closed) return;
        if (terminal) this.terminate(terminal);
        else this.scheduleReconnect();
      });
    });
  }
}
