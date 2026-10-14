import { describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_SET_D_TAG,
  customEmojiFromTags,
  customEmojiPalette,
  customEmojiTags,
} from "@/features/composer/lib/custom-emoji";
import type { NostrEvent } from "@/shared/api/nostr-types";

function emojiSet(
  createdAt: number,
  tags: string[][],
  d = CUSTOM_EMOJI_SET_D_TAG,
  pubkey = "f".repeat(64),
): NostrEvent {
  return {
    id: `${pubkey.slice(0, 8)}${String(createdAt).padStart(56, "0")}`,
    pubkey,
    created_at: createdAt,
    kind: 30030,
    content: "",
    tags: [["d", d], ...tags],
    sig: "0".repeat(128),
  };
}

describe("custom emoji", () => {
  it("unions member sets with the newest URL winning per shortcode", () => {
    const palette = customEmojiPalette([
      emojiSet(10, [["emoji", "party", "https://buzz.example.com/media/old.png"]]),
      emojiSet(20, [
        ["emoji", "PARTY", "https://buzz.example.com/media/new.png"],
        ["emoji", "bad code!", "https://buzz.example.com/media/x.png"],
        ["emoji", "script", "javascript:alert(1)"],
      ]),
      emojiSet(30, [["emoji", "other", "https://buzz.example.com/a.png"]], "someone-else"),
    ]);
    expect(palette).toEqual([
      { shortcode: "party", url: "https://buzz.example.com/media/new.png" },
    ]);
  });

  it("drops emoji a member removed from their replaceable set, even if an older set lingers", () => {
    const alice = "a".repeat(64);
    const bob = "b".repeat(64);
    const palette = customEmojiPalette([
      emojiSet(
        10,
        [
          ["emoji", "party", "https://buzz.example.com/media/party.png"],
          ["emoji", "wave", "https://buzz.example.com/media/wave.png"],
        ],
        CUSTOM_EMOJI_SET_D_TAG,
        alice,
      ),
      emojiSet(
        20,
        [["emoji", "party", "https://buzz.example.com/media/party.png"]],
        CUSTOM_EMOJI_SET_D_TAG,
        alice,
      ),
      emojiSet(
        15,
        [["emoji", "ship", "https://buzz.example.com/media/ship.png"]],
        CUSTOM_EMOJI_SET_D_TAG,
        bob,
      ),
    ]);
    expect(palette).toEqual([
      { shortcode: "party", url: "https://buzz.example.com/media/party.png" },
      { shortcode: "ship", url: "https://buzz.example.com/media/ship.png" },
    ]);
  });

  it("tags each known shortcode once, in order of first use", () => {
    const palette = [
      { shortcode: "party", url: "https://buzz.example.com/p.png" },
      { shortcode: "ship-it", url: "https://buzz.example.com/s.png" },
    ];
    expect(customEmojiTags(":ship-it: then :party: :party: :unknown:", palette)).toEqual([
      ["emoji", "ship-it", "https://buzz.example.com/s.png"],
      ["emoji", "party", "https://buzz.example.com/p.png"],
    ]);
  });

  it("reads only safe emoji tags from a message", () => {
    expect(
      customEmojiFromTags([
        ["emoji", "ok", "https://buzz.example.com/ok.png"],
        ["emoji", "evil", "data:image/png;base64,AAAA"],
        ["p", "a".repeat(64)],
      ]),
    ).toEqual([{ shortcode: "ok", url: "https://buzz.example.com/ok.png" }]);
  });
});
