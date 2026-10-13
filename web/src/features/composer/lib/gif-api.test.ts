import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMessageTags, contentWithAttachments } from "@/features/chat/lib/chat-model";
import {
  GifRequestError,
  gifAttachment,
  gifErrorMessage,
  normalizeRelayGifs,
  relayGifCapability,
  reportRelayGifShare,
  searchRelayGifs,
} from "@/features/composer/lib/gif-api";

vi.mock("@/shared/lib/nip98", () => ({
  makeNip98AuthHeader: vi.fn(async () => "Nostr signed"),
}));

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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const relayStatuses: [number, string | undefined, string, string][] = [
    [
      400,
      "query must be 0 through 200 characters",
      "The Relay rejected this GIF request as invalid. (400: query must be 0 through 200 characters)",
      "Relay 认为此 GIF 请求无效并已拒绝。 (400: query must be 0 through 200 characters)",
    ],
    [
      401,
      "authentication required",
      "The Relay could not verify your signed GIF request. Sign in again and retry. (401: authentication required)",
      "Relay 无法验证你签名的 GIF 请求，请重新登录后重试。 (401: authentication required)",
    ],
    [
      403,
      "relay_membership_required",
      "Join this community to search GIFs. (403)",
      "加入此社区后才能搜索 GIF。 (403)",
    ],
    [
      403,
      "evidence rejected",
      "The Relay could not verify your signed GIF request. Sign in again and retry. (403: evidence rejected)",
      "Relay 无法验证你签名的 GIF 请求，请重新登录后重试。 (403: evidence rejected)",
    ],
    [
      403,
      "authorization denied",
      "You are not allowed to use GIF search on this Relay. (403: authorization denied)",
      "你无权使用此 Relay 的 GIF 搜索。 (403: authorization denied)",
    ],
    [
      404,
      "GIF search is not configured",
      "GIF search is not configured on this Relay. (404)",
      "此 Relay 未配置 GIF 搜索。 (404)",
    ],
    [
      429,
      "rate-limited: GIF search quota exceeded; retry in 41s",
      "Too many GIF searches. Try again shortly. (429: rate-limited: GIF search quota exceeded; retry in 41s)",
      "GIF 搜索过于频繁，请稍后再试。 (429: rate-limited: GIF search quota exceeded; retry in 41s)",
    ],
    [
      502,
      "GIF provider rejected the search request",
      "The GIF provider is unavailable or rejected the request. Try again later. (502: GIF provider rejected the search request)",
      "GIF 服务不可用或拒绝了该请求，请稍后再试。 (502: GIF provider rejected the search request)",
    ],
    [
      503,
      "rate-limited: GIF search admission unavailable",
      "GIF search is temporarily unavailable on this Relay. Try again later. (503: rate-limited: GIF search admission unavailable)",
      "此 Relay 的 GIF 搜索暂时不可用，请稍后再试。 (503: rate-limited: GIF search admission unavailable)",
    ],
    [504, undefined, "The GIF request timed out. Try again. (504)", "GIF 请求超时，请重试。 (504)"],
    [
      500,
      "internal error",
      "GIF request failed. (500: internal error)",
      "GIF 请求失败。 (500: internal error)",
    ],
  ];

  it.each(relayStatuses)(
    "maps Relay status %i (%s) to localized copy",
    (status, detail, en, zh) => {
      vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
      expect(gifErrorMessage(status, detail)).toBe(en);
      vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
      expect(gifErrorMessage(status, detail)).toBe(zh);
    },
  );

  it("bounds untrusted Relay detail", () => {
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    const message = gifErrorMessage(502, `bad\n\n${"x".repeat(500)}`);
    expect(message).toMatch(/^The GIF provider is unavailable or rejected the request\./);
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThan(300);
  });
});

describe("relay GIF transport", () => {
  const relayUrl = "wss://buzz.example.com";
  const pubkey = "a".repeat(64);
  const capability = { searchPath: "/gifs/search", sharePath: "/gifs/share" };

  function stubBrowser(language: string) {
    const storage = new Map<string, string>();
    vi.stubGlobal("navigator", { language, languages: [language] });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  }

  function stubFetch(response: () => Promise<Response>) {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const sentBody = (call: [string, RequestInit]) => JSON.parse(String(call[1].body));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("signs trending/search requests with a stable customer id and the browser locale", async () => {
    stubBrowser("pt-BR");
    const gif = {
      type: "gif",
      slug: "wave",
      title: "Wave",
      file: { md: { gif: asset("https://static.klipy.com/wave.gif") } },
    };
    const fetchMock = stubFetch(async () => Response.json({ result: true, data: { data: [gif] } }));

    expect(await searchRelayGifs(relayUrl, pubkey, capability, "  ")).toHaveLength(1);
    const [found] = await searchRelayGifs(relayUrl, pubkey, capability, " wave ");
    await reportRelayGifShare(relayUrl, pubkey, capability, found);

    const [trending, search, share] = fetchMock.mock.calls;
    expect(trending[0]).toBe("https://buzz.example.com/gifs/search");
    expect(trending[1]).toMatchObject({ method: "POST" });
    expect(new Headers(trending[1].headers).get("Authorization")).toBe("Nostr signed");
    expect(sentBody(trending)).toMatchObject({ query: "", locale: "pt-BR" });
    expect(sentBody(search)).toMatchObject({ query: "wave", locale: "pt-BR" });
    expect(share[0]).toBe("https://buzz.example.com/gifs/share");
    expect(sentBody(share)).toEqual({
      slug: "wave",
      customer_id: sentBody(trending).customer_id,
    });
    expect(sentBody(search).customer_id).toBe(sentBody(trending).customer_id);
  });

  it("maps plain-text NIP-FI denials and JSON envelopes from the Relay", async () => {
    stubBrowser("en-US");
    stubFetch(async () => new Response("evidence rejected\n", { status: 403 }));
    await expect(searchRelayGifs(relayUrl, pubkey, capability, "cat")).rejects.toMatchObject({
      status: 403,
      message:
        "The Relay could not verify your signed GIF request. Sign in again and retry. (403: evidence rejected)",
    });

    stubFetch(async () =>
      Response.json({ error: "GIF provider rejected the search request" }, { status: 502 }),
    );
    await expect(searchRelayGifs(relayUrl, pubkey, capability, "cat")).rejects.toBeInstanceOf(
      GifRequestError,
    );
  });

  it("treats an unsuccessful provider envelope as a provider failure", async () => {
    stubBrowser("zh-CN");
    stubFetch(async () => Response.json({ result: false }));
    await expect(searchRelayGifs(relayUrl, pubkey, capability, "cat")).rejects.toMatchObject({
      status: 502,
      message: "GIF 服务不可用或拒绝了该请求，请稍后再试。 (502)",
    });
  });

  it("maps a client-side timeout and a network failure to localized copy", async () => {
    stubBrowser("zh-CN");
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
    );
    stubFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    await expect(searchRelayGifs(relayUrl, pubkey, capability, "cat")).rejects.toMatchObject({
      status: 408,
      message: "GIF 请求超时，请重试。",
    });

    vi.mocked(AbortSignal.timeout).mockRestore();
    stubBrowser("en-US");
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(searchRelayGifs(relayUrl, pubkey, capability, "cat")).rejects.toMatchObject({
      status: 0,
      message: "Could not reach the Relay for GIF search.",
    });
  });

  it("rethrows the caller's own cancellation unchanged", async () => {
    stubBrowser("en-US");
    const controller = new AbortController();
    controller.abort();
    stubFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(
      searchRelayGifs(relayUrl, pubkey, capability, "cat", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
