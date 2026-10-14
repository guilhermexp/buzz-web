import { describe, expect, it } from "vitest";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import {
  buildBuzzDeepLink,
  parseBuzzDeepLink,
  stripBuzzDeepLink,
} from "@/features/push/lib/deep-link";
import { resolveDeepLink } from "@/features/push/lib/resolve-deep-link";
import type { NostrEvent } from "@/shared/api/nostr-types";

const RELAY = "ws://127.0.0.1:47300";
const CHANNEL = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_CHANNEL = "123e4567-e89b-42d3-a456-426614174001";
const EVENT = "e".repeat(64);
const ROOT = "d".repeat(64);

function channel(id: string, overrides: Partial<BuzzChannel> = {}): BuzzChannel {
  return {
    id,
    name: "general",
    description: "",
    topic: null,
    type: "stream",
    visibility: "private",
    archived: false,
    isMember: true,
    members: [],
    participantPubkeys: [],
    ...overrides,
  };
}

function event(tags: string[][], id = EVENT): NostrEvent {
  return { id, pubkey: "a".repeat(64), created_at: 1, kind: 9, tags, content: "", sig: "0" };
}

describe("deep links", () => {
  it("round-trips through the app base without dropping the base path", () => {
    const url = buildBuzzDeepLink({
      relayUrl: RELAY,
      channelId: CHANNEL,
      eventId: EVENT,
      base: "https://buzz.example/app/?stale=1#x",
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/app/");
    expect(parsed.hash).toBe("");
    expect(parseBuzzDeepLink(parsed.search)).toEqual({
      relayUrl: RELAY,
      channelId: CHANNEL,
      eventId: EVENT,
    });
  });

  it("rejects malformed or non-relay links instead of navigating", () => {
    expect(parseBuzzDeepLink("")).toBeNull();
    expect(parseBuzzDeepLink(`?community=https://evil.example&channel=${CHANNEL}`)).toBeNull();
    expect(parseBuzzDeepLink(`?community=${RELAY}&channel=../../admin`)).toBeNull();
    expect(parseBuzzDeepLink(`?community=${RELAY}&channel=${CHANNEL}&event=zz`)).toBeNull();
    expect(parseBuzzDeepLink(`?community=${RELAY}&channel=${CHANNEL}`)?.eventId).toBeNull();
  });

  it("strips only its own parameters", () => {
    expect(stripBuzzDeepLink(`?community=${RELAY}&channel=${CHANNEL}&event=${EVENT}&lang=zh`)).toBe(
      "?lang=zh",
    );
    expect(stripBuzzDeepLink(`?community=${RELAY}`)).toBe("");
  });
});

describe("resolveDeepLink", () => {
  const link = { relayUrl: RELAY, channelId: CHANNEL, eventId: EVENT };

  it("opens the exact event and its thread after the relay returns it for that channel", async () => {
    const fetched: string[] = [];
    const resolution = await resolveDeepLink(link, {
      relayUrl: `${RELAY}/`,
      channels: [channel(CHANNEL)],
      fetchEvent: async (id) => {
        fetched.push(id);
        return event([
          ["h", CHANNEL],
          ["e", ROOT, "", "root"],
        ]);
      },
      canReadChannel: async () => {
        throw new Error("the returned event already proves access");
      },
    });
    expect(fetched).toEqual([EVENT]);
    expect(resolution).toEqual({
      kind: "open",
      channelId: CHANNEL,
      eventId: EVENT,
      threadRootId: ROOT,
    });
  });

  it("never reads this session's data for another community's link", async () => {
    const resolution = await resolveDeepLink(
      { ...link, relayUrl: "ws://127.0.0.1:47320" },
      {
        relayUrl: RELAY,
        channels: [channel(CHANNEL)],
        fetchEvent: async () => {
          throw new Error("must not query");
        },
        canReadChannel: async () => {
          throw new Error("must not query");
        },
      },
    );
    expect(resolution).toEqual({ kind: "other-community", relayUrl: "ws://127.0.0.1:47320" });
  });

  it("denies when the relay withholds the event and the channel is not readable", async () => {
    const resolution = await resolveDeepLink(link, {
      relayUrl: RELAY,
      channels: [channel(CHANNEL, { isMember: false })],
      fetchEvent: async () => null,
      canReadChannel: async () => true,
    });
    expect(resolution).toEqual({ kind: "no-access" });
  });

  it("denies an event that belongs to a different channel than the link claims", async () => {
    const resolution = await resolveDeepLink(link, {
      relayUrl: RELAY,
      channels: [channel(CHANNEL), channel(OTHER_CHANNEL)],
      fetchEvent: async () => event([["h", OTHER_CHANNEL]]),
      canReadChannel: async () => true,
    });
    expect(resolution).toEqual({ kind: "no-access" });
  });

  it("reports a deleted event in a readable channel and opens the channel", async () => {
    const checked: string[] = [];
    const resolution = await resolveDeepLink(link, {
      relayUrl: RELAY,
      channels: [channel(CHANNEL)],
      fetchEvent: async () => null,
      canReadChannel: async (id) => {
        checked.push(id);
        return true;
      },
    });
    expect(checked).toEqual([CHANNEL]);
    expect(resolution).toEqual({ kind: "missing", channelId: CHANNEL });
  });

  it("denies a channel the cached list still shows once the relay refuses reading it", async () => {
    const stale = { channels: [channel(CHANNEL)], canReadChannel: async () => false };
    expect(
      await resolveDeepLink(link, { relayUrl: RELAY, ...stale, fetchEvent: async () => null }),
    ).toEqual({ kind: "no-access" });
    expect(
      await resolveDeepLink(
        { ...link, eventId: null },
        {
          relayUrl: RELAY,
          ...stale,
          fetchEvent: async () => {
            throw new Error("channel links fetch no event");
          },
        },
      ),
    ).toEqual({ kind: "no-access" });
  });
});
