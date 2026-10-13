import { describe, expect, it } from "vitest";
import {
  aggregateLikes,
  buildContactListTemplate,
  buildLikeTemplate,
  buildNoteTemplate,
  buildUnlikeTemplate,
  contactPubkeys,
  getReplyParent,
  getThreadRoot,
  latestEvent,
  likedNoteIds,
  MAX_NOTE_BYTES,
  mergeNotes,
  searchNotes,
} from "@/features/pulse/lib/pulse-events";
import type { NostrEvent } from "@/shared/api/nostr-types";

const ME = "a".repeat(64);
const ALICE = "b".repeat(64);
const BOB = "c".repeat(64);
const id = (n: number) => n.toString(16).padStart(64, "0");

function event(partial: Partial<NostrEvent> & { id: string }): NostrEvent {
  return { kind: 1, pubkey: ALICE, created_at: 100, content: "", tags: [], sig: "", ...partial };
}

describe("feed merging", () => {
  it("drops project comments and non-notes, dedupes, and sorts newest first", () => {
    const notes = mergeNotes(
      [event({ id: id(1), created_at: 10 })],
      [
        event({ id: id(1), created_at: 10 }),
        event({ id: id(2), created_at: 30 }),
        event({ id: id(3), created_at: 20, tags: [["a", `30617:${ALICE}:repo`]] }),
        event({ id: id(4), created_at: 40, kind: 7 }),
        event({ id: id(5), created_at: 20, tags: [["a", `30023:${ALICE}:article`]] }),
      ],
    );
    expect(notes.map((note) => note.id)).toEqual([id(2), id(5), id(1)]);
  });
});

describe("NIP-10 threading", () => {
  it("prefers the marked reply, then the last positional e, then the root", () => {
    expect(
      getReplyParent(
        event({
          id: id(9),
          tags: [
            ["e", id(1), "", "root"],
            ["e", id(2), "", "reply"],
          ],
        }),
      ),
    ).toBe(id(2));
    expect(
      getReplyParent(
        event({
          id: id(9),
          tags: [
            ["e", id(1)],
            ["e", id(2)],
          ],
        }),
      ),
    ).toBe(id(2));
    expect(getReplyParent(event({ id: id(9), tags: [["e", id(1), "", "root"]] }))).toBe(id(1));
    expect(getReplyParent(event({ id: id(9) }))).toBeNull();
  });

  it("finds the root for marked, positional and desktop reply-only notes", () => {
    expect(
      getThreadRoot(
        event({
          id: id(9),
          tags: [
            ["e", id(2), "", "reply"],
            ["e", id(1), "", "root"],
          ],
        }),
      ),
    ).toBe(id(1));
    expect(
      getThreadRoot(
        event({
          id: id(9),
          tags: [
            ["e", id(1)],
            ["e", id(2)],
          ],
        }),
      ),
    ).toBe(id(1));
    expect(getThreadRoot(event({ id: id(9), tags: [["e", id(2), "", "reply"]] }))).toBe(id(2));
  });

  it("replies to a top-level note with a single reply marker and the author p tag", () => {
    const parent = event({ id: id(1), pubkey: ALICE });
    expect(buildNoteTemplate("  hi  ", { parent, mentions: [BOB, ALICE.toUpperCase()] })).toEqual({
      kind: 1,
      content: "hi",
      tags: [
        ["e", id(1), "", "reply"],
        ["p", ALICE],
        ["p", BOB],
      ],
    });
  });

  it("carries the thread root when replying to a reply", () => {
    const parent = event({ id: id(2), pubkey: BOB, tags: [["e", id(1), "", "reply"]] });
    expect(buildNoteTemplate("deep", { parent }).tags).toEqual([
      ["e", id(1), "", "root"],
      ["e", id(2), "", "reply"],
      ["p", BOB],
    ]);
  });

  it("rejects empty and over-limit notes, counting UTF-8 bytes", () => {
    expect(() => buildNoteTemplate("   ")).toThrow();
    expect(() => buildNoteTemplate("é".repeat(MAX_NOTE_BYTES / 2 + 1))).toThrow();
    expect(buildNoteTemplate("é".repeat(MAX_NOTE_BYTES / 2)).content).toHaveLength(
      MAX_NOTE_BYTES / 2,
    );
  });
});

describe("likes", () => {
  it("builds NIP-25 likes and NIP-09 reaction deletions", () => {
    expect(buildLikeTemplate({ id: id(1), pubkey: ALICE, kind: 1 }).tags).toEqual([
      ["e", id(1)],
      ["p", ALICE],
      ["k", "1"],
    ]);
    expect(buildUnlikeTemplate(id(7)).tags).toEqual([
      ["e", id(7)],
      ["k", "7"],
    ]);
  });

  it("counts distinct reactors, honours only self-deletions and ignores other emoji", () => {
    const reactions = [
      event({ id: id(10), kind: 7, pubkey: ME, content: "+", tags: [["e", id(1)]], created_at: 1 }),
      event({ id: id(11), kind: 7, pubkey: ALICE, content: "+", tags: [["e", id(1)]] }),
      event({ id: id(12), kind: 7, pubkey: ALICE, content: "", tags: [["e", id(1)]] }),
      event({ id: id(13), kind: 7, pubkey: BOB, content: "🔥", tags: [["e", id(1)]] }),
      event({ id: id(14), kind: 7, pubkey: BOB, content: "+", tags: [["e", id(2)]] }),
      // Target = last e tag that is a visible note (desktop last_matching_event_tag_id).
      event({
        id: id(15),
        kind: 7,
        pubkey: BOB,
        content: "+",
        tags: [
          ["e", id(2)],
          ["e", id(99)],
        ],
      }),
    ];
    const deletions = [
      event({ id: id(20), kind: 5, pubkey: BOB, tags: [["e", id(14)]] }),
      // Someone else cannot delete my reaction.
      event({ id: id(21), kind: 5, pubkey: ALICE, tags: [["e", id(10)]] }),
    ];
    const likes = aggregateLikes([id(1), id(2), id(3)], reactions, deletions, ME);
    expect(likes.get(id(1))).toEqual({ count: 2, myReactionId: id(10) });
    // Bob's deleted like (14) is gone; his like via the multi-e reaction (15) counts.
    expect(likes.get(id(2))).toEqual({ count: 1, myReactionId: null });
    expect(likes.get(id(3))).toEqual({ count: 0, myReactionId: null });
  });

  it("drops my like once I delete it", () => {
    const reaction = event({ id: id(10), kind: 7, pubkey: ME, content: "+", tags: [["e", id(1)]] });
    const deletion = event({
      id: id(11),
      kind: 5,
      pubkey: ME,
      tags: [
        ["e", id(10)],
        ["k", "7"],
      ],
    });
    expect(aggregateLikes([id(1)], [reaction], [deletion], ME).get(id(1))).toEqual({
      count: 0,
      myReactionId: null,
    });
  });

  it("lists liked notes newest like first, minus deleted reactions, without duplicates", () => {
    const reactions = [
      event({ id: id(10), kind: 7, pubkey: ME, content: "+", tags: [["e", id(1)]], created_at: 1 }),
      event({ id: id(11), kind: 7, pubkey: ME, content: "+", tags: [["e", id(2)]], created_at: 3 }),
      event({ id: id(12), kind: 7, pubkey: ME, content: "+", tags: [["e", id(3)]], created_at: 2 }),
      event({ id: id(13), kind: 7, pubkey: ME, content: "+", tags: [["e", id(1)]], created_at: 4 }),
      event({
        id: id(14),
        kind: 7,
        pubkey: ME,
        content: "👀",
        tags: [["e", id(4)]],
        created_at: 5,
      }),
    ];
    const deletions = [event({ id: id(20), kind: 5, pubkey: ME, tags: [["e", id(12)]] })];
    expect(likedNoteIds(reactions, deletions, 10)).toEqual([id(1), id(2)]);
    expect(likedNoteIds(reactions, deletions, 1)).toEqual([id(1)]);
  });
});

describe("contact list", () => {
  const list = event({
    id: id(30),
    kind: 3,
    pubkey: ME,
    created_at: 500,
    content: '{"wss://relay.example":{"read":true}}',
    tags: [
      ["p", ALICE, "wss://relay.example", "alice"],
      ["t", "buzz"],
    ],
  });

  it("adds a follow while preserving every existing tag and the content", () => {
    const next = buildContactListTemplate(list, BOB, true, 100);
    expect(next.tags).toEqual([
      ["p", ALICE, "wss://relay.example", "alice"],
      ["t", "buzz"],
      ["p", BOB],
    ]);
    expect(next.content).toBe(list.content);
    // Clock behind the stored list: still supersedes it.
    expect(next.created_at).toBe(501);
  });

  it("keeps petnames when re-following and removes only the target on unfollow", () => {
    expect(buildContactListTemplate(list, ALICE.toUpperCase(), true, 900).tags).toEqual(list.tags);
    expect(buildContactListTemplate(list, ALICE, false, 900)).toMatchObject({
      tags: [["t", "buzz"]],
      created_at: 900,
    });
  });

  it("starts a fresh list when none exists and rejects invalid pubkeys", () => {
    expect(buildContactListTemplate(null, BOB, true, 7)).toEqual({
      kind: 3,
      content: "",
      tags: [["p", BOB]],
      created_at: 7,
    });
    expect(() => buildContactListTemplate(list, "npub-nope", true, 7)).toThrow();
  });

  it("reads unique valid follows and picks the newest replaceable event", () => {
    expect(
      contactPubkeys(
        event({
          id: id(1),
          tags: [
            ["p", ALICE],
            ["p", ALICE.toUpperCase()],
            ["p", "x"],
            ["e", BOB],
          ],
        }),
      ),
    ).toEqual([ALICE]);
    const older = event({ id: id(2), created_at: 1 });
    const tieLow = event({ id: id(3), created_at: 5 });
    const tieHigh = event({ id: id(4), created_at: 5 });
    expect(latestEvent([older, tieHigh, tieLow])?.id).toBe(id(3));
    expect(latestEvent([])).toBeNull();
  });
});

describe("client-side search", () => {
  it("requires every word to match content or author name, case-insensitively", () => {
    const notes = [
      event({ id: id(1), pubkey: ALICE, content: "Shipping the Relay today" }),
      event({ id: id(2), pubkey: BOB, content: "relay maintenance" }),
    ];
    const names: Record<string, string> = { [ALICE]: "Alice", [BOB]: "Bob" };
    const search = (query: string) =>
      searchNotes(notes, query, (pubkey) => names[pubkey] ?? "").map((note) => note.id);
    expect(search("RELAY")).toEqual([id(1), id(2)]);
    expect(search("relay bob")).toEqual([id(2)]);
    expect(search("   ")).toEqual([]);
  });
});
