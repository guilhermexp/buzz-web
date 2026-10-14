import { useCallback, useEffect, useState } from "react";
import { fetchCanvasHead } from "@/features/canvas/lib/canvas-api";
import {
  type CanvasRevision,
  canvasLiveFilter,
  canvasRevisionFromEvent,
  classifyCanvasError,
  supersedesHead,
} from "@/features/canvas/lib/canvas-protocol";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

export type CanvasHeadState = {
  status: "loading" | "ready" | "forbidden" | "error";
  head: CanvasRevision | null;
  /** Relay detail for `error`, or for a live stream that closed after loading. */
  error: string | null;
};

const LOADING: CanvasHeadState = { status: "loading", head: null, error: null };

/**
 * The channel's canvas head, kept current by a live kind-40100 subscription.
 * State lives only in this component instance (keyed by Relay client and
 * channel), so content never outlives the identity that read it.
 */
export function useCanvasHead(client: BuzzRelayClient | null, channelId: string, enabled: boolean) {
  const [state, setState] = useState<CanvasHeadState>(LOADING);
  const [generation, setGeneration] = useState(0);

  const adoptHead = useCallback((revision: CanvasRevision) => {
    setState((current) =>
      supersedesHead(revision, current.head)
        ? { status: "ready", head: revision, error: current.error }
        : current,
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` restarts the subscription on retry
  useEffect(() => {
    setState(LOADING);
    if (!client || !enabled) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const fail = (error: Error) => {
      if (!active) return;
      setState((current) =>
        classifyCanvasError(error) === "forbidden"
          ? { status: "forbidden", head: null, error: null }
          : current.status === "ready"
            ? { ...current, error: error.message }
            : { status: "error", head: null, error: error.message },
      );
    };
    client
      .subscribe(
        canvasLiveFilter(channelId),
        (event) => {
          const revision = canvasRevisionFromEvent(event, channelId);
          if (active && revision) adoptHead(revision);
        },
        {
          onEose: () => {
            if (!active) return;
            setState((current) =>
              current.status === "loading" ? { status: "ready", head: null, error: null } : current,
            );
          },
          onClosed: fail,
        },
      )
      .then(
        (stop) => {
          if (active) unsubscribe = stop;
          else stop();
        },
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [adoptHead, channelId, client, enabled, generation]);

  /** Re-read the head with strong consistency (conflict recovery). */
  const refreshHead = useCallback(async (): Promise<CanvasRevision | null> => {
    if (!client) return null;
    const head = await fetchCanvasHead(client, channelId);
    if (head) adoptHead(head);
    return head;
  }, [adoptHead, channelId, client]);

  /** Resubscribe from scratch after the initial load failed. */
  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  return { ...state, adoptHead, refreshHead, reload };
}
