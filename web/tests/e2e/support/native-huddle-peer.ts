import { finalizeEvent } from "nostr-tools/pure";
import { decodeToMonoPcm, ffmpeg } from "./audio-analysis";
import { oggFromOpusPackets, opusPacketSamples, opusPacketsFromOgg } from "./ogg-opus";

// Buzz Huddle audio wire, protocol v2 (desktop `huddle::wire`, relay `audio::wire`):
//   client → relay: <8-byte header><opus>
//   relay → client: <peer_index u8><8-byte header><opus>
//   header (big-endian): seq u16 | ts_48k u32 | level_dbov i8 | flags u8 (bit0 = DTX)
// Auth: {"type":"challenge"} → {"type":"auth", event: kind 22242, parent_channel_id,
// protocol_version: 2} → {"type":"joined", peer_index, peers:[{pubkey, peer_index}]}.

export type ReceivedFrame = { at: number; opus: Uint8Array };

type Control = {
  type?: string;
  challenge?: string;
  pubkey?: string;
  peer_index?: number;
  peers?: unknown[];
};

/** Validate one relay control frame; unknown fields are ignored. */
function parseControl(text: string): Control {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object") return {};
  const control: Control = {};
  if ("type" in raw && typeof raw.type === "string") control.type = raw.type;
  if ("challenge" in raw && typeof raw.challenge === "string") control.challenge = raw.challenge;
  if ("pubkey" in raw && typeof raw.pubkey === "string") control.pubkey = raw.pubkey;
  if ("peer_index" in raw && typeof raw.peer_index === "number") {
    control.peer_index = raw.peer_index;
  }
  if ("peers" in raw && Array.isArray(raw.peers)) control.peers = raw.peers;
  return control;
}

export class NativeHuddlePeer {
  readonly pubkeyByIndex = new Map<number, string>();
  readonly frames = new Map<string, ReceivedFrame[]>();
  readonly left: string[] = [];
  closed = false;
  private sendTimer: NodeJS.Timeout | undefined;
  private streamDone: (() => void) | undefined;

  private constructor(
    private readonly socket: WebSocket,
    readonly peerIndex: number,
  ) {}

  static async join(options: {
    relayUrl: string;
    ephemeralChannelId: string;
    parentChannelId: string;
    secretKey: Uint8Array;
  }): Promise<NativeHuddlePeer> {
    const socket = new WebSocket(`${options.relayUrl}/huddle/${options.ephemeralChannelId}/audio`);
    socket.binaryType = "arraybuffer";
    const queue: Control[] = [];
    const arrival = { notify: () => {} };
    const onText = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      queue.push(parseControl(event.data));
      arrival.notify();
    };
    socket.addEventListener("message", onText);
    const nextControl = async (type: string): Promise<Control> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const index = queue.findIndex((item) => item.type === type || item.type === "error");
        if (index >= 0) {
          const [item] = queue.splice(index, 1);
          if (item?.type === "error")
            throw new Error(`huddle relay error: ${JSON.stringify(item)}`);
          if (item) return item;
        }
        const waiting = Promise.withResolvers<void>();
        arrival.notify = waiting.resolve;
        setTimeout(waiting.resolve, 250);
        await waiting.promise;
      }
      throw new Error(`timed out waiting for huddle ${type}`);
    };

    const challenge = await nextControl("challenge");
    const auth = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["relay", options.relayUrl],
          ["challenge", String(challenge.challenge)],
        ],
      },
      options.secretKey,
    );
    socket.send(
      JSON.stringify({
        type: "auth",
        event: auth,
        parent_channel_id: options.parentChannelId,
        protocol_version: 2,
      }),
    );
    const joined = await nextControl("joined");
    socket.removeEventListener("message", onText);
    if (typeof joined.peer_index !== "number") throw new Error("joined without peer_index");
    const peer = new NativeHuddlePeer(socket, joined.peer_index);
    peer.applyRoster(joined.peers);
    socket.addEventListener("message", (event) => peer.onMessage(event));
    socket.addEventListener("close", () => {
      peer.closed = true;
    });
    return peer;
  }

  private applyRoster(peers: unknown[] | undefined) {
    for (const entry of peers ?? []) {
      if (!entry || typeof entry !== "object") continue;
      if (!("pubkey" in entry) || !("peer_index" in entry)) continue;
      if (typeof entry.pubkey === "string" && typeof entry.peer_index === "number") {
        this.pubkeyByIndex.set(entry.peer_index, entry.pubkey.toLowerCase());
      }
    }
  }

  private onMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      const control = parseControl(event.data);
      if (control.type === "roster") this.applyRoster(control.peers);
      if (control.type === "joined" && typeof control.pubkey === "string") {
        this.applyRoster([control]);
        this.applyRoster(control.peers);
      }
      if (control.type === "left" && typeof control.pubkey === "string") {
        this.left.push(control.pubkey.toLowerCase());
        if (typeof control.peer_index === "number") this.pubkeyByIndex.delete(control.peer_index);
      }
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    if (bytes.length <= 9) return;
    const pubkey = this.pubkeyByIndex.get(bytes[0] ?? 255);
    if (!pubkey) return;
    const list = this.frames.get(pubkey) ?? [];
    list.push({ at: Date.now(), opus: bytes.slice(9) });
    this.frames.set(pubkey, list);
  }

  /** Encode a gated tone with libopus (20 ms frames) and stream it in real time. */
  async streamTone(frequency: number, seconds: number): Promise<void> {
    const ogg = await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
      "-af",
      "volume='if(lt(mod(t,0.5),0.3),0.6,0)':eval=frame",
      "-ac",
      "1",
      "-c:a",
      "libopus",
      "-application",
      "voip",
      "-frame_duration",
      "20",
      "-b:a",
      "32k",
      "-f",
      "ogg",
      "pipe:1",
    ]);
    const packets = opusPacketsFromOgg(ogg);
    let seq = 0;
    let timestamp = 0;
    let index = 0;
    const done = Promise.withResolvers<void>();
    this.streamDone = done.resolve;
    this.sendTimer = setInterval(() => {
      const packet = packets[index];
      if (!packet || this.closed) {
        clearInterval(this.sendTimer);
        done.resolve();
        return;
      }
      const frame = new Uint8Array(8 + packet.length);
      const view = new DataView(frame.buffer);
      view.setUint16(0, seq & 0xffff);
      view.setUint32(2, timestamp >>> 0);
      view.setInt8(6, -20);
      view.setUint8(7, 0);
      frame.set(packet, 8);
      this.socket.send(frame);
      seq += 1;
      timestamp += opusPacketSamples(packet);
      index += 1;
    }, 20);
    return done.promise;
  }

  /** Decode one sender's frames received in [from, to) through libopus. */
  async decodeFrom(pubkey: string, from = 0, to = Number.POSITIVE_INFINITY) {
    const frames = (this.frames.get(pubkey.toLowerCase()) ?? []).filter(
      (frame) => frame.at >= from && frame.at < to,
    );
    if (!frames.length) return { frames: 0, samples: new Float32Array() };
    const samples = await decodeToMonoPcm(oggFromOpusPackets(frames.map((frame) => frame.opus)));
    return { frames: frames.length, samples };
  }

  close() {
    this.closed = true;
    clearInterval(this.sendTimer);
    this.streamDone?.();
    this.socket.close();
  }
}
