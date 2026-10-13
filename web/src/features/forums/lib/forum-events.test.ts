import { describe, expect, it } from "vitest";
import {
  forumCommentTemplate,
  forumDeleteTemplate,
  forumEditTemplate,
  forumPostTemplate,
  forumReplyReference,
  nextPageCursor,
} from "@/features/forums/lib/forum-events";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CHANNEL = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const ROOT = "a".repeat(64);
const PARENT = "b".repeat(64);
const ALICE = "1".repeat(64);
const BOB = "2".repeat(64);

function event(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: "f".repeat(64),
    pubkey: ALICE,
    created_at: 100,
    kind: 45003,
    content: "",
    tags: [],
    sig: "0".repeat(128),
    ...partial,
  };
}

describe("forum event builders", () => {
  it("builds a post with Desktop's h, p, imeta order and deduplicated mentions", () => {
    const template = forumPostTemplate({
      channelId: CHANNEL,
      content: "# Title\n\nBody",
      mentions: [BOB, BOB],
      attachments: [
        {
          url: "https://buzz.example.com/media/x.png",
          sha256: "c".repeat(64),
          size: 3,
          type: "image/png",
          uploaded: 1,
          dim: "4x2",
        },
      ],
      extraTags: [["emoji", "party", "https://buzz.example.com/e.png"]],
    });
    expect(template.kind).toBe(45001);
    expect(template.tags).toEqual([
      ["h", CHANNEL],
      ["p", BOB],
      [
        "imeta",
        "url https://buzz.example.com/media/x.png",
        "m image/png",
        `x ${"c".repeat(64)}`,
        "size 3",
        "dim 4x2",
      ],
      ["emoji", "party", "https://buzz.example.com/e.png"],
    ]);
  });

  it("tags a direct reply with a single reply marker and a nested reply with root then reply", () => {
    const base = { channelId: CHANNEL, content: "hi", mentions: [], attachments: [] };
    expect(forumCommentTemplate({ ...base, rootId: ROOT, parentId: ROOT }).tags).toEqual([
      ["h", CHANNEL],
      ["e", ROOT, "", "reply"],
    ]);
    const nested = forumCommentTemplate({ ...base, rootId: ROOT, parentId: PARENT });
    expect(nested.kind).toBe(45003);
    expect(nested.tags).toEqual([
      ["h", CHANNEL],
      ["e", ROOT, "", "root"],
      ["e", PARENT, "", "reply"],
    ]);
  });

  it("keeps media and emoji tags on edits but not the original thread or mention tags", () => {
    const target = event({
      id: PARENT,
      tags: [
        ["h", CHANNEL],
        ["e", ROOT, "", "reply"],
        ["p", BOB],
        ["imeta", "url https://buzz.example.com/media/y.pdf"],
        ["emoji", "wave", "https://buzz.example.com/w.png"],
      ],
    });
    const template = forumEditTemplate({
      channelId: CHANNEL,
      target,
      content: "new",
      addedMentions: [ALICE],
    });
    expect(template).toEqual({
      kind: 40003,
      content: "new",
      tags: [
        ["h", CHANNEL],
        ["e", PARENT],
        ["imeta", "url https://buzz.example.com/media/y.pdf"],
        ["emoji", "wave", "https://buzz.example.com/w.png"],
        ["p", ALICE],
      ],
    });
  });

  it("deletes own events with kind 5 and others' events with moderator kind 9005", () => {
    expect(
      forumDeleteTemplate({ channelId: CHANNEL, targetId: PARENT, asModerator: false }),
    ).toEqual({
      kind: 5,
      content: "",
      tags: [
        ["h", CHANNEL],
        ["e", PARENT],
      ],
    });
    expect(
      forumDeleteTemplate({ channelId: CHANNEL, targetId: PARENT, asModerator: true }).kind,
    ).toBe(9005);
  });
});

describe("forumReplyReference", () => {
  it("treats a lone reply marker as a direct reply to the root", () => {
    expect(forumReplyReference(event({ tags: [["e", ROOT, "", "reply"]] }))).toEqual({
      rootId: ROOT,
      parentId: ROOT,
    });
  });

  it("reads root and reply markers regardless of order", () => {
    expect(
      forumReplyReference(
        event({
          tags: [
            ["e", PARENT, "", "reply"],
            ["e", ROOT, "", "root"],
          ],
        }),
      ),
    ).toEqual({ rootId: ROOT, parentId: PARENT });
  });

  it("falls back to an unmarked e tag as parent and root", () => {
    expect(forumReplyReference(event({ tags: [["e", ROOT]] }))).toEqual({
      rootId: ROOT,
      parentId: ROOT,
    });
    expect(forumReplyReference(event({ tags: [["h", CHANNEL]] }))).toEqual({
      rootId: null,
      parentId: null,
    });
  });
});

describe("nextPageCursor", () => {
  it("points at the oldest event, using the largest id within that second", () => {
    const page = [
      event({ id: "3".repeat(64), created_at: 50 }),
      event({ id: "1".repeat(64), created_at: 40 }),
      event({ id: "2".repeat(64), created_at: 40 }),
    ];
    expect(nextPageCursor(page)).toEqual({ until: 40, beforeId: "2".repeat(64) });
    expect(nextPageCursor([])).toBeNull();
  });
});
