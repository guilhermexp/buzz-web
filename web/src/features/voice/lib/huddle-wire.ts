import type { HuddleErrorCode } from "@/features/voice/lib/huddle-types";

// Buzz Huddle audio wire, protocol v2 (desktop huddle::wire, relay audio::wire):
//   client → relay: <8-byte header><opus>
//   relay → client: <peer_index u8><8-byte header><opus>
//   header (big-endian): seq u16 | ts_48k u32 | level_dbov i8 | flags u8 (bit0 = DTX)

export const HUDDLE_PROTOCOL_VERSION = 2;
export const HEADER_BYTES = 8;
export const FRAME_SAMPLES = 960;
export const FLAG_DTX = 0x01;
/** Relay limit for binary frames. */
export const MAX_FRAME_BYTES = 4096;

export type FrameHeader = { seq: number; ts48k: number; levelDbov: number; flags: number };

export function encodeFrame(header: FrameHeader, opus: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(HEADER_BYTES + opus.length);
  const view = new DataView(frame.buffer);
  view.setUint16(0, header.seq & 0xffff);
  view.setUint32(2, header.ts48k >>> 0);
  view.setInt8(6, Math.max(-127, Math.min(0, Math.round(header.levelDbov))));
  view.setUint8(7, header.flags & 0xff);
  frame.set(opus, HEADER_BYTES);
  return frame;
}

export type InboundFrame = { peerIndex: number; header: FrameHeader; opus: Uint8Array };

/** Parse a relay → client media frame; null when malformed or empty. */
export function parseInboundFrame(bytes: Uint8Array): InboundFrame | null {
  if (bytes.length <= 1 + HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    peerIndex: view.getUint8(0),
    header: {
      seq: view.getUint16(1),
      ts48k: view.getUint32(3),
      levelDbov: view.getInt8(7),
      flags: view.getUint8(8),
    },
    opus: bytes.subarray(1 + HEADER_BYTES),
  };
}

/** RMS level in dBov clamped to [-127, 0] (desktop audio_level_dbov). */
export function levelDbov(samples: Float32Array): number {
  if (!samples.length) return -127;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const meanSquare = sum / samples.length;
  if (meanSquare <= 0) return -127;
  const db = 10 * Math.log10(meanSquare);
  if (!Number.isFinite(db) || db <= -127) return -127;
  return db >= 0 ? 0 : Math.round(db);
}

export type RosterPeer = { pubkey: string; peerIndex: number };

export type HuddleControl =
  | { type: "challenge"; challenge: string }
  | { type: "joined"; pubkey: string | null; peerIndex: number | null; peers: RosterPeer[] }
  | { type: "left"; pubkey: string | null; peerIndex: number | null }
  | { type: "roster"; peers: RosterPeer[] }
  | { type: "error"; code: string | null; message: string }
  | { type: "other" };

function rosterPeers(value: unknown): RosterPeer[] {
  if (!Array.isArray(value)) return [];
  const peers: RosterPeer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { pubkey, peer_index: peerIndex } = entry as Record<string, unknown>;
    if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(pubkey)) continue;
    if (typeof peerIndex !== "number" || !Number.isInteger(peerIndex)) continue;
    peers.push({ pubkey: pubkey.toLowerCase(), peerIndex });
  }
  return peers;
}

/** Validate one relay control message; unknown fields and types are tolerated. */
export function parseControl(text: string): HuddleControl {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { type: "other" };
  }
  if (!raw || typeof raw !== "object") return { type: "other" };
  const value = raw as Record<string, unknown>;
  const pubkey = typeof value.pubkey === "string" ? value.pubkey.toLowerCase() : null;
  const peerIndex = typeof value.peer_index === "number" ? value.peer_index : null;
  switch (value.type) {
    case "challenge":
      return typeof value.challenge === "string"
        ? { type: "challenge", challenge: value.challenge }
        : { type: "other" };
    case "joined":
      return { type: "joined", pubkey, peerIndex, peers: rosterPeers(value.peers) };
    case "left":
      return { type: "left", pubkey, peerIndex };
    case "roster":
      return { type: "roster", peers: rosterPeers(value.peers) };
    case "error":
    case "restricted":
      return {
        type: "error",
        code: typeof value.code === "string" ? value.code : null,
        message: typeof value.message === "string" ? value.message : "",
      };
    default:
      return { type: "other" };
  }
}

/**
 * Classify a relay error. `retry` errors are transient (reconnect with
 * backoff); every other code ends the session.
 */
export function classifyRelayError(
  code: string | null,
  message: string,
): HuddleErrorCode | "retry" {
  const text = message.toLowerCase();
  if (code === "membership_revoked") return "revoked";
  if (code === "room_ended" || text.includes("huddle has ended")) return "ended";
  if (code === "room_full") return "full";
  if (
    code === "huddle_audio_unavailable" ||
    code === "unsupported_version" ||
    code === "upgrade_required"
  ) {
    return "unsupported";
  }
  if (text.includes("not a member") || text.includes("not a relay member")) return "notMember";
  if (text.includes("auth failed")) return "auth";
  return "retry";
}
