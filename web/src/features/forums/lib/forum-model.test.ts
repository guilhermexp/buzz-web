import { describe, expect, it } from "vitest";
import {
  buildReplyTree,
  composeTopicContent,
  EMPTY_FORUM_STATE,
  type ForumReplyNode,
  type ForumState,
  mergeForumEvents,
  sortTopics,
  splitTopicContent,
  summarizeTopics,
  topicReadFrontier,
} from "@/features/forums/lib/forum-model";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CHANNEL = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const ME = "1".repeat(64);
const OTHER = "2".repeat(64);
let counter = 0;

function id(): string {
  counter += 1;
  return counter.toString(16).padStart(64, "0");
}

function post(pubkey: string, createdAt: number, content = "# Topic\n\nBody"): NostrEvent {
  return {
    id: id(),
    pubkey,
    created_at: createdAt,
    kind: 45001,
    content,
    tags: [["h", CHANNEL]],
    sig: "",
  };
}

function comment(pubkey: string, createdAt: number, root: string, parent = root): NostrEvent {
  const tags =
    parent === root
      ? [
          ["h", CHANNEL],
          ["e", root, "", "reply"],
        ]
      : [
          ["h", CHANNEL],
          ["e", root, "", "root"],
          ["e", parent, "", "reply"],
        ];
  return { id: id(), pubkey, created_at: createdAt, kind: 45003, content: "reply", tags, sig: "" };
}

function auxiliary(
  kind: number,
  pubkey: string,
  target: string,
  createdAt = 500,
  content = "",
): NostrEvent {
  return {
    id: id(),
    pubkey,
    created_at: createdAt,
    kind,
    content,
    tags: [
      ["h", CHANNEL],
      ["e", target],
    ],
    sig: "",
  };
}

function load(events: NostrEvent[]): ForumState {
  return mergeForumEvents(EMPTY_FORUM_STATE, events, CHANNEL);
}

const noReads = () => 0;

describe("mergeForumEvents", () => {
  it("ignores other channels and duplicates, returning the same state when nothing changes", () => {
    const first = post(OTHER, 10);
    const foreign = { ...post(OTHER, 11), tags: [["h", "other-channel"]] };
    const state = load([first, foreign]);
    expect([...state.posts.keys()]).toEqual([first.id]);
    expect(mergeForumEvents(state, [first, foreign], CHANNEL)).toBe(state);
  });
});

describe("edits", () => {
  it("applies the author's latest edit and rejects edits signed by someone else", () => {
    const root = post(ME, 10, "# Original");
    const state = load([
      root,
      auxiliary(40003, ME, root.id, 20, "# First edit"),
      auxiliary(40003, ME, root.id, 30, "# Second edit"),
      auxiliary(40003, OTHER, root.id, 40, "# Hijack"),
    ]);
    const [topic] = summarizeTopics(state, ME, noReads);
    expect(topic.title).toBe("Second edit");
    expect(topic.edited).toBe(true);
  });

  it("resolves an edit that arrived before its target", () => {
    const root = post(ME, 10, "# Original");
    const state = mergeForumEvents(
      load([auxiliary(40003, ME, root.id, 20, "# Later")]),
      [root],
      CHANNEL,
    );
    expect(summarizeTopics(state, ME, noReads)[0].title).toBe("Later");
  });
});

describe("summarizeTopics", () => {
  it("counts only surviving replies and tracks activity by other people", () => {
    const root = post(ME, 100);
    const mine = comment(ME, 300, root.id);
    const theirs = comment(OTHER, 200, root.id);
    const removed = comment(OTHER, 400, root.id);
    const state = load([root, mine, theirs, removed, auxiliary(9005, ME, removed.id)]);
    const [topic] = summarizeTopics(state, ME, noReads);
    expect(topic.replyCount).toBe(2);
    expect(topic.lastActivity).toBe(300);
    expect(topic.latestOtherActivity).toBe(200);
    expect(topic.participants.sort()).toEqual([ME, OTHER]);
  });

  it("marks a topic unread only when someone else was active after the read frontier", () => {
    const root = post(OTHER, 100);
    const reply = comment(OTHER, 250, root.id);
    const ownTopic = post(ME, 100);
    const ownReply = comment(ME, 400, ownTopic.id);
    const state = load([root, reply, ownTopic, ownReply]);
    const unread = (frontier: number) =>
      Object.fromEntries(
        summarizeTopics(state, ME, () => frontier).map((topic) => [topic.event.id, topic.unread]),
      );
    expect(unread(0)).toEqual({ [root.id]: true, [ownTopic.id]: false });
    expect(unread(250)).toEqual({ [root.id]: false, [ownTopic.id]: false });
  });

  it("drops deleted posts", () => {
    const root = post(ME, 100);
    expect(summarizeTopics(load([root, auxiliary(5, ME, root.id)]), ME, noReads)).toEqual([]);
  });
});

describe("topicReadFrontier", () => {
  it("uses the later of the channel and thread read contexts", () => {
    expect(topicReadFrontier({ [CHANNEL]: 50, "thread:p": 40 }, CHANNEL, "p")).toBe(50);
    expect(topicReadFrontier({ [CHANNEL]: 50, "thread:p": 90 }, CHANNEL, "p")).toBe(90);
    expect(topicReadFrontier({}, CHANNEL, "p")).toBe(0);
  });
});

describe("sortTopics", () => {
  it("orders by latest activity or by post creation", () => {
    const older = post(OTHER, 100);
    const newer = post(OTHER, 200);
    const state = load([older, newer, comment(OTHER, 300, older.id)]);
    const topics = summarizeTopics(state, ME, noReads);
    expect(sortTopics(topics, "activity").map((topic) => topic.event.id)).toEqual([
      older.id,
      newer.id,
    ]);
    expect(sortTopics(topics, "newest").map((topic) => topic.event.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
});

describe("buildReplyTree", () => {
  function shape(nodes: ForumReplyNode[]): unknown[] {
    return nodes.map((node) => [node.event.id, shape(node.children)]);
  }

  it("nests replies under their parent in chronological order", () => {
    const root = post(OTHER, 100);
    const first = comment(OTHER, 110, root.id);
    const second = comment(ME, 120, root.id);
    const nested = comment(ME, 130, root.id, first.id);
    const deeper = comment(OTHER, 140, root.id, nested.id);
    const state = load([root, deeper, second, nested, first]);
    expect(shape(buildReplyTree(state, root.id))).toEqual([
      [first.id, [[nested.id, [[deeper.id, []]]]]],
      [second.id, []],
    ]);
  });

  it("lifts replies whose parent was deleted to the top level", () => {
    const root = post(OTHER, 100);
    const parent = comment(OTHER, 110, root.id);
    const child = comment(ME, 120, root.id, parent.id);
    const state = load([root, parent, child, auxiliary(9005, ME, parent.id)]);
    expect(shape(buildReplyTree(state, root.id))).toEqual([[child.id, []]]);
  });

  it("does not lose replies that form a reference cycle", () => {
    const root = post(OTHER, 100);
    const a = comment(OTHER, 110, root.id);
    const b = comment(OTHER, 120, root.id, a.id);
    // `a` claims `b` as its parent: a forged cycle must not hide either reply.
    a.tags = [
      ["h", CHANNEL],
      ["e", root.id, "", "root"],
      ["e", b.id, "", "reply"],
    ];
    const ids = buildReplyTree(load([root, a, b]), root.id).map((node) => node.event.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });
});

describe("topic content", () => {
  it("round-trips a title as a leading heading", () => {
    const content = composeTopicContent("  Release\nplan ", "Ship **Friday**");
    expect(content).toBe("# Release plan\n\nShip **Friday**");
    expect(splitTopicContent(content)).toEqual({
      title: "Release plan",
      body: "Ship **Friday**",
      fromHeading: true,
    });
  });

  it("uses the first line of Desktop posts without a heading as plain-text title", () => {
    expect(splitTopicContent("\n**Bold** idea [link](https://buzz.example.com)\nmore")).toEqual({
      title: "Bold idea link",
      body: "more",
      fromHeading: false,
    });
  });
});
