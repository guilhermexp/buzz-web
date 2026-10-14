/** The Relay's HTTP origin for a ws(s) Relay URL, matching the Web client's derivation. */
export function relayHttpOrigin(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

/**
 * Whether NIP-11 advertises the Relay-proxied KLIPY picker. A Relay only does so when its
 * operator configured `BUZZ_KLIPY_API_KEY`; the key itself never leaves the Relay.
 */
export async function relayAdvertisesGif(relayUrl: string): Promise<boolean> {
  const response = await fetch(`${relayHttpOrigin(relayUrl)}/info`, {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error(`Relay NIP-11 request failed (${response.status}).`);
  const info = (await response.json()) as {
    supported_extensions?: unknown;
    gif?: { provider?: unknown };
  };
  return (
    Array.isArray(info.supported_extensions) &&
    info.supported_extensions.includes("buzz-gif") &&
    info.gif?.provider === "klipy"
  );
}

export const MISSING_KLIPY_KEY =
  "operator prerequisite missing: an operator-approved KLIPY test key (BUZZ_KLIPY_API_KEY) " +
  "configured on the Relay under test — see docs/p0-relay-acceptance.md, GIF search";
