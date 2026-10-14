import { LoaderCircle, Plus, X } from "lucide-react";
import type { RelayAgent } from "@/features/agents/lib/relay-agents";
import { addPolicyLabel } from "@/features/agents/ui/agent-labels";
import type { ManagedAgentsApi } from "@/features/agents/use-managed-agents";
import type { RelayAgentsState } from "@/features/agents/use-relay-agents";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { t } from "@/shared/i18n";

/**
 * Channel membership through relay 9000/9001 (the relay enforces the agent's 10100
 * channel_add_policy). For managed agents the runtime subscription scope follows membership, so a
 * removal also stops the process from acting on that channel.
 */
export function AgentChannelAccess({
  agent,
  channels,
  relayAgents,
  managed,
}: {
  agent: RelayAgent;
  channels: readonly BuzzChannel[];
  relayAgents: RelayAgentsState;
  managed: ManagedAgentsApi;
}) {
  const assignable = channels.filter((channel) => channel.type !== "dm");
  const joinedCount = assignable.filter((channel) => agent.channelIds.includes(channel.id)).length;

  const toggle = async (channelId: string, join: boolean) => {
    if (!(await relayAgents.setAgentChannel(agent.pubkey, channelId, join))) return;
    const runtime = agent.managed;
    if (!runtime) return;
    const next = join
      ? [...new Set([...runtime.config.channels, channelId])]
      : runtime.config.channels.filter((id) => id !== channelId);
    if (next.length !== runtime.config.channels.length) {
      managed.update.mutate({ pubkey: agent.pubkey, config: { channels: next } });
    }
  };

  return (
    <section aria-labelledby={`channels-${agent.pubkey}`} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold" id={`channels-${agent.pubkey}`}>
          {t("agents.channels")}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t(joinedCount === 1 ? "agents.channelCountOne" : "agents.channelCount", {
            count: joinedCount,
          })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("agents.addPolicyCurrent", { policy: addPolicyLabel(agent.channelAddPolicy) })}
      </p>
      <div className="divide-y rounded-lg border">
        {assignable.map((channel) => {
          const joined = agent.channelIds.includes(channel.id);
          const label = joined
            ? t("agents.removeFrom", { channel: channel.name })
            : t("agents.addTo", { channel: channel.name });
          return (
            <div key={channel.id} className="flex min-h-12 items-center gap-2 px-3 py-2">
              <span aria-hidden="true" className="text-muted-foreground">
                #
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{channel.name}</div>
                {channel.description ? (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {channel.description}
                  </div>
                ) : null}
              </div>
              <button
                aria-label={label}
                aria-pressed={joined}
                className="buzz-icon-button h-7 w-7 flex-none"
                disabled={relayAgents.pendingAction !== null}
                title={label}
                type="button"
                onClick={() => void toggle(channel.id, !joined)}
              >
                {relayAgents.pendingAction === `${agent.pubkey}:${channel.id}` ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : joined ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </button>
            </div>
          );
        })}
        {!assignable.length ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("agents.noChannels")}
          </p>
        ) : null}
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">{t("agents.removalNote")}</p>
      {relayAgents.error ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {relayAgents.error}
        </p>
      ) : null}
    </section>
  );
}
