import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import {
  AGENT_MEMORY_KIND,
  type AgentMemoryResult,
  readAgentMemory,
} from "@/features/agents/lib/agent-memory";
import {
  AGENT_TURN_METRIC_KIND,
  readTurnMetrics,
  type TurnMetric,
} from "@/features/agents/lib/agent-metrics";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  canDecryptNip44FromPeer,
  decryptNip44FromPeer,
  getActiveSignerPubkey,
  nip44ConversationHmacFromPeer,
} from "@/shared/lib/nostr-signer";

const METRIC_WINDOW_DAYS = 30;
const METRIC_LIMIT = 5_000;
const MEMORY_LIMIT = 5_000;

function useOwnerSigner(): { owner: string; ready: boolean } {
  const { pubkey, client, demo } = useWorkspace();
  const owner = pubkey.toLowerCase();
  const ready =
    !demo &&
    client !== null &&
    canDecryptNip44FromPeer() &&
    getActiveSignerPubkey()?.toLowerCase() === owner;
  return { owner, ready };
}

/**
 * Owner-private NIP-AM turn metrics for the last 30 days. The relay only returns 44200 to the
 * `#p` owner, and each payload is NIP-44 encrypted agent→owner; anything else is dropped.
 */
export function useAgentMetrics(): UseQueryResult<TurnMetric[]> {
  const { client, relayUrl } = useWorkspace();
  const { owner, ready } = useOwnerSigner();
  return useQuery({
    queryKey: ["agent-metrics", relayUrl, owner],
    enabled: ready,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client) return [];
      const events = await client.query({
        kinds: [AGENT_TURN_METRIC_KIND],
        "#p": [owner],
        since: Math.floor(Date.now() / 1000) - METRIC_WINDOW_DAYS * 86_400,
        limit: METRIC_LIMIT,
      });
      return readTurnMetrics(events, owner, decryptNip44FromPeer);
    },
  });
}

/** NIP-AE memory for one agent, read as its owner. Owners cannot write engrams (agent-signed). */
export function useAgentMemory(agentPubkey: string | null): UseQueryResult<AgentMemoryResult> {
  const { client, relayUrl } = useWorkspace();
  const { owner, ready } = useOwnerSigner();
  return useQuery({
    queryKey: ["agent-memory", relayUrl, owner, agentPubkey],
    enabled: ready && agentPubkey !== null,
    queryFn: async () => {
      const agent = agentPubkey?.toLowerCase() ?? "";
      if (!client || !agent) {
        return { core: null, memories: [], truncated: false, dTagsVerified: false };
      }
      const events = await client.query({
        kinds: [AGENT_MEMORY_KIND],
        "#p": [owner],
        authors: [agent],
        limit: MEMORY_LIMIT,
      });
      return readAgentMemory(
        events,
        agent,
        owner,
        decryptNip44FromPeer,
        (message) => nip44ConversationHmacFromPeer(agent, message),
        MEMORY_LIMIT,
      );
    },
  });
}
