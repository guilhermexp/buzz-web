import { normalizeRelayUrl } from "@/shared/config/runtime-config";

/** A notification or shared-link destination inside one community. */
export type BuzzDeepLink = {
  relayUrl: string;
  channelId: string;
  eventId: string | null;
};

const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_ID = /^[0-9a-f]{64}$/;
export const DEEP_LINK_PARAMS = ["community", "channel", "event"] as const;

function relayUrlOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeRelayUrl(value);
  } catch {
    return null;
  }
}

/** `<app base>?community=<relay URL>&channel=<uuid>[&event=<hex id>]`. */
export function buildBuzzDeepLink(input: {
  relayUrl: string;
  channelId: string;
  eventId?: string | null;
  base?: string;
}): string {
  const url = new URL(
    input.base ?? new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
  );
  url.search = "";
  url.hash = "";
  url.searchParams.set("community", input.relayUrl);
  url.searchParams.set("channel", input.channelId);
  if (input.eventId) url.searchParams.set("event", input.eventId);
  return url.toString();
}

/**
 * Parse a deep link from a location search string. Malformed or partial
 * links return null so the app never navigates on untrusted junk.
 */
export function parseBuzzDeepLink(search: string): BuzzDeepLink | null {
  const params = new URLSearchParams(search);
  const relayUrl = relayUrlOrNull(params.get("community"));
  const channelId = params.get("channel")?.toLowerCase() ?? "";
  const rawEvent = params.get("event");
  const eventId = rawEvent ? rawEvent.toLowerCase() : null;
  if (!relayUrl || !CHANNEL_ID.test(channelId)) return null;
  if (eventId !== null && !EVENT_ID.test(eventId)) return null;
  return { relayUrl, channelId, eventId };
}

/** The location search with deep-link parameters removed (other params kept). */
export function stripBuzzDeepLink(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of DEEP_LINK_PARAMS) params.delete(key);
  const next = params.toString();
  return next ? `?${next}` : "";
}

/** Whether two relay URLs name the same community endpoint. */
export function sameRelay(left: string, right: string): boolean {
  const a = relayUrlOrNull(left);
  const b = relayUrlOrNull(right);
  return a !== null && a === b;
}
