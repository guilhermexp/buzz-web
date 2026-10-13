import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";
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

/** Map a Relay error envelope to a localized message plus the bounded server detail. */
export function gifErrorMessage(status: number, detail: string | undefined): string {
  if (status === 404 && detail === "GIF search is not configured") {
    return t("composer.gifNotConfigured");
  }
  if (detail === "relay_membership_required") return t("composer.gifMembershipRequired");
  if (status === 429) return t("composer.gifRateLimited");
  const base = t("composer.gifRequestFailed", { status });
  return detail ? `${base}: ${detail.slice(0, 200)}` : base;
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
  const response = await fetch(url, {
    method: "POST",
    body,
    signal,
    headers: {
      Authorization: await makeNip98AuthHeader(url, "POST", { body }),
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const envelope = (await response.json().catch(() => ({}))) as { error?: unknown };
    const detail = typeof envelope.error === "string" ? envelope.error : undefined;
    throw new GifRequestError(gifErrorMessage(response.status, detail), response.status);
  }
  return response.status === 204 ? null : response.json();
}

/** Empty query browses trending GIFs. */
export async function searchRelayGifs(
  relayUrl: string,
  pubkey: string,
  capability: RelayGifCapability,
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<RelayGif[]> {
  const payload = await relayPost(
    relayUrl,
    capability.searchPath,
    { query: query.trim().slice(0, 200), customer_id: customerId(relayUrl, pubkey), locale },
    signal,
  );
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
