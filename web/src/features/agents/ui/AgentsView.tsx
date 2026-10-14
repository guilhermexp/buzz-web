import { LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AgentPersona } from "@/features/agents/lib/catalog-model";
import { AgentCard } from "@/features/agents/ui/AgentCard";
import { AgentDetailPanel } from "@/features/agents/ui/AgentDetailPanel";
import { errorMessage, primaryButtonClass } from "@/features/agents/ui/agent-labels";
import {
  draftConfig,
  draftFromPersona,
  EMPTY_AGENT_DRAFT,
  type ManagedAgentDraft,
  ManagedAgentForm,
} from "@/features/agents/ui/ManagedAgentForm";
import { PersonaCatalog } from "@/features/agents/ui/PersonaCatalog";
import { TeamCatalog } from "@/features/agents/ui/TeamCatalog";
import { useAgentCatalog } from "@/features/agents/use-agent-catalog";
import { useManagedAgents } from "@/features/agents/use-managed-agents";
import { useRelayAgents } from "@/features/agents/use-relay-agents";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

type ViewTab = "agents" | "personas" | "teams";

export function AgentsView({
  onClose,
  onOpenDm,
}: {
  onClose: () => void;
  onOpenDm: (pubkey: string) => Promise<void>;
}) {
  const { relayUrl, profiles, channels, pubkey, demo, ensureProfiles } = useWorkspace();
  const managed = useManagedAgents();
  const relayAgents = useRelayAgents(managed);
  const catalog = useAgentCatalog();
  const me = pubkey.toLowerCase();
  const [tab, setTab] = useState<ViewTab>("agents");
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [creating, setCreating] = useState<ManagedAgentDraft | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const selected = relayAgents.agents.find((agent) => agent.pubkey === selectedPubkey) ?? null;
  const ownerKey = useMemo(
    () =>
      [
        ...new Set(
          relayAgents.agents.flatMap((agent) => (agent.ownerPubkey ? [agent.ownerPubkey] : [])),
        ),
      ]
        .sort()
        .join(","),
    [relayAgents.agents],
  );

  useEffect(() => {
    if (ownerKey) void ensureProfiles(ownerKey.split(","));
  }, [ensureProfiles, ownerKey]);

  const ownerLabel = (owner: string | null) =>
    owner === null
      ? null
      : owner === me
        ? t("agents.ownerYou")
        : (profiles[owner]?.name ?? truncatePubkey(owner));

  const startCreate = (persona?: AgentPersona) => {
    setCreateError(null);
    setCreating(persona ? draftFromPersona(EMPTY_AGENT_DRAFT, persona, me) : EMPTY_AGENT_DRAFT);
    setTab("agents");
  };

  const submitCreate = async (draft: ManagedAgentDraft) => {
    setCreateError(null);
    try {
      const agent = await managed.create.mutateAsync({
        name: draft.name,
        config: draftConfig(draft),
      });
      const failed: string[] = [];
      for (const channelId of draft.channels) {
        if (!(await relayAgents.setAgentChannel(agent.pubkey, channelId, true)))
          failed.push(channelId);
      }
      setCreating(null);
      setSelectedPubkey(agent.pubkey);
      if (failed.length) toast.error(t("agents.createChannelsFailed", { count: failed.length }));
      else toast.success(t("agents.created", { name: agent.name }));
    } catch (error) {
      setCreateError(errorMessage(error, t("agents.createFailed")));
      void managed.refresh();
    }
  };

  const loading = relayAgents.loading || managed.loading;
  const tabs: Array<{ id: ViewTab; label: string }> = [
    { id: "agents", label: t("agents.tabAgents") },
    ...(catalog.enabled
      ? [
          { id: "personas" as const, label: t("agents.tabPersonas") },
          { id: "teams" as const, label: t("agents.tabTeams") },
        ]
      : []),
  ];

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="buzz-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <header className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 pr-10 sm:pr-0">
              <h2 className="text-[22px] font-semibold leading-tight">{t("agents.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("agents.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {managed.canCreate ? (
                <button className={primaryButtonClass} type="button" onClick={() => startCreate()}>
                  <Plus className="h-4 w-4" />
                  {t("agents.newAgent")}
                </button>
              ) : null}
              <button
                aria-label={t("common.refresh")}
                className="buzz-icon-button"
                disabled={loading}
                title={t("common.refresh")}
                type="button"
                onClick={() => {
                  void relayAgents.refresh();
                  void managed.refresh();
                  void catalog.refresh();
                }}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                aria-label={t("agents.close")}
                className="buzz-icon-button absolute right-0 top-0 sm:static"
                title={t("agents.close")}
                type="button"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {managed.available && !managed.canCreate ? (
            <p className="mt-4 rounded-md bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground">
              {t("agents.authRequiresLocalSigner")}
            </p>
          ) : null}
          {managed.error ? (
            <p
              className="mt-4 rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {t("agents.controlListFailed", {
                detail: errorMessage(managed.error, t("agents.controlUnreachable")),
              })}
            </p>
          ) : null}
          {relayAgents.error && !selected ? (
            <p
              className="mt-4 rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {relayAgents.error}
            </p>
          ) : null}

          {tabs.length > 1 ? (
            <div
              aria-label={t("agents.viewSections")}
              className="mt-6 flex gap-1 border-b"
              role="tablist"
            >
              {tabs.map((item) => (
                <button
                  key={item.id}
                  aria-selected={tab === item.id}
                  className={`h-9 border-b-2 px-3 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring ${
                    tab === item.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  role="tab"
                  type="button"
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-6 pb-8" role={tabs.length > 1 ? "tabpanel" : undefined}>
            {tab === "agents" ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {relayAgents.agents.map((agent) => (
                    <AgentCard
                      key={agent.pubkey}
                      agent={agent}
                      ownerLabel={ownerLabel(agent.ownerPubkey)}
                      profile={{
                        ...(profiles[agent.pubkey] ?? {
                          pubkey: agent.pubkey,
                          name: agent.name,
                          about: agent.about,
                          picture: null,
                        }),
                        isAgent: true,
                      }}
                      relayUrl={relayUrl}
                      onSelect={() => setSelectedPubkey(agent.pubkey)}
                    />
                  ))}
                </div>
                {loading && !relayAgents.agents.length ? (
                  <div className="flex items-center justify-center px-3 py-16 text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    {t("agents.loading")}
                  </div>
                ) : null}
                {!loading && !relayAgents.agents.length ? (
                  <div className="px-3 py-16 text-center text-sm text-muted-foreground">
                    {managed.canCreate ? t("agents.emptyCanCreate") : t("agents.empty")}
                  </div>
                ) : null}
              </>
            ) : tab === "personas" ? (
              <PersonaCatalog
                canCreateAgent={managed.canCreate}
                catalog={catalog}
                onCreateAgent={startCreate}
              />
            ) : (
              <TeamCatalog catalog={catalog} />
            )}
          </div>
        </div>
      </div>
      {selected ? (
        <AgentDetailPanel
          agent={selected}
          managed={managed}
          personas={catalog.catalog.personas}
          relayAgents={relayAgents}
          onClose={() => setSelectedPubkey(null)}
          onOpenDm={onOpenDm}
        />
      ) : null}
      {creating ? (
        <DialogFrame
          title={t("agents.newAgent")}
          width="max-w-xl"
          onClose={() => setCreating(null)}
        >
          <div className="buzz-scrollbar max-h-[calc(85dvh-3.25rem)] overflow-y-auto p-4">
            <p className="mb-4 text-xs leading-5 text-muted-foreground">{t("agents.createHint")}</p>
            <ManagedAgentForm
              channels={demo ? [] : channels}
              error={createError}
              initial={creating}
              mode="create"
              owner={me}
              pending={managed.create.isPending}
              personas={catalog.catalog.personas}
              onCancel={() => setCreating(null)}
              onSubmit={(draft) => void submitCreate(draft)}
            />
          </div>
        </DialogFrame>
      ) : null}
    </div>
  );
}
