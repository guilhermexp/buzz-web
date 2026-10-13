import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import { buildContentArchive, channelDirectoryName } from "./content-export-archive";
import { fetchChannelEvents } from "./content-export-fetch";
import { renderChannelTranscript, type TranscriptLabels } from "./content-export-markdown";
import {
  channelEventsInScope,
  EXPORT_KIND_ALLOWLIST,
  EXPORT_MAX_PAGES_PER_CHANNEL,
  EXPORT_PAGE_LIMIT,
  exportPageFilter,
  nextPageCursor,
  scopeChannelEvents,
} from "./content-export-model";

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const NO_RANGE = { since: null, until: null };

let counter = 0;
function event(partial: Partial<NostrEvent> & { kind: number }): NostrEvent {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, "0"),
    pubkey: ALICE,
    created_at: 1_700_000_000 + counter,
    tags: [["h", CHANNEL]],
    content: "",
    sig: "f".repeat(128),
    ...partial,
  };
}

const labels: TranscriptLabels = {
  channelId: "Channel ID",
  edited: "(edited)",
  deleted: "[message deleted]",
  reactions: "Reactions",
  canvas: "Canvas",
  empty: "No messages",
  describeSystem: () => "Alice joined",
  nameOf: (pubkey) => (pubkey === ALICE ? "Alice" : "Bob"),
};

describe("channel scoping", () => {
  it("keeps only allowlisted kinds tagged with the selected channel", () => {
    const kept = event({ kind: 9, content: "hello" });
    const events = [
      kept,
      event({ kind: 9, content: "other channel", tags: [["h", OTHER]] }),
      event({ kind: 30078, content: "encrypted app state" }),
      event({ kind: 30300, content: "encrypted reminder" }),
      event({ kind: 1, content: "global note" }),
      event({ kind: 9, content: "untagged", tags: [] }),
    ];
    const scoped = scopeChannelEvents(events, CHANNEL, NO_RANGE);
    expect(scoped.map((item) => item.id)).toEqual([kept.id]);
    expect(scoped.every((item) => EXPORT_KIND_ALLOWLIST.has(item.kind))).toBe(true);
    expect(EXPORT_KIND_ALLOWLIST.has(30078) || EXPORT_KIND_ALLOWLIST.has(30300)).toBe(false);
  });

  it("strips non-NIP-01 fields so client-side extras never reach the archive", () => {
    const leaky = { ...event({ kind: 9 }), secretKey: "nsec1leak", decrypted: "x" } as NostrEvent;
    const [archived] = scopeChannelEvents([leaky], CHANNEL, NO_RANGE);
    expect(Object.keys(archived).sort()).toEqual(
      ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"].sort(),
    );
  });

  it("removes deleted messages plus their edits and reactions, honoring only author kind:5", () => {
    const message = event({ kind: 9, content: "secret plan" });
    const edit = event({
      kind: 40003,
      content: "secret plan v2",
      tags: [
        ["h", CHANNEL],
        ["e", message.id],
      ],
    });
    const reaction = event({
      kind: 7,
      pubkey: BOB,
      content: "+",
      tags: [["e", message.id]],
    });
    const deletion = event({
      kind: 5,
      tags: [
        ["h", CHANNEL],
        ["e", message.id],
      ],
    });
    const survivor = event({ kind: 9, pubkey: BOB, content: "keep me" });
    const forgedDeletion = event({
      kind: 5,
      pubkey: ALICE,
      tags: [
        ["h", CHANNEL],
        ["e", survivor.id],
      ],
    });
    const scoped = scopeChannelEvents(
      [message, edit, reaction, deletion, survivor, forgedDeletion],
      CHANNEL,
      NO_RANGE,
    );
    const ids = scoped.map((item) => item.id);
    expect(ids).not.toContain(message.id);
    expect(ids).not.toContain(edit.id);
    expect(ids).not.toContain(reaction.id);
    expect(ids).toContain(survivor.id);
    expect(JSON.stringify(scoped)).not.toContain("secret plan");
  });

  it("applies moderator kind:9005 deletions regardless of author", () => {
    const message = event({ kind: 9, pubkey: BOB, content: "spam" });
    const modDelete = event({
      kind: 9005,
      tags: [
        ["h", CHANNEL],
        ["e", message.id],
      ],
    });
    expect(scopeChannelEvents([message, modDelete], CHANNEL, NO_RANGE).map((e) => e.id)).toEqual([
      modDelete.id,
    ]);
  });

  it("drops events outside the date range", () => {
    const early = event({ kind: 9, created_at: 100 });
    const inside = event({ kind: 9, created_at: 200 });
    const late = event({ kind: 9, created_at: 300 });
    const ids = channelEventsInScope([late, early, inside], CHANNEL, { since: 150, until: 250 });
    expect(ids.map((item) => item.id)).toEqual([inside.id]);
  });

  it("keeps h-less reactions and their removals only when the target is in this channel", () => {
    const message = event({ kind: 9, content: "ship it" });
    const foreign = event({ kind: 9, content: "elsewhere", tags: [["h", OTHER]] });
    const reaction = event({ kind: 7, pubkey: BOB, content: "🎉", tags: [["e", message.id]] });
    const removed = event({ kind: 7, pubkey: BOB, content: "👍", tags: [["e", message.id]] });
    const removal = event({ kind: 5, pubkey: BOB, tags: [["e", removed.id]] });
    const foreignReaction = event({
      kind: 7,
      pubkey: BOB,
      content: "+",
      tags: [["e", foreign.id]],
    });
    const scoped = scopeChannelEvents(
      [message, foreign, reaction, removed, removal, foreignReaction],
      CHANNEL,
      NO_RANGE,
    );
    expect(scoped.map((item) => item.id)).toEqual([message.id, reaction.id, removal.id]);
  });
});

describe("pagination", () => {
  it("moves the cursor to the oldest event of a full page and stops on a short page", () => {
    const page = Array.from({ length: 3 }, (_, index) =>
      event({ kind: 9, created_at: 50, id: `${index}`.padStart(64, "0") }),
    );
    expect(nextPageCursor(page, 3)).toEqual({ until: 50, beforeId: "0".repeat(64) });
    expect(nextPageCursor(page, 4)).toBeNull();
    expect(
      exportPageFilter(CHANNEL, { since: 10, until: 99 }, { until: 50, beforeId: "ab" }),
    ).toMatchObject({
      since: 10,
      until: 50,
      before_id: "ab",
      "#h": [CHANNEL],
    });
  });

  it("pages until the relay runs dry and fetches the canvas head separately", async () => {
    const all = Array.from({ length: EXPORT_PAGE_LIMIT + 7 }, (_, index) =>
      event({ kind: 9, created_at: 1000 + Math.floor(index / 3) }),
    ).sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id));
    const head = event({ kind: 40100, content: "# canvas" });
    const filters: Array<Record<string, unknown>> = [];
    const client = {
      query: async (filter: NostrFilter) => {
        const record = filter as unknown as Record<string, unknown>;
        filters.push(record);
        if (filter.kinds?.includes(40100)) return [head];
        const until = record.until as number | undefined;
        const beforeId = record.before_id as string | undefined;
        return all
          .filter(
            (item) =>
              until === undefined ||
              item.created_at < until ||
              (item.created_at === until && beforeId !== undefined && item.id < beforeId),
          )
          .slice(0, filter.limit);
      },
    };
    const result = await fetchChannelEvents(
      client,
      CHANNEL,
      NO_RANGE,
      new AbortController().signal,
      () => {},
    );
    expect(result.events).toHaveLength(all.length);
    expect(result.truncated).toBe(false);
    expect(result.canvasHead?.id).toBe(head.id);
    expect(filters[1].before_id).toBeDefined();
  });

  it("bounds the number of pages and reports truncation", async () => {
    let calls = 0;
    const client = {
      query: async (filter: NostrFilter) => {
        if (filter.kinds?.includes(40100)) return [];
        calls += 1;
        return Array.from({ length: EXPORT_PAGE_LIMIT }, () =>
          event({ kind: 9, created_at: 1_000_000 - calls }),
        );
      },
    };
    const result = await fetchChannelEvents(
      client,
      CHANNEL,
      NO_RANGE,
      new AbortController().signal,
      () => {},
    );
    expect(calls).toBe(EXPORT_MAX_PAGES_PER_CHANNEL);
    expect(result.truncated).toBe(true);
  });

  it("stops with an AbortError once cancelled", async () => {
    const controller = new AbortController();
    const client = {
      query: async () => {
        controller.abort();
        return Array.from({ length: EXPORT_PAGE_LIMIT }, () => event({ kind: 9 }));
      },
    };
    await expect(
      fetchChannelEvents(client, CHANNEL, NO_RANGE, controller.signal, () => {}),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("transcript", () => {
  it("applies the author's latest edit, notes deletions without content, and nests replies", () => {
    const root = event({ kind: 9, content: "original" });
    const staleEdit = event({
      kind: 40003,
      content: "first edit",
      tags: [
        ["h", CHANNEL],
        ["e", root.id],
      ],
    });
    const edit = event({
      kind: 40003,
      content: "final edit",
      tags: [
        ["h", CHANNEL],
        ["e", root.id],
      ],
    });
    const foreignEdit = event({
      kind: 40003,
      pubkey: BOB,
      content: "hijack",
      tags: [
        ["h", CHANNEL],
        ["e", root.id],
      ],
    });
    const reply = event({
      kind: 9,
      pubkey: BOB,
      content: "a reply",
      tags: [
        ["h", CHANNEL],
        ["e", root.id, "", "reply"],
      ],
    });
    const gone = event({ kind: 9, content: "classified" });
    const deletion = event({
      kind: 5,
      tags: [
        ["h", CHANNEL],
        ["e", gone.id],
      ],
    });
    const markdown = renderChannelTranscript(
      { id: CHANNEL, name: "general", type: "stream", visibility: "open" },
      [root, staleEdit, edit, foreignEdit, reply, gone, deletion],
      null,
      labels,
    );
    expect(markdown).toContain("final edit\n\n_(edited)_");
    expect(markdown).not.toContain("first edit");
    expect(markdown).not.toContain("hijack");
    expect(markdown).not.toContain("classified");
    expect(markdown).toContain("_[message deleted]_");
    expect(markdown).toContain("> a reply");
    expect(markdown).toContain(new Date(root.created_at * 1000).toISOString());
    expect(markdown.indexOf("final edit")).toBeLessThan(markdown.indexOf("> a reply"));
  });
});

describe("archive", () => {
  it("writes a manifest listing exactly the exported channels with per-channel files", () => {
    const events = [event({ kind: 9, content: "hi" })];
    const { zip } = buildContentArchive({
      relayUrl: "ws://127.0.0.1:47300",
      exporterPubkey: ALICE,
      exportedAt: new Date("2026-10-13T00:00:00Z"),
      range: NO_RANGE,
      channels: [
        {
          channel: { id: CHANNEL, name: "Général / ops!", type: "stream", visibility: "private" },
          events,
          markdown: "# x\n",
          truncated: false,
        },
      ],
    });
    const files = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    const directory = `channels/${channelDirectoryName({ id: CHANNEL, name: "Général / ops!" })}`;
    expect(directory).toBe("channels/general-ops-11111111");
    expect(manifest).toMatchObject({
      format: "buzz-web-content-export",
      version: 1,
      exporterPubkey: ALICE,
      channels: [{ id: CHANNEL, eventCount: 1, directory }],
    });
    expect(Object.keys(files).sort()).toEqual(
      ["manifest.json", `${directory}/events.json`, `${directory}/messages.md`].sort(),
    );
    expect(JSON.parse(strFromU8(files[`${directory}/events.json`]))).toEqual(events);
  });
});
