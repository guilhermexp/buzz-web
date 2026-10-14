import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestForumFocus,
  resolveForumFocus,
  subscribeForumFocus,
  takeForumFocus,
} from "@/features/forums/lib/forum-focus";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CHANNEL = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const OTHER_CHANNEL = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const POST = "a".repeat(64);
const PARENT = "b".repeat(64);
const REPLY = "c".repeat(64);

function event(kind: number, id: string, tags: string[][]): NostrEvent {
  return { id, pubkey: "1".repeat(64), created_at: 1, kind, content: "", tags, sig: "" };
}

afterEach(() => {
  // Drain any request left by a test.
  takeForumFocus(CHANNEL);
  takeForumFocus(OTHER_CHANNEL);
});

describe("resolveForumFocus", () => {
  it("opens a post directly", () => {
    expect(resolveForumFocus(event(45001, POST, [["h", CHANNEL]]), CHANNEL)).toEqual({
      postId: POST,
      replyId: null,
    });
  });

  it("opens the root post of a direct or nested reply and targets the reply", () => {
    const direct = event(45003, REPLY, [
      ["h", CHANNEL],
      ["e", POST, "", "reply"],
    ]);
    expect(resolveForumFocus(direct, CHANNEL)).toEqual({ postId: POST, replyId: REPLY });
    const nested = event(45003, REPLY, [
      ["h", CHANNEL],
      ["e", POST, "", "root"],
      ["e", PARENT, "", "reply"],
    ]);
    expect(resolveForumFocus(nested, CHANNEL)).toEqual({ postId: POST, replyId: REPLY });
  });

  it("rejects events from another channel, other kinds, or replies without a thread", () => {
    expect(resolveForumFocus(event(45001, POST, [["h", OTHER_CHANNEL]]), CHANNEL)).toBeNull();
    expect(resolveForumFocus(event(9, POST, [["h", CHANNEL]]), CHANNEL)).toBeNull();
    expect(resolveForumFocus(event(45003, REPLY, [["h", CHANNEL]]), CHANNEL)).toBeNull();
  });
});

describe("focus requests", () => {
  it("is consumed once, only by the requested channel, and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForumFocus(listener);
    requestForumFocus(CHANNEL, REPLY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeForumFocus(OTHER_CHANNEL)).toBeNull();
    expect(takeForumFocus(CHANNEL)).toBe(REPLY);
    expect(takeForumFocus(CHANNEL)).toBeNull();
    unsubscribe();
    requestForumFocus(CHANNEL, POST);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("survives until a view mounts but expires when stale", () => {
    requestForumFocus(CHANNEL, POST);
    expect(takeForumFocus(CHANNEL, Date.now() + 120_000)).toBeNull();
    expect(takeForumFocus(CHANNEL)).toBeNull();
  });
});
