import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { KIND_WORKFLOW_DEFINITION, listWorkflows } from "@/features/workflows/lib/workflow-events";
import { t } from "@/shared/i18n";

/** Definitions (kind 30620) in every channel the identity belongs to, kept live. */
export function useWorkflowList() {
  const { client, connected, relayUrl, pubkey, channels } = useWorkspace();
  const queryClient = useQueryClient();
  const channelIds = useMemo(
    () =>
      channels
        .filter((channel) => channel.isMember && channel.type !== "dm")
        .map((channel) => channel.id)
        .sort(),
    [channels],
  );
  const queryKey = useMemo(
    () => ["workflows", relayUrl, pubkey, channelIds.join(",")] as const,
    [channelIds, pubkey, relayUrl],
  );
  const query = useQuery({
    queryKey,
    enabled: Boolean(client) && channelIds.length > 0,
    queryFn: () => {
      if (!client) throw new Error(t("error.relayClient"));
      return listWorkflows(client, channelIds);
    },
  });

  useEffect(() => {
    if (!client || !connected || !channelIds.length) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void client
      .subscribe(
        {
          kinds: [KIND_WORKFLOW_DEFINITION],
          "#h": channelIds,
          since: Math.floor(Date.now() / 1_000),
        },
        () => void queryClient.invalidateQueries({ queryKey }),
      )
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => undefined);
    // A reconnect may have missed events; re-read the durable definitions.
    void queryClient.invalidateQueries({ queryKey });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [channelIds, client, connected, queryClient, queryKey]);

  return {
    workflows: query.data ?? [],
    loading: query.isPending && query.fetchStatus !== "idle",
    refreshing: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    channelIds,
  };
}
