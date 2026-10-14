import { type RefObject, useEffect, useState } from "react";
import { BuzzRelayClient } from "@/shared/api/relay-client";

/**
 * The workspace's single Relay connection, owned by the workspace lifetime.
 * On unmount (community/identity switch, sign-out) pending user state is
 * flushed and the client is disposed, so no socket or late request of this
 * Relay survives into another community's session.
 */
export function useWorkspaceClient(
  relayUrl: string,
  demo: boolean,
  flushBeforeDispose: RefObject<() => Promise<void>>,
): BuzzRelayClient | null {
  const [client, setClient] = useState<BuzzRelayClient | null>(null);

  useEffect(() => {
    if (demo) return;
    const next = new BuzzRelayClient(relayUrl);
    setClient(next);
    return () => {
      setClient(null);
      void flushBeforeDispose
        .current()
        .catch(() => undefined)
        .finally(() => next.dispose());
    };
  }, [demo, flushBeforeDispose, relayUrl]);

  return client;
}
