import { useCallback, useEffect, useMemo, useState } from "react";
import { type RelayAgent, relayAgentsFromEvents } from "@/features/agents/lib/relay-agents";
import type { ManagedAgentsApi } from "@/features/agents/use-managed-agents";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

function mergeEvents(current: NostrEvent[], incoming: NostrEvent[]): NostrEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()];
}

export type RelayAgentsState = {
  agents: RelayAgent[];
  loading: boolean;
  error: string | null;
  pendingAction: string | null;
  refresh: () => Promise<void>;
  /**
   * Add (9000, role bot) or remove (9001) the agent; the relay enforces channel_add_policy.
   * Resolves to whether the relay accepted the change (failures are surfaced in `error`).
   */
  setAgentChannel: (
    agentPubkey: string,
    channelId: string,
    shouldJoin: boolean,
  ) => Promise<boolean>;
};

/** Relay-discovered agents (10100 + kind 0 + bot membership) merged with managed agents. */
export function useRelayAgents(managed: ManagedAgentsApi): RelayAgentsState {
  const { client, demo, config, channels, profiles, presence, ensureProfiles, refreshChannels } =
    useWorkspace();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [demoChannelOverrides, setDemoChannelOverrides] = useState<Record<string, string[]>>({});
  const candidateKey = useMemo(
    () =>
      [
        ...new Set([
          ...config.agents.map((agent) => agent.pubkey),
          ...managed.agents.map((agent) => agent.pubkey),
          ...channels.flatMap((channel) =>
            channel.members
              .filter((member) => member.role === "bot")
              .map((member) => member.pubkey.toLowerCase()),
          ),
        ]),
      ]
        .sort()
        .join(","),
    [channels, config.agents, managed.agents],
  );

  const refresh = useCallback(async () => {
    if (!client || demo) return;
    setLoading(true);
    try {
      const agentProfiles = await client.query({ kinds: [10100], limit: 500 });
      const authors = [
        ...new Set([
          ...agentProfiles.map((event) => event.pubkey.toLowerCase()),
          ...(candidateKey ? candidateKey.split(",") : []),
        ]),
      ];
      const metadata = authors.length
        ? await client.query({ kinds: [0], authors, limit: authors.length * 2 })
        : [];
      setEvents([...agentProfiles, ...metadata]);
      await ensureProfiles(authors);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t("error.agentsLoad"));
    } finally {
      setLoading(false);
    }
  }, [candidateKey, client, demo, ensureProfiles]);

  useEffect(() => {
    if (!client || demo) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const since = Math.floor(Date.now() / 1000) - 3;
    void refresh();
    void client
      .subscribe({ kinds: [10100], since, limit: 0 }, (event) => {
        setEvents((current) => mergeEvents(current, [event]));
        void ensureProfiles([event.pubkey]);
      })
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch((subscribeError) => {
        if (!cancelled) {
          setError(
            subscribeError instanceof Error ? subscribeError.message : t("error.agentsLoad"),
          );
        }
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, demo, ensureProfiles, refresh]);

  const discoveredAgents = useMemo(
    () =>
      relayAgentsFromEvents({
        events,
        configuredAgents: config.agents,
        managedAgents: managed.agents,
        channels,
        profiles,
        presence,
      }),
    [channels, config.agents, events, managed.agents, presence, profiles],
  );
  const agents = useMemo(
    () =>
      discoveredAgents.map((agent) => ({
        ...agent,
        channelIds: demoChannelOverrides[agent.pubkey] ?? agent.channelIds,
      })),
    [demoChannelOverrides, discoveredAgents],
  );

  const setAgentChannel = useCallback(
    async (agentPubkey: string, channelId: string, shouldJoin: boolean): Promise<boolean> => {
      setPendingAction(`${agentPubkey}:${channelId}`);
      setError(null);
      try {
        if (demo) {
          const currentIds = agents.find((agent) => agent.pubkey === agentPubkey)?.channelIds ?? [];
          setDemoChannelOverrides((current) => ({
            ...current,
            [agentPubkey]: shouldJoin
              ? [...new Set([...currentIds, channelId])]
              : currentIds.filter((id) => id !== channelId),
          }));
          return true;
        }
        if (!client) throw new Error(t("error.relayClient"));
        await client.publish({
          kind: shouldJoin ? 9000 : 9001,
          content: "",
          tags: [
            ["h", channelId],
            ["p", agentPubkey.toLowerCase()],
            ...(shouldJoin ? [["role", "bot"]] : []),
          ],
        });
        await refreshChannels();
        return true;
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : t("error.agentUpdate"));
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [agents, client, demo, refreshChannels],
  );

  return { agents, loading, error, pendingAction, refresh, setAgentChannel };
}
