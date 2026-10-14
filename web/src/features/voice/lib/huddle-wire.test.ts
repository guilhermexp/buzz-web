import { describe, expect, it } from "vitest";
import {
  classifyRelayError,
  encodeFrame,
  FLAG_DTX,
  levelDbov,
  parseControl,
  parseInboundFrame,
} from "@/features/voice/lib/huddle-wire";

const PEER = "a".repeat(64);

describe("media frames", () => {
  it("encodes the v2 big-endian header that the relay forwards behind a peer index", () => {
    const opus = Uint8Array.of(0x48, 1, 2, 3);
    const frame = encodeFrame(
      { seq: 0x1_0002, ts48k: 0x1_0000_03c0, levelDbov: -20.4, flags: FLAG_DTX },
      opus,
    );
    expect([...frame.subarray(0, 8)]).toEqual([0x00, 0x02, 0x00, 0x00, 0x03, 0xc0, 0xec, 0x01]);
    const relayed = new Uint8Array(1 + frame.length);
    relayed[0] = 7;
    relayed.set(frame, 1);
    const parsed = parseInboundFrame(relayed);
    expect(parsed?.peerIndex).toBe(7);
    expect(parsed?.header).toEqual({ seq: 2, ts48k: 0x3c0, levelDbov: -20, flags: FLAG_DTX });
    expect([...(parsed?.opus ?? [])]).toEqual([...opus]);
  });

  it("clamps levels into the dBov range and rejects frames without payload", () => {
    const loud = encodeFrame({ seq: 0, ts48k: 0, levelDbov: 6, flags: 0 }, Uint8Array.of(1));
    expect(new DataView(loud.buffer).getInt8(6)).toBe(0);
    const quiet = encodeFrame({ seq: 0, ts48k: 0, levelDbov: -400, flags: 0 }, Uint8Array.of(1));
    expect(new DataView(quiet.buffer).getInt8(6)).toBe(-127);
    expect(parseInboundFrame(new Uint8Array(9))).toBeNull();
  });

  it("measures dBov like desktop audio_level_dbov", () => {
    expect(levelDbov(new Float32Array(960))).toBe(-127);
    expect(levelDbov(new Float32Array(960).fill(1))).toBe(0);
    const sine = Float32Array.from(
      { length: 960 },
      (_, i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 48_000),
    );
    expect(levelDbov(sine)).toBeGreaterThanOrEqual(-20);
    expect(levelDbov(sine)).toBeLessThanOrEqual(-8);
  });
});

describe("control messages", () => {
  it("reads joined/left/roster and drops malformed roster entries", () => {
    const joined = parseControl(
      JSON.stringify({
        type: "joined",
        pubkey: PEER.toUpperCase(),
        peer_index: 3,
        epoch: 1,
        peers: [
          { pubkey: PEER, peer_index: 3 },
          { pubkey: "nope", peer_index: 4 },
          { pubkey: PEER },
        ],
      }),
    );
    expect(joined).toEqual({
      type: "joined",
      pubkey: PEER,
      peerIndex: 3,
      peers: [{ pubkey: PEER, peerIndex: 3 }],
    });
    expect(parseControl(JSON.stringify({ type: "left", pubkey: PEER, peer_index: 3 }))).toEqual({
      type: "left",
      pubkey: PEER,
      peerIndex: 3,
    });
    expect(parseControl("not json")).toEqual({ type: "other" });
    expect(parseControl(JSON.stringify({ type: "challenge" }))).toEqual({ type: "other" });
  });

  it("treats revocation and authorization failures as terminal, transient relay states as retryable", () => {
    expect(classifyRelayError("membership_revoked", "error: membership revoked")).toBe("revoked");
    expect(classifyRelayError(null, "not a member")).toBe("notMember");
    expect(classifyRelayError(null, "error: not a member")).toBe("notMember");
    expect(classifyRelayError(null, "restricted: not a relay member")).toBe("notMember");
    expect(classifyRelayError("room_ended", "huddle has ended")).toBe("ended");
    expect(classifyRelayError(null, "huddle has ended")).toBe("ended");
    expect(classifyRelayError("room_full", "")).toBe("full");
    expect(classifyRelayError("upgrade_required", "")).toBe("unsupported");
    expect(classifyRelayError("huddle_audio_unavailable", "")).toBe("unsupported");
    expect(classifyRelayError(null, "auth failed")).toBe("auth");
    expect(classifyRelayError("huddle_relay_draining", "")).toBe("retry");
    expect(classifyRelayError("join_rejected", "")).toBe("retry");
  });
});
