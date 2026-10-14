import { describe, expect, it } from "vitest";
import {
  humansInHuddle,
  isHuddleLive,
  reconstructActiveHuddle,
} from "@/features/voice/lib/huddle-presence";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CREATOR = "c".repeat(64);
const RELAY = "f".repeat(64);
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const ROOM = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";

let sequence = 0;
function lifecycle(
  kind: number,
  createdAt: number,
  room: string,
  pubkey: string,
  participant?: string,
) {
  sequence += 1;
  return {
    id: sequence.toString(16).padStart(64, "0"),
    kind,
    pubkey,
    created_at: createdAt,
    content: JSON.stringify({ ephemeral_channel_id: room }),
    tags: [["h", "parent"], ...(participant ? [["p", participant]] : [])],
    sig: "",
  } satisfies NostrEvent;
}

describe("reconstructActiveHuddle", () => {
  it("tracks relay-signed join/leave participants from their p tags", () => {
    const huddle = reconstructActiveHuddle([
      lifecycle(48100, 10, ROOM, CREATOR),
      lifecycle(48101, 11, ROOM, RELAY, ALICE),
      lifecycle(48101, 12, ROOM, RELAY, BOB),
      lifecycle(48102, 13, ROOM, RELAY, ALICE),
    ]);
    expect(huddle).toMatchObject({
      ephemeralChannelId: ROOM,
      startedBy: CREATOR,
      participants: [BOB],
    });
    expect(huddle?.lastActivity).toBe(13);
  });

  it("applies causal order within one second regardless of delivery order", () => {
    const events = [
      lifecycle(48103, 20, ROOM, CREATOR),
      lifecycle(48101, 20, ROOM, RELAY, ALICE),
      lifecycle(48100, 20, ROOM, CREATOR),
    ];
    expect(reconstructActiveHuddle(events)).toBeNull();
  });

  it("does not resurrect an ended huddle from a late relay leave event", () => {
    const events = [
      lifecycle(48100, 10, ROOM, CREATOR),
      lifecycle(48103, 15, ROOM, CREATOR),
      lifecycle(48102, 16, ROOM, RELAY, ALICE),
    ];
    expect(reconstructActiveHuddle(events)).toBeNull();
  });

  it("follows a newer huddle and infers one whose start fell out of the window", () => {
    expect(
      reconstructActiveHuddle([
        lifecycle(48100, 10, ROOM, CREATOR),
        lifecycle(48103, 11, ROOM, CREATOR),
        lifecycle(48100, 12, NEXT, ALICE),
      ])?.ephemeralChannelId,
    ).toBe(NEXT);
    expect(reconstructActiveHuddle([lifecycle(48101, 30, NEXT, RELAY, BOB)])).toMatchObject({
      ephemeralChannelId: NEXT,
      startedBy: null,
      participants: [BOB],
    });
  });

  it("ignores events without an ephemeral channel", () => {
    const malformed = { ...lifecycle(48100, 10, ROOM, CREATOR), content: "{" };
    expect(reconstructActiveHuddle([malformed])).toBeNull();
  });
});

describe("isHuddleLive", () => {
  const huddle = {
    ephemeralChannelId: ROOM,
    startedBy: CREATOR,
    participants: [],
    lastActivity: 1_000,
  };

  it("trusts the relay liveness answer, and a fresh start before anyone connected", () => {
    expect(isHuddleLive(huddle, new Set([ROOM]), 5_000)).toBe(true);
    expect(isHuddleLive(huddle, new Set(), 1_030)).toBe(true);
    expect(isHuddleLive(huddle, new Set(), 5_000)).toBe(false);
  });

  it("falls back to lifecycle state when liveness is unavailable", () => {
    expect(isHuddleLive(huddle, null, 5_000)).toBe(true);
  });
});

describe("humansInHuddle", () => {
  const AGENT = "d".repeat(64);
  const members = (tags: string[][]) =>
    ({
      id: "0".repeat(64),
      kind: 39002,
      pubkey: RELAY,
      created_at: 1,
      content: "",
      tags: [["d", ROOM], ...tags],
      sig: "",
    }) satisfies NostrEvent;

  it("counts connected peers missing from a stale member list, so the creator does not end the room", () => {
    const staleAfterAutoAdd = members([["p", CREATOR, "", "owner"]]);
    expect(humansInHuddle(staleAfterAutoAdd, [CREATOR, ALICE, BOB])).toBe(3);
  });

  it("never counts bots, whether listed or connected, and dedupes across sources", () => {
    const listed = members([
      ["p", CREATOR, "", "owner"],
      ["p", AGENT, "", "bot"],
      ["p", ALICE.toUpperCase(), "", "member"],
    ]);
    expect(humansInHuddle(listed, [CREATOR, AGENT, ALICE])).toBe(2);
  });

  it("reports the last human when only bots remain beside the leaver", () => {
    expect(humansInHuddle(members([["p", AGENT, "", "bot"]]), [CREATOR, AGENT])).toBe(1);
    expect(humansInHuddle(null, [CREATOR])).toBe(1);
  });
});
