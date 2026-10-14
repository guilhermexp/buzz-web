import { describe, expect, it } from "vitest";
import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import { AmbiguousMentionError } from "@/features/composer/lib/mention-bindings";
import { composeNote } from "@/features/pulse/lib/pulse-compose";
import { buildNoteTemplate } from "@/features/pulse/lib/pulse-events";

const ALICE = "b".repeat(64);
const BOB = "c".repeat(64);
const OTHER_ALICE = "d".repeat(64);

const image: AttachmentDescriptor = {
  url: "https://relay.example/media/abc.png",
  sha256: "e".repeat(64),
  size: 68,
  type: "image/png",
  uploaded: 1,
  dim: "1x1",
  filename: "pixel.png",
};

describe("composeNote", () => {
  it("resolves picker bindings and typed names, appends media and emits imeta only", () => {
    const note = composeNote("  hi @Alice and @Bob  ", [image], new Map([["Alice", ALICE]]), [
      { displayName: "Bob", pubkey: BOB },
    ]);
    expect(note.mentions).toEqual([ALICE, BOB]);
    expect(note.content).toBe(`hi @Alice and @Bob\n\n![pixel.png](${image.url})`);
    expect(note.mediaTags).toEqual([
      [
        "imeta",
        `url ${image.url}`,
        "m image/png",
        `x ${image.sha256}`,
        "size 68",
        "dim 1x1",
        "filename pixel.png",
      ],
    ]);
  });

  it("drops bindings whose label was deleted and refuses an ambiguous typed name", () => {
    expect(composeNote("no mention", [], new Map([["Alice", ALICE]]), []).mentions).toEqual([]);
    expect(() =>
      composeNote("@Alice", [], new Map(), [
        { displayName: "Alice", pubkey: ALICE },
        { displayName: "Alice", pubkey: OTHER_ALICE },
      ]),
    ).toThrow(AmbiguousMentionError);
  });

  it("allows a media-only note and keeps body-only external media out of imeta", () => {
    const gif = { ...image, sha256: "", url: "https://gifs.example/a.gif", filename: "a.gif" };
    const note = composeNote("", [image, gif], new Map(), []);
    expect(note.content).toBe(`![pixel.png](${image.url})\n\n![a.gif](${gif.url})`);
    expect(note.mediaTags).toHaveLength(1);
  });

  it("feeds a kind 1 template: e/p tags first, then imeta, never a channel tag", () => {
    const note = composeNote("@Alice", [image], new Map([["Alice", ALICE]]), []);
    const template = buildNoteTemplate(note.content, {
      mentions: note.mentions,
      mediaTags: [...note.mediaTags, ["h", "channel"]],
    });
    expect(template.tags.map((tag) => tag[0])).toEqual(["p", "imeta"]);
  });
});
