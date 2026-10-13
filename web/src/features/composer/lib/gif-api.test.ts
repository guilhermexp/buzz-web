import { describe, expect, it } from "vitest";
import { buildMessageTags, contentWithAttachments } from "@/features/chat/lib/chat-model";
import {
  gifAttachment,
  gifErrorMessage,
  normalizeRelayGifs,
  relayGifCapability,
} from "@/features/composer/lib/gif-api";

const asset = (url: string) => ({ url, width: 320, height: 240, size: 1000 });

describe("relay GIF search", () => {
  it("is available only when NIP-11 advertises a safe KLIPY proxy", () => {
    const info = {
      supported_extensions: ["buzz-gif"],
      gif: { provider: "klipy", search: "/gifs/search", share: "/gifs/share" },
    };
    expect(relayGifCapability(info)).toEqual({
      searchPath: "/gifs/search",
      sharePath: "/gifs/share",
    });
    expect(relayGifCapability({ supported_extensions: ["nip-er"] })).toBeNull();
    expect(
      relayGifCapability({ ...info, gif: { ...info.gif, search: "//evil.example/x" } }),
    ).toBeNull();
    expect(
      relayGifCapability({ ...info, gif: { ...info.gif, share: "/gifs/../admin" } }),
    ).toBeNull();
  });

  it("keeps complete HTTPS GIF records and drops ads and partial assets", () => {
    const gifs = normalizeRelayGifs({
      result: true,
      data: {
        data: [
          {
            type: "gif",
            slug: "Happy Cat!",
            title: " Happy cat ",
            file: {
              md: { gif: asset("https://static.klipy.com/a.gif") },
              sm: { webp: asset("https://static.klipy.com/a.webp") },
            },
          },
          {
            type: "ad",
            slug: "ad",
            file: { md: { gif: asset("https://static.klipy.com/ad.gif") } },
          },
          {
            type: "gif",
            slug: "insecure",
            file: { md: { gif: asset("http://static.klipy.com/b.gif") } },
          },
        ],
      },
    });
    expect(gifs.map((gif) => [gif.slug, gif.title, gif.preview.url])).toEqual([
      ["Happy Cat!", "Happy cat", "https://static.klipy.com/a.webp"],
    ]);
    const attachment = gifAttachment(gifs[0]);
    expect(attachment).toMatchObject({
      sha256: "",
      type: "image/gif",
      filename: "happy-cat.gif",
      dim: "320x240",
    });
    // Desktop sends provider GIFs body-only: an image line, never an imeta tag.
    expect(contentWithAttachments("look", [attachment])).toBe(
      "look\n\n![happy-cat.gif](https://static.klipy.com/a.gif)",
    );
    expect(buildMessageTags("room", [], [attachment]).some((tag) => tag[0] === "imeta")).toBe(
      false,
    );
  });

  it("explains an unconfigured provider instead of showing empty results", () => {
    expect(gifErrorMessage(404, "GIF search is not configured")).toBe(
      "GIF search is not configured on this Relay.",
    );
    expect(gifErrorMessage(502, "GIF provider is unavailable")).toBe(
      "GIF request failed (502): GIF provider is unavailable",
    );
  });
});
