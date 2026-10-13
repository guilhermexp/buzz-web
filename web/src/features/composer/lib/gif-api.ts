import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { getLocale, type MessageKey, t } from "@/shared/i18n";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";

/**
 * GIF search goes through the Relay's KLIPY proxy (crates/buzz-relay/src/api/gifs.rs).
 * The Relay advertises it in NIP-11 only when an operator configured a provider key;
 * selected GIFs are sent as provider-hosted image URLs in the body, never re-uploaded.
 */

type KlipyAsset = { url?: string; width?: number; height?: number; size?: number };
type KlipyFileSet = { gif?: KlipyAsset; webp?: KlipyAsset; jpg?: KlipyAsset };
type KlipyRawGif = {
  id?: number;
  slug?: string;
  title?: string;
  type?: string;
  file?: { hd?: KlipyFileSet; md?: KlipyFileSet; sm?: KlipyFileSet; xs?: KlipyFileSet };
};

type CompleteAsset = Required<KlipyAsset>;

export type RelayGif = {
  slug: string;
  title: string;
  original: CompleteAsset;
  preview: CompleteAsset;
  poster: CompleteAsset | null;
};

export type RelayGifCapability = { searchPath: string; sharePath: string };

export class GifRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GifRequestError";
    this.status = status;
  }
}

function safeRelayPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\%?#]/.test(path) &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/** The safe relay-relative endpoints advertised by NIP-11, or null when GIFs are not configured. */
export function relayGifCapability(info: unknown): RelayGifCapability | null {
  if (!info || typeof info !== "object") return null;
  const value = info as {
    supported_extensions?: unknown;
    gif?: { provider?: unknown; search?: unknown; share?: unknown };
  };
  const extensions = Array.isArray(value.supported_extensions) ? value.supported_extensions : [];
  if (!extensions.includes("buzz-gif") || value.gif?.provider !== "klipy") return null;
  const { search, share } = value.gif;
  return safeRelayPath(search) && safeRelayPath(share)
    ? { searchPath: search, sharePath: share }
    : null;
}

function completeAsset(asset: KlipyAsset | undefined): asset is CompleteAsset {
  return (
    typeof asset?.url === "string" &&
    /^https:\/\//.test(asset.url) &&
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    typeof asset.size === "number"
  );
}

const firstComplete = (...assets: (KlipyAsset | undefined)[]) => assets.find(completeAsset) ?? null;

/** Keep only GIF records with complete HTTPS assets; provider ad/content records are dropped. */
export function normalizeRelayGifs(payload: unknown): RelayGif[] {
  const items = (payload as { data?: { data?: unknown } } | null)?.data?.data;
  if (!Array.isArray(items)) return [];
  const gifs: RelayGif[] = [];
  for (const item of items as KlipyRawGif[]) {
    if (item?.type !== "gif" || !item.file || !item.slug) continue;
    const { hd, md, sm, xs } = item.file;
    const original = firstComplete(md?.gif, hd?.gif, sm?.gif, xs?.gif);
    const preview = firstComplete(sm?.webp, sm?.gif, xs?.webp, xs?.gif, md?.webp, original ?? {});
    if (!original || !preview) continue;
    gifs.push({
      slug: item.slug,
      title: item.title?.trim() || "GIF",
      original,
      preview,
      poster: firstComplete(sm?.jpg, xs?.jpg, md?.jpg, hd?.jpg),
    });
  }
  return gifs;
}

/** Content-only attachment: an empty hash means "body URL, no imeta" exactly like desktop. */
export function gifAttachment(gif: RelayGif): AttachmentDescriptor {
  const slug = gif.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return {
    url: gif.original.url,
    sha256: "",
    size: gif.original.size,
    type: "image/gif",
    uploaded: 0,
    dim: `${gif.original.width}x${gif.original.height}`,
    filename: `${slug || "klipy-gif"}.gif`,
  };
}

export async function fetchRelayGifCapability(
  relayUrl: string,
  signal?: AbortSignal,
): Promise<RelayGifCapability | null> {
  const response = await fetch(`${relayHttpOrigin(relayUrl)}/info`, {
    headers: { Accept: "application/nostr+json" },
    signal,
  });
  if (!response.ok) {
    throw new GifRequestError(t("composer.gifCapabilityFailed"), response.status);
  }
  return relayGifCapability(await response.json());
}

/** 403 is resolved by detail in `statusMessage`; unlisted statuses use the generic copy. */
const STATUS_MESSAGES: Partial<Record<number, MessageKey>> = {
  400: "composer.gifInvalidRequest",
  401: "composer.gifAuthFailed",
  404: "composer.gifNotConfigured",
  408: "composer.gifTimeout",
  429: "composer.gifRateLimited",
  502: "composer.gifProviderFailed",
  503: "composer.gifTemporarilyUnavailable",
  504: "composer.gifTimeout",
};

/** Machine codes that the localized message already explains completely. */
const EXPLAINED_DETAILS: Record<string, true> = {
  relay_membership_required: true,
  "GIF search is not configured": true,
};

function statusMessage(status: number, detail: string | undefined): string {
  if (status === 403) {
    if (detail === "relay_membership_required") return t("composer.gifMembershipRequired");
    if (detail === "evidence rejected") return t("composer.gifAuthFailed");
    return t("composer.gifForbidden");
  }
  return t(STATUS_MESSAGES[status] ?? "composer.gifRequestFailed");
}

/**
 * Map a Relay status plus its (untrusted) error detail to a localized message. The detail is
 * appended verbatim but bounded, so operators can still see the Relay's stable reason.
 */
export function gifErrorMessage(status: number, detail: string | undefined): string {
  const message = statusMessage(status, detail);
  const bounded = detail?.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!bounded || EXPLAINED_DETAILS[bounded] === true) return `${message} (${status})`;
  return `${message} (${status}: ${bounded})`;
}

/** Relay errors are JSON `{ error }` envelopes, but NIP-FI denials are plain-text bodies. */
async function relayErrorDetail(response: Response): Promise<string | undefined> {
  const text = (await response.text().catch(() => "")).slice(0, 4096).trim();
  if (!text) return undefined;
  try {
    const envelope: unknown = JSON.parse(text);
    const error =
      envelope && typeof envelope === "object" && "error" in envelope ? envelope.error : undefined;
    return typeof error === "string" ? error : undefined;
  } catch {
    return text.startsWith("<") ? undefined : text;
  }
}

/** The Relay's own upstream timeout is 10s; allow for signing and one slow round trip on top. */
const GIF_REQUEST_TIMEOUT_MS = 20_000;

/** KLIPY localizes by the browser's full language tag, matching desktop. */
function providerLocale(): string {
  const language = typeof navigator === "undefined" ? "" : navigator.language;
  return (language || getLocale()).slice(0, 32);
}

function customerId(relayUrl: string, pubkey: string): string {
  const key = `buzz:web:klipy-customer-id:v1:${encodeURIComponent(relayUrl)}:${pubkey.toLowerCase()}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    // Prefer an ephemeral id over one that would correlate unrelated relays.
    return crypto.randomUUID();
  }
}

async function relayPost(
  relayUrl: string,
  path: string,
  payload: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${relayHttpOrigin(relayUrl)}${path}`;
  const body = JSON.stringify(payload);
  const timeout = AbortSignal.timeout(GIF_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        Authorization: await makeNip98AuthHeader(url, "POST", { body }),
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new GifRequestError(t("composer.gifTimeout"), 408);
    throw new GifRequestError(t("composer.gifNetworkFailed"), 0);
  }
  if (!response.ok) {
    const detail = await relayErrorDetail(response);
    throw new GifRequestError(gifErrorMessage(response.status, detail), response.status);
  }
  return response.status === 204 ? null : response.json();
}

/** Empty query browses trending GIFs; any other query uses provider search. */
export async function searchRelayGifs(
  relayUrl: string,
  pubkey: string,
  capability: RelayGifCapability,
  query: string,
  signal?: AbortSignal,
): Promise<RelayGif[]> {
  const payload = await relayPost(
    relayUrl,
    capability.searchPath,
    {
      query: query.trim().slice(0, 200),
      customer_id: customerId(relayUrl, pubkey),
      locale: providerLocale(),
    },
    signal,
  );
  if (
    !payload ||
    typeof payload !== "object" ||
    !("result" in payload) ||
    payload.result !== true
  ) {
    throw new GifRequestError(gifErrorMessage(502, undefined), 502);
  }
  return normalizeRelayGifs(payload);
}

/** Best-effort provider share report so the provider can maintain recents. */
export async function reportRelayGifShare(
  relayUrl: string,
  pubkey: string,
  capability: RelayGifCapability,
  gif: RelayGif,
): Promise<void> {
  await relayPost(relayUrl, capability.sharePath, {
    slug: gif.slug,
    customer_id: customerId(relayUrl, pubkey),
  });
}
