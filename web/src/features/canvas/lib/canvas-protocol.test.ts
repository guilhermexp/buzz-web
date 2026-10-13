import { describe, expect, it } from "vitest";
import {
  type CanvasRevision,
  CanvasTimelineError,
  type CanvasWriteFailure,
  canvasHistoryFilter,
  canvasRevisionFromEvent,
  canvasWriteCreatedAt,
  canvasWriteSurvived,
  canvasWriteTags,
  classifyCanvasError,
  isCanvasConflict,
  mergeRevisions,
  nextHistoryCursor,
  supersedesHead,
} from "@/features/canvas/lib/canvas-protocol";
import type { NostrEvent } from "@/shared/api/nostr-types";

const CHANNEL = "6f1d3a52-6d0a-4a40-9d3b-6e9b0c2f9a11";
const id = (char: string) => char.repeat(64);

function revision(eventId: string, createdAt: number, expected: string | null = null) {
  return {
    eventId,
    content: eventId.slice(0, 4),
    createdAt,
    author: id("9"),
    expectedRevision: expected,
  } satisfies CanvasRevision;
}

function event(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: id("a"),
    pubkey: id("B"),
    created_at: 100,
    kind: 40100,
    tags: [["h", CHANNEL]],
    content: "# Doc",
    sig: id("c"),
    ...overrides,
  } as NostrEvent;
}

describe("canvas writes", () => {
  it("asserts the loaded head, or `none` for a first write", () => {
    expect(canvasWriteTags(CHANNEL, id("a"))).toEqual([
      ["h", CHANNEL],
      ["expected-revision", id("a")],
    ]);
    expect(canvasWriteTags(CHANNEL, null)).toEqual([
      ["h", CHANNEL],
      ["expected-revision", "none"],
    ]);
  });

  it("stamps created_at strictly after the base head", () => {
    expect(canvasWriteCreatedAt(null, 1_000)).toBe(1_000);
    expect(canvasWriteCreatedAt(900, 1_000)).toBe(1_000);
    expect(canvasWriteCreatedAt(1_000, 1_000)).toBe(1_001);
    // A head slightly ahead of a lagging clock still gets superseded.
    expect(canvasWriteCreatedAt(1_060, 1_000)).toBe(1_061);
  });

  it("refuses to extend a head poisoned far into the future", () => {
    expect(() => canvasWriteCreatedAt(1_061, 1_000)).toThrow(CanvasTimelineError);
  });
});

describe("canvas revisions", () => {
  it("parses only canvas events for the requested channel", () => {
    const parsed = canvasRevisionFromEvent(
      event({
        tags: [
          ["h", CHANNEL],
          ["expected-revision", id("d")],
        ],
      }),
      CHANNEL,
    );
    expect(parsed).toEqual({
      eventId: id("a"),
      content: "# Doc",
      createdAt: 100,
      author: id("b"),
      expectedRevision: id("d"),
    });
    expect(canvasRevisionFromEvent(event({ kind: 9 }), CHANNEL)).toBeNull();
    expect(canvasRevisionFromEvent(event({ tags: [["h", "other"]] }), CHANNEL)).toBeNull();
  });

  it("orders heads like the Relay: newest first, ties by ascending id", () => {
    const older = revision(id("1"), 10);
    const tieLow = revision(id("2"), 20);
    const tieHigh = revision(id("3"), 20);
    expect(mergeRevisions([older, tieHigh], [tieLow]).map((r) => r.eventId)).toEqual([
      id("2"),
      id("3"),
      id("1"),
    ]);
    expect(supersedesHead(tieLow, tieHigh)).toBe(true);
    expect(supersedesHead(tieHigh, tieLow)).toBe(false);
    expect(supersedesHead(older, tieLow)).toBe(false);
    expect(supersedesHead(older, null)).toBe(true);
  });

  it("de-duplicates revisions that arrive from both a page and the live stream", () => {
    const head = revision(id("4"), 40);
    expect(mergeRevisions([head], [head, revision(id("5"), 30)])).toHaveLength(2);
  });
});

describe("history paging", () => {
  it("pairs until with before_id and only continues after a full page", () => {
    expect(canvasHistoryFilter(CHANNEL, 20, null)).toEqual({
      kinds: [40100],
      "#h": [CHANNEL],
      limit: 20,
    });
    expect(canvasHistoryFilter(CHANNEL, 2, { createdAt: 50, eventId: id("e") })).toMatchObject({
      until: 50,
      before_id: id("e"),
    });
    expect(() => canvasHistoryFilter(CHANNEL, 2, { createdAt: 50, eventId: "short" })).toThrow();

    const page = [revision(id("6"), 60), revision(id("5"), 50)];
    expect(nextHistoryCursor(page, 2)).toEqual({ createdAt: 50, eventId: id("5") });
    expect(nextHistoryCursor(page, 3)).toBeNull();
    expect(nextHistoryCursor([], 1)).toBeNull();
  });
});

describe("post-write verification", () => {
  const ours = id("a");
  it("survives as the head or anywhere in the head's ancestry", () => {
    expect(canvasWriteSurvived(ours, [revision(ours, 10)])).toBe(true);
    expect(canvasWriteSurvived(ours.toUpperCase(), [revision(ours, 10)])).toBe(true);
    expect(
      canvasWriteSurvived(ours, [
        revision(id("c"), 12, id("b")),
        revision(id("b"), 11, ours),
        revision(ours, 10, "none"),
      ]),
    ).toBe(true);
  });

  it("reports superseded for a stranger head, a broken chain, a cycle or no head", () => {
    expect(canvasWriteSurvived(ours, [])).toBe(false);
    expect(canvasWriteSurvived(ours, [revision(id("c"), 12, id("0")), revision(ours, 10)])).toBe(
      false,
    );
    expect(
      canvasWriteSurvived(ours, [revision(id("c"), 12, id("b")), revision(id("b"), 11, id("c"))]),
    ).toBe(false);
    expect(canvasWriteSurvived(ours, [revision(id("c"), 12, null), revision(ours, 10)])).toBe(
      false,
    );
  });
});

describe("classifyCanvasError", () => {
  it("separates CAS conflicts from access and archive rejections", () => {
    const cases: [string, CanvasWriteFailure | null][] = [
      ["conflict: canvas changed since it was loaded", "changed"],
      ["conflict: canvas revision does not exist", "missing"],
      ["conflict: canvas write does not supersede the current head", "stale"],
      ["conflict: canvas save was superseded by a concurrent write", "superseded"],
      ["restricted: not a channel member", "forbidden"],
      ["invalid: channel is archived", "archived"],
      ["rate-limited: slow down", null],
    ];
    for (const [message, expected] of cases) {
      expect(classifyCanvasError(new Error(message))).toBe(expected);
    }
    expect(classifyCanvasError(new CanvasTimelineError())).toBe("timeline");
    expect(classifyCanvasError(undefined)).toBeNull();
    expect(isCanvasConflict("stale")).toBe(true);
    expect(isCanvasConflict("superseded")).toBe(false);
    expect(isCanvasConflict("forbidden")).toBe(false);
  });
});
