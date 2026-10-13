import { HuddleAudioEngine } from "@/features/voice/lib/huddle-audio";
import {
  createFrameDecoder,
  createFrameEncoder,
  type FrameDecoder,
  type FrameEncoder,
} from "@/features/voice/lib/huddle-codec";
import type { HuddleParticipant } from "@/features/voice/lib/huddle-types";
import {
  encodeFrame,
  FLAG_DTX,
  FRAME_SAMPLES,
  type InboundFrame,
  levelDbov,
  type RosterPeer,
} from "@/features/voice/lib/huddle-wire";

/** Frames at or above this level (and not DTX) count as speech. */
const SPEAKING_DBOV = -50;
const SPEAKING_HOLD_MS = 400;
const SPEAKING_POLL_MS = 150;
const MAX_PENDING_PACKETS = 10;

type PeerDecoder = { decoder: FrameDecoder | null; pending: InboundFrame[]; closed: boolean };

/**
 * Media for one Huddle session: capture → Opus → wire frames out, wire frames
 * in → per-peer Opus decoders → playout, plus the roster and speaking levels.
 * It survives reconnects (the socket changes, capture does not), so a
 * reconnect never opens a second microphone.
 */
export class HuddleMedia {
  private readonly roster = new Map<number, string>();
  private readonly order: string[] = [];
  private readonly decoders = new Map<number, PeerDecoder>();
  private readonly lastSpoke = new Map<string, number>();
  private speaking = new Set<string>();
  private self: RosterPeer | null = null;
  private send: ((frame: Uint8Array<ArrayBuffer>) => void) | null = null;
  private encodedFrames = 0;
  private recovering = false;
  private seq = 0;
  private lastLevel = -127;
  private speakingTimer: number;
  private closed = false;
  muted = false;
  deafened = false;
  microphoneLost = false;

  private constructor(
    readonly engine: HuddleAudioEngine,
    private encoder: FrameEncoder | null,
    readonly selfPubkey: string,
    private readonly onChange: () => void,
  ) {
    this.speakingTimer = window.setInterval(() => this.refreshSpeaking(), SPEAKING_POLL_MS);
  }

  static async open(options: {
    selfPubkey: string;
    inputDeviceId: string | null;
    onChange: () => void;
  }): Promise<HuddleMedia> {
    let media: HuddleMedia | null = null;
    const encoder = await createFrameEncoder(
      (packet) => media?.sendPacket(packet),
      () => media?.recoverEncoder(),
    );
    try {
      const engine = await HuddleAudioEngine.open({
        inputDeviceId: options.inputDeviceId,
        onFrame: (frame) => media?.captured(frame),
        onMicrophoneLost: () => {
          if (!media) return;
          media.microphoneLost = true;
          options.onChange();
        },
      });
      media = new HuddleMedia(engine, encoder, options.selfPubkey.toLowerCase(), options.onChange);
      return media;
    } catch (error) {
      encoder.close();
      throw error;
    }
  }

  /** Route outgoing frames to a (re)connected socket; null pauses sending. */
  setSender(send: ((frame: Uint8Array<ArrayBuffer>) => void) | null) {
    this.send = send;
  }

  private captured(frame: Float32Array) {
    if (this.closed || this.muted || this.microphoneLost || !this.send || !this.encoder) return;
    const level = levelDbov(frame);
    this.lastLevel = level;
    if (level >= SPEAKING_DBOV) this.lastSpoke.set(this.selfPubkey, performance.now());
    // Timestamps count encoded frames only, so muting never leaves the encoder
    // a discontinuity to stumble over.
    this.encoder.encode(frame, this.encodedFrames++);
  }

  /** A codec error closes WebCodecs encoders for good; replace it and keep going. */
  private recoverEncoder() {
    if (this.closed || this.recovering) return;
    this.recovering = true;
    this.encoder?.close();
    this.encoder = null;
    this.encodedFrames = 0;
    void createFrameEncoder(
      (packet) => this.sendPacket(packet),
      () => this.recoverEncoder(),
    ).then(
      (encoder) => {
        this.recovering = false;
        if (this.closed) encoder.close();
        else this.encoder = encoder;
      },
      () => {
        this.recovering = false;
      },
    );
  }

  private sendPacket(packet: Uint8Array) {
    if (this.closed || this.muted || !this.send || packet.length === 0) return;
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xffff;
    this.send(
      encodeFrame(
        {
          seq,
          ts48k: (seq * FRAME_SAMPLES) >>> 0,
          levelDbov: this.lastLevel,
          flags: packet.length <= 2 ? FLAG_DTX : 0,
        },
        packet,
      ),
    );
  }

  receive(frame: InboundFrame) {
    if (this.closed || frame.peerIndex === this.self?.peerIndex) return;
    const pubkey = this.roster.get(frame.peerIndex);
    if (!pubkey) return;
    if (frame.header.levelDbov >= SPEAKING_DBOV && !(frame.header.flags & FLAG_DTX)) {
      this.lastSpoke.set(pubkey, performance.now());
    }
    if (this.deafened) return;
    const peer = this.decoderFor(frame.peerIndex);
    if (peer.decoder) {
      peer.decoder.decode(frame.opus, Math.floor(frame.header.ts48k / FRAME_SAMPLES));
    } else if (peer.pending.length < MAX_PENDING_PACKETS) {
      peer.pending.push({ ...frame, opus: frame.opus.slice() });
    }
  }

  private decoderFor(peerIndex: number): PeerDecoder {
    const existing = this.decoders.get(peerIndex);
    if (existing) return existing;
    const peer: PeerDecoder = { decoder: null, pending: [], closed: false };
    this.decoders.set(peerIndex, peer);
    void createFrameDecoder(
      (samples) => {
        if (!peer.closed && !this.deafened) this.engine.play(peerIndex, samples);
      },
      () => this.dropDecoder(peerIndex),
    ).then(
      (decoder) => {
        if (peer.closed) {
          decoder.close();
          return;
        }
        peer.decoder = decoder;
        for (const frame of peer.pending.splice(0)) {
          decoder.decode(frame.opus, Math.floor(frame.header.ts48k / FRAME_SAMPLES));
        }
      },
      () => this.dropDecoder(peerIndex),
    );
    return peer;
  }

  private dropDecoder(peerIndex: number) {
    const peer = this.decoders.get(peerIndex);
    if (!peer) return;
    peer.closed = true;
    peer.decoder?.close();
    this.decoders.delete(peerIndex);
    this.engine.removePeer(peerIndex);
  }

  /** A (re)join: the relay's roster replaces whatever we knew. */
  joined(self: RosterPeer, peers: RosterPeer[]) {
    for (const peerIndex of [...this.decoders.keys()]) this.dropDecoder(peerIndex);
    this.engine.clearPeers();
    this.roster.clear();
    this.self = self;
    this.addPeer(self);
    for (const peer of peers) this.addPeer(peer);
    this.onChange();
  }

  addPeer(peer: RosterPeer) {
    const previous = this.roster.get(peer.peerIndex);
    if (previous === peer.pubkey) return;
    if (previous !== undefined) this.dropDecoder(peer.peerIndex);
    this.roster.set(peer.peerIndex, peer.pubkey);
    if (!this.order.includes(peer.pubkey)) this.order.push(peer.pubkey);
    this.onChange();
  }

  removePeer(pubkey: string | null, peerIndex: number | null) {
    const index =
      peerIndex ?? [...this.roster.entries()].find(([, value]) => value === pubkey)?.[0] ?? null;
    if (index === null || index === this.self?.peerIndex) return;
    this.roster.delete(index);
    this.dropDecoder(index);
    this.onChange();
  }

  replaceRoster(peers: RosterPeer[]) {
    if (!this.self) return;
    const self = this.self;
    for (const index of [...this.roster.keys()]) {
      if (index !== self.peerIndex && !peers.some((peer) => peer.peerIndex === index)) {
        this.roster.delete(index);
        this.dropDecoder(index);
      }
    }
    for (const peer of peers) this.addPeer(peer);
    this.onChange();
  }

  get participants(): HuddleParticipant[] {
    const present = new Set(this.roster.values());
    present.add(this.selfPubkey);
    return this.order
      .filter((pubkey) => present.has(pubkey))
      .map((pubkey) => ({
        pubkey,
        self: pubkey === this.selfPubkey,
        speaking: this.speaking.has(pubkey),
      }))
      .sort((left, right) => Number(right.self) - Number(left.self));
  }

  private refreshSpeaking() {
    const now = performance.now();
    const next = new Set<string>();
    for (const [pubkey, at] of this.lastSpoke) {
      if (now - at > SPEAKING_HOLD_MS) this.lastSpoke.delete(pubkey);
      else if (pubkey !== this.selfPubkey || !this.muted) next.add(pubkey);
    }
    if (
      next.size === this.speaking.size &&
      [...next].every((pubkey) => this.speaking.has(pubkey))
    ) {
      return;
    }
    this.speaking = next;
    this.onChange();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.engine.setMuted(muted);
    if (muted) this.lastSpoke.delete(this.selfPubkey);
    this.onChange();
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.engine.setDeafened(deafened);
    this.onChange();
  }

  /** Reopen capture on `deviceId`; the previous capture is stopped first. */
  async replaceInput(deviceId: string | null) {
    try {
      await this.engine.replaceInput(deviceId);
      this.microphoneLost = false;
      this.engine.setMuted(this.muted);
    } catch (error) {
      this.microphoneLost = true;
      throw error;
    } finally {
      this.onChange();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.send = null;
    window.clearInterval(this.speakingTimer);
    for (const peerIndex of [...this.decoders.keys()]) this.dropDecoder(peerIndex);
    this.encoder?.close();
    this.encoder = null;
    await this.engine.close();
  }
}
