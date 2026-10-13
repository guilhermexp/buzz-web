import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  AgentControlClient,
  type ManagedAgent,
  type ManagedAgentConfig,
} from "@/features/agents/lib/agent-control-client";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import {
  canSignAgentAuthorization,
  getActiveSignerPubkey,
  signAgentAuthorization,
} from "@/shared/lib/nostr-signer";

const POLL_MS = 10_000;

export type LifecycleAction = "start" | "stop" | "restart";

/**
 * Owner-scoped managed agents from Agent Control. Disabled in demo mode and when no service is
 * configured — the UI then hides lifecycle controls instead of simulating them.
 */
export type ManagedAgentsApi = {
  control: AgentControlClient | null;
  /** Agent Control is configured for this (non-demo) workspace. */
  available: boolean;
  /** Creation also needs a signer that can produce a raw NIP-OA attestation. */
  canCreate: boolean;
  agents: ManagedAgent[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  create: UseMutationResult<
    ManagedAgent,
    Error,
    { name: string; config: Partial<ManagedAgentConfig> }
  >;
  authorize: UseMutationResult<ManagedAgent, Error, string>;
  update: UseMutationResult<
    ManagedAgent,
    Error,
    { pubkey: string; config: Partial<ManagedAgentConfig> }
  >;
  lifecycle: UseMutationResult<ManagedAgent, Error, { pubkey: string; action: LifecycleAction }>;
  remove: UseMutationResult<string, Error, string>;
};

export function useManagedAgents(): ManagedAgentsApi {
  const { config, relayUrl, pubkey, demo } = useWorkspace();
  const queryClient = useQueryClient();
  const controlUrl = demo ? null : config.agentControlUrl;
  const control = useMemo(
    () => (controlUrl ? new AgentControlClient(controlUrl, relayUrl) : null),
    [controlUrl, relayUrl],
  );
  const queryKey = useMemo(
    () => ["managed-agents", relayUrl, pubkey.toLowerCase(), controlUrl] as const,
    [controlUrl, pubkey, relayUrl],
  );
  // The operator grant decides whether this identity may run agents at all; without the
  // "agents" capability the lifecycle UI is hidden (the service rejects such calls anyway).
  const grant = useQuery({
    queryKey: [...queryKey, "grant"],
    queryFn: () => (control ? control.capabilities() : Promise.resolve([])),
    enabled: control !== null,
    retry: false,
    staleTime: 60_000,
  });
  const granted = control !== null && (grant.data ?? []).includes("agents");
  const query = useQuery({
    queryKey,
    queryFn: () => (control ? control.list() : Promise.resolve([])),
    enabled: granted,
    refetchInterval: POLL_MS,
    retry: false,
  });

  const replace = (agent: ManagedAgent) =>
    queryClient.setQueryData<ManagedAgent[]>(queryKey, (current = []) =>
      current.some((item) => item.pubkey === agent.pubkey)
        ? current.map((item) => (item.pubkey === agent.pubkey ? agent : item))
        : [...current, agent],
    );

  /** Signs the unconditional NIP-OA tag locally; only the public tag is sent to the service. */
  const authorizeWithOwnerKey = async (agentPubkey: string): Promise<ManagedAgent> => {
    if (!control) throw new Error(t("agents.controlUnavailable"));
    if (getActiveSignerPubkey()?.toLowerCase() !== pubkey.toLowerCase()) {
      throw new Error(t("agents.signerMismatch"));
    }
    return control.authorize(agentPubkey, signAgentAuthorization(agentPubkey));
  };

  const create = useMutation({
    mutationFn: async (input: { name: string; config: Partial<ManagedAgentConfig> }) => {
      if (!control) throw new Error(t("agents.controlUnavailable"));
      const created = await control.create(input.name, input.config);
      return authorizeWithOwnerKey(created.pubkey);
    },
    onSuccess: replace,
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const authorize = useMutation({
    mutationFn: authorizeWithOwnerKey,
    onSuccess: replace,
  });
  const update = useMutation({
    mutationFn: (input: { pubkey: string; config: Partial<ManagedAgentConfig> }) => {
      if (!control) throw new Error(t("agents.controlUnavailable"));
      return control.update(input.pubkey, input.config);
    },
    onSuccess: replace,
  });
  const lifecycle = useMutation({
    mutationFn: (input: { pubkey: string; action: LifecycleAction }) => {
      if (!control) throw new Error(t("agents.controlUnavailable"));
      return control.lifecycle(input.pubkey, input.action);
    },
    onSuccess: replace,
  });
  const remove = useMutation({
    mutationFn: async (agentPubkey: string) => {
      if (!control) throw new Error(t("agents.controlUnavailable"));
      await control.remove(agentPubkey);
      return agentPubkey;
    },
    onSuccess: (agentPubkey) =>
      queryClient.setQueryData<ManagedAgent[]>(queryKey, (current = []) =>
        current.filter((agent) => agent.pubkey !== agentPubkey),
      ),
  });

  return {
    control: granted ? control : null,
    available: granted,
    canCreate: granted && canSignAgentAuthorization(),
    agents: granted ? (query.data ?? []) : [],
    loading: grant.isLoading || query.isLoading,
    error: grant.error ?? query.error,
    refresh: async () => {
      await grant.refetch();
      return query.refetch();
    },
    create,
    authorize,
    update,
    lifecycle,
    remove,
  };
}
