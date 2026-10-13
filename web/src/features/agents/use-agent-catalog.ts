import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AgentPersona, AgentTeam } from "@/features/agents/lib/catalog-model";
import {
  type CatalogSnapshot,
  deletePersona,
  deleteTeam,
  loadCatalog,
  publishPersona,
  publishTeam,
} from "@/features/agents/lib/catalog-publish";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";

const EMPTY: CatalogSnapshot = { personas: [], teams: [], sharedPersonas: [], sharedTeams: [] };

export type AgentCatalogApi = {
  enabled: boolean;
  catalog: CatalogSnapshot;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  savePersona: UseMutationResult<AgentPersona, Error, AgentPersona>;
  removePersona: UseMutationResult<void, Error, AgentPersona>;
  saveTeam: UseMutationResult<AgentTeam, Error, { team: AgentTeam; wasShared: boolean }>;
  removeTeam: UseMutationResult<void, Error, AgentTeam>;
};

/** Personas (30175) and teams (30176/30178) owned by this identity plus the shared catalog. */
export function useAgentCatalog(): AgentCatalogApi {
  const { client, relayUrl, pubkey, demo, connected } = useWorkspace();
  const queryClient = useQueryClient();
  const owner = pubkey.toLowerCase();
  const queryKey = ["agent-catalog", relayUrl, owner] as const;
  const query = useQuery({
    queryKey,
    enabled: client !== null && !demo && connected,
    queryFn: () => (client ? loadCatalog(client, owner) : Promise.resolve(EMPTY)),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const requireClient = () => {
    if (!client) throw new Error(t("error.relayClient"));
    return client;
  };

  const savePersona = useMutation({
    mutationFn: (persona: AgentPersona) => publishPersona(requireClient(), persona),
    onSettled: invalidate,
  });
  const removePersona = useMutation({
    mutationFn: (persona: AgentPersona) => deletePersona(requireClient(), owner, persona),
    onSettled: invalidate,
  });
  const saveTeam = useMutation({
    mutationFn: (input: { team: AgentTeam; wasShared: boolean }) =>
      publishTeam(requireClient(), input.team, query.data?.personas ?? [], owner, input.wasShared),
    onSettled: invalidate,
  });
  const removeTeam = useMutation({
    mutationFn: (team: AgentTeam) => deleteTeam(requireClient(), owner, team),
    onSettled: invalidate,
  });

  return {
    enabled: client !== null && !demo,
    catalog: query.data ?? EMPTY,
    loading: query.isLoading,
    error: query.error,
    refresh: () => query.refetch(),
    savePersona,
    removePersona,
    saveTeam,
    removeTeam,
  };
}
