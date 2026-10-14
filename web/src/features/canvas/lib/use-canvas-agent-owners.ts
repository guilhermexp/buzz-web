import { useEffect, useState } from "react";
import { verifiedAgentOwner } from "@/features/agents/lib/nip-oa";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

/**
 * Verified NIP-OA owners of `agentPubkeys`, read from their latest kind-0
 * events. Pubkeys without a verifiable `auth` tag map to null.
 */
export function useCanvasAgentOwners(
  client: BuzzRelayClient | null,
  agentPubkeys: readonly string[],
): Record<string, string | null> {
  const key = [...new Set(agentPubkeys)].sort().join(",");
  const [owners, setOwners] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setOwners({});
    if (!client || !key) return;
    const authors = key.split(",");
    let active = true;
    client.query({ kinds: [0], authors, limit: authors.length * 4 }).then(
      (events) => {
        const latest = new Map<string, (typeof events)[number]>();
        for (const event of events) {
          const author = event.pubkey.toLowerCase();
          const current = latest.get(author);
          if (!current || event.created_at > current.created_at) latest.set(author, event);
        }
        const next: Record<string, string | null> = {};
        for (const author of authors) {
          const event = latest.get(author);
          next[author] = event ? (verifiedAgentOwner(event)?.toLowerCase() ?? null) : null;
        }
        if (active) setOwners(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [client, key]);

  return owners;
}
