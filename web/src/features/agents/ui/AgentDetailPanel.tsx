import { BadgeCheck, MessageSquare, Pencil, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { AgentPersona } from "@/features/agents/lib/catalog-model";
import type { RelayAgent } from "@/features/agents/lib/relay-agents";
import { AgentChannelAccess } from "@/features/agents/ui/AgentChannelAccess";
import { AgentHistorySection } from "@/features/agents/ui/AgentHistorySection";
import { AgentLifecycleControls } from "@/features/agents/ui/AgentLifecycleControls";
import { AgentLogsSection } from "@/features/agents/ui/AgentLogsSection";
import { AgentMemorySection } from "@/features/agents/ui/AgentMemorySection";
import { AgentUsageSection } from "@/features/agents/ui/AgentUsageSection";
import {
  errorMessage,
  presenceLabel,
  respondToLabel,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import { draftConfig, ManagedAgentForm } from "@/features/agents/ui/ManagedAgentForm";
import type { ManagedAgentsApi } from "@/features/agents/use-managed-agents";
import type { RelayAgentsState } from "@/features/agents/use-relay-agents";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { Avatar } from "@/features/chat/ui/Avatar";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { RightPanelResizeHandle, useRightPanelWidth } from "@/shared/ui/right-panel-sizing";

type DetailTab = "overview" | "activity" | "usage" | "memory" | "logs";

export function AgentDetailPanel({
  agent,
  managed,
  relayAgents,
  personas,
  onClose,
  onOpenDm,
}: {
  agent: RelayAgent;
  managed: ManagedAgentsApi;
  relayAgents: RelayAgentsState;
  personas: readonly AgentPersona[];
  onClose: () => void;
  onOpenDm: (pubkey: string) => Promise<void>;
}) {
  const { relayUrl, profiles, channels, pubkey } = useWorkspace();
  const { maximum, minimum, panelWidth, setPanelWidth } = useRightPanelWidth("agent");
  const [tab, setTab] = useState<DetailTab>("overview");
  const [editing, setEditing] = useState(false);
  const me = pubkey.toLowerCase();
  const ownedByMe = agent.managed !== null || agent.ownerPubkey === me;
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "overview", label: t("agents.tabOverview") },
    ...(ownedByMe
      ? ([
          { id: "activity", label: t("agents.tabActivity") },
          { id: "usage", label: t("agents.tabUsage") },
          { id: "memory", label: t("agents.tabMemory") },
        ] as const)
      : []),
    ...(agent.managed && managed.control
      ? [{ id: "logs" as const, label: t("agents.tabLogs") }]
      : []),
  ];
  const profile = {
    ...(profiles[agent.pubkey] ?? {
      pubkey: agent.pubkey,
      name: agent.name,
      about: agent.about,
      picture: null,
    }),
    isAgent: true,
  };
  const ownerName = agent.ownerPubkey
    ? agent.ownerPubkey === me
      ? t("agents.ownerYou")
      : (profiles[agent.ownerPubkey]?.name ?? truncatePubkey(agent.ownerPubkey))
    : null;

  return (
    <aside
      aria-label={t("agents.manage", { name: agent.name })}
      className="absolute inset-y-0 right-0 z-30 flex min-h-0 shrink-0 flex-col border-l bg-background/98 shadow-xl max-sm:!w-full"
      style={{ width: panelWidth }}
    >
      <RightPanelResizeHandle
        label={t("agents.resize")}
        maximum={maximum}
        minimum={minimum}
        panelWidth={panelWidth}
        onResize={setPanelWidth}
      />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{agent.name}</h2>
        <button
          aria-label={t("agents.closeProfile")}
          className="buzz-icon-button h-7 w-7 flex-none"
          title={t("agents.closeProfile")}
          type="button"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {tabs.length > 1 ? (
        <div
          aria-label={t("agents.detailSections")}
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-2"
          role="tablist"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              aria-selected={tab === item.id}
              className={`h-9 shrink-0 border-b-2 px-2.5 text-xs font-medium focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring ${
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
      <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === "overview" ? (
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <Avatar
                profile={profile}
                relayUrl={relayUrl}
                size={56}
                showStatus
                status={agent.status}
              />
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-semibold">{agent.name}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border px-2.5 py-1 font-medium text-muted-foreground">
                    {agent.managed ? t("agents.managedHere") : t("agents.remote")}
                  </span>
                  <span
                    className={
                      agent.status === "online"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }
                  >
                    {t("agents.presenceLabel", { status: presenceLabel(agent.status) })}
                  </span>
                </div>
                {ownerName ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    {t("agents.managedBy", { owner: ownerName })}
                  </p>
                ) : null}
                {agent.about ? (
                  <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
                    {agent.about}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              className={`${secondaryButtonClass} w-full`}
              type="button"
              onClick={() => void onOpenDm(agent.pubkey)}
            >
              <MessageSquare className="h-4 w-4" />
              {t("agents.message")}
            </button>
            {agent.managed ? (
              <AgentLifecycleControls agent={agent.managed} managed={managed} onRemoved={onClose} />
            ) : null}
            <dl className="grid gap-4 border-y py-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("agents.responsePolicy")}
                </dt>
                <dd className="mt-1.5 flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {respondToLabel(agent.respondTo)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("field.publicKey")}
                </dt>
                <dd className="mt-1.5 break-all font-mono text-xs" title={agent.pubkey}>
                  {truncatePubkey(agent.pubkey)}
                </dd>
              </div>
              {agent.managed ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("agents.modelLabel")}
                  </dt>
                  <dd className="mt-1.5 break-words text-sm">
                    {agent.managed.config.model || "—"}
                  </dd>
                </div>
              ) : null}
            </dl>
            {agent.managed ? (
              editing ? (
                <ManagedAgentForm
                  channels={channels}
                  error={
                    managed.update.error
                      ? errorMessage(managed.update.error, t("error.agentUpdate"))
                      : null
                  }
                  initial={{
                    name: agent.managed.name,
                    model: agent.managed.config.model,
                    respondTo: agent.managed.config.respondTo,
                    respondToAllowlist: agent.managed.config.respondToAllowlist,
                    channelAddPolicy: agent.managed.config.channelAddPolicy,
                    systemPrompt: agent.managed.config.systemPrompt ?? "",
                    parallelism: agent.managed.config.parallelism ?? null,
                    channels: agent.managed.config.channels,
                    personaRef: agent.managed.config.personaRef ?? null,
                  }}
                  mode="edit"
                  owner={me}
                  pending={managed.update.isPending}
                  personas={personas}
                  onCancel={() => setEditing(false)}
                  onSubmit={(draft) =>
                    managed.update.mutate(
                      { pubkey: agent.pubkey, config: draftConfig(draft) },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                />
              ) : (
                <button
                  className={secondaryButtonClass}
                  type="button"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("agents.configure")}
                </button>
              )
            ) : null}
            <AgentChannelAccess
              agent={agent}
              channels={channels}
              managed={managed}
              relayAgents={relayAgents}
            />
          </div>
        ) : tab === "activity" ? (
          <AgentHistorySection agentPubkey={agent.pubkey} />
        ) : tab === "usage" ? (
          <AgentUsageSection agentPubkey={agent.pubkey} />
        ) : tab === "memory" ? (
          <AgentMemorySection agentPubkey={agent.pubkey} />
        ) : managed.control ? (
          <AgentLogsSection agentPubkey={agent.pubkey} control={managed.control} />
        ) : null}
      </div>
    </aside>
  );
}
