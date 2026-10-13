import { describe, expect, it } from "vitest";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import {
  buildInboxItems,
  inboxPreview,
  threadNotificationRootIds,
  threadRootIds,
} from "@/features/inbox/lib/inbox-model";
import type { NostrEvent } from "@/shared/api/nostr-types";

const ME = "1".repeat(64);
const OTHER = "2".repeat(64);
const ROOT = "a".repeat(64);

function event(
  id: string,
  pubkey: string,
  kind: number,
  tags: string[][],
  content = id,
  createdAt = 1,
): NostrEvent {
  return {
    id: id.repeat(64).slice(0, 64),
    pubkey,
    kind,
    tags,
    content,
    created_at: createdAt,
    sig: "0".repeat(128),
  };
}

const channels: BuzzChannel[] = [
  {
    id: "general",
    name: "general",
    description: "",
    topic: null,
    type: "stream",
    visibility: "open",
    archived: false,
    isMember: true,
    members: [],
    participantPubkeys: [],
  },
  {
    id: "dm",
    name: "DM",
    description: "",
    topic: null,
    type: "dm",
    visibility: "private",
    archived: false,
    isMember: true,
    members: [],
    participantPubkeys: [ME, OTHER],
  },
];

describe("buildInboxItems", () => {
  it("classifies mentions, DMs, thread replies, and approvals", () => {
    const events = [
      event("a", ME, 9, [["h", "general"]], "root", 1),
      event(
        "b",
        OTHER,
        9,
        [
          ["h", "general"],
          ["p", ME],
        ],
        "mention",
        2,
      ),
      event("c", OTHER, 9, [["h", "dm"]], "dm", 3),
      event(
        "d",
        OTHER,
        9,
        [
          ["h", "general"],
          ["e", ROOT, "", "reply"],
        ],
        "reply",
        4,
      ),
      event(
        "e",
        OTHER,
        46010,
        [
          ["p", ME],
          ["d", "f".repeat(64)],
        ],
        "approval",
        5,
      ),
      event("f", OTHER, 9, [["h", "general"]], "unrelated", 6),
    ];
    const items = buildInboxItems({
      events,
      channels,
      currentPubkey: ME,
      readIds: new Set(["b".repeat(64)]),
    });

    expect(items.map((item) => item.category)).toEqual(["needs_action", "thread", "dm", "mention"]);
    expect(items[items.length - 1]?.unread).toBe(false);
    expect(items.find((item) => item.category === "thread")?.threadRootId).toBe(ROOT);
  });

  it("removes approvals after a matching result event arrives", () => {
    const reference = "f".repeat(64);
    const items = buildInboxItems({
      events: [
        event(
          "a",
          OTHER,
          46010,
          [
            ["p", ME],
            ["d", reference],
          ],
          "approval",
          1,
        ),
        event("b", OTHER, 46011, [["d", reference]], "approved", 2),
      ],
      channels,
      currentPubkey: ME,
      readIds: new Set(),
    });
    expect(items).toEqual([]);
  });

  it("keeps a decided approval visible with the Relay's recorded outcome", () => {
    const reference = "f".repeat(64);
    const request = event(
      "a",
      OTHER,
      46010,
      [
        ["p", ME],
        ["d", reference],
      ],
      JSON.stringify({
        summary: "Deploy to staging",
        workflow_id: "wf-1",
        run_id: "run-1",
        step_id: "approve",
        expires_at: 1_900_000_000,
      }),
      1,
    );
    const keepApprovalIds = new Set([request.id]);
    const pending = buildInboxItems({
      events: [request],
      channels,
      currentPubkey: ME,
      readIds: new Set(),
      keepApprovalIds,
    });
    expect(pending[0]?.approval).toMatchObject({
      reference,
      workflowId: "wf-1",
      runId: "run-1",
      stepId: "approve",
      summary: "Deploy to staging",
      expiresAt: 1_900_000_000,
      resolution: null,
    });
    const expired = buildInboxItems({
      events: [
        request,
        event(
          "b",
          OTHER,
          46012,
          [
            ["d", reference],
            ["status", "expired"],
          ],
          "",
          2,
        ),
      ],
      channels,
      currentPubkey: ME,
      readIds: new Set(),
      keepApprovalIds,
    });
    expect(expired.map((item) => item.approval?.resolution)).toEqual(["expired"]);
  });

  it("includes nested replies to threads the current user created or joined", () => {
    const otherRoot = event("3", OTHER, 9, [["h", "general"]], "other root", 1);
    const ownReply = event(
      "4",
      ME,
      9,
      [
        ["h", "general"],
        ["e", otherRoot.id, "", "reply"],
      ],
      "joining the thread",
      2,
    );
    const nestedReply = event(
      "5",
      OTHER,
      9,
      [
        ["h", "general"],
        ["e", otherRoot.id, "", "root"],
        ["e", ownReply.id, "", "reply"],
      ],
      "nested response",
      3,
    );
    const ownRoot = event("6", ME, 9, [["h", "general"]], "own root", 4);
    const ownRootReply = event(
      "7",
      OTHER,
      9,
      [
        ["h", "general"],
        ["e", ownRoot.id, "", "reply"],
      ],
      "root response",
      5,
    );

    const items = buildInboxItems({
      events: [otherRoot, ownReply, nestedReply, ownRoot, ownRootReply],
      channels,
      currentPubkey: ME,
      readIds: new Set(),
    });

    expect(items.map((item) => item.event.id)).toEqual([ownRootReply.id, nestedReply.id]);
    expect(items.every((item) => item.category === "thread")).toBe(true);
    expect(items.find((item) => item.id === nestedReply.id)?.threadRootId).toBe(otherRoot.id);
  });

  it("walks reply-only ancestors to resolve a nested thread root", () => {
    const root = event("3", OTHER, 9, [["h", "general"]]);
    const reply = event("4", ME, 9, [
      ["h", "general"],
      ["e", root.id, "", "reply"],
    ]);
    const nested = event("5", OTHER, 9, [
      ["h", "general"],
      ["e", reply.id, "", "reply"],
    ]);

    expect(threadRootIds([root, reply, nested]).get(nested.id)).toBe(root.id);
  });

  it("tracks threads authored, joined, or mentioned for notification badges", () => {
    const authored = event("3", ME, 9, [["h", "general"]]);
    const joinedRoot = event("4", OTHER, 9, [["h", "general"]]);
    const joinedReply = event("5", ME, 9, [
      ["h", "general"],
      ["e", joinedRoot.id, "", "reply"],
    ]);
    const mentionedRoot = event("6", OTHER, 9, [["h", "general"]]);
    const mention = event("7", OTHER, 9, [
      ["h", "general"],
      ["e", mentionedRoot.id, "", "reply"],
      ["p", ME],
    ]);

    expect(
      threadNotificationRootIds([authored, joinedRoot, joinedReply, mentionedRoot, mention], ME),
    ).toEqual(new Set([authored.id, joinedRoot.id, mentionedRoot.id]));
  });
});

describe("inboxPreview", () => {
  it("extracts a human-readable field from JSON event content", () => {
    expect(inboxPreview(event("a", OTHER, 46010, [], '{"summary":"Deploy now"}'))).toBe(
      "Deploy now",
    );
  });
});
