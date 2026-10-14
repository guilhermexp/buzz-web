import { Bot, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type RelayAgent, relayAgentsFromEvents } from "@/features/agents/lib/relay-agents";
import { fallbackProfile } from "@/features/chat/lib/chat-model";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { Avatar } from "@/features/chat/ui/Avatar";
import { t } from "@/shared/i18n";

const AGENT_PROFILE_KIND = 10100;

/**
 * Adds a Relay-discovered agent (kind 10100) to a channel with the NIP-29
 * put-user command (kind 9000, role `bot`), exactly as Buzz Desktop does.
 * Success is only shown after the Relay accepts the command and the roster
 * reloads; rejections stay visible.
 */
export function AddChannelAgentDialog({
  channel,
  onClose,
}: {
  channel: BuzzChannel;
  onClose: () => void;
}) {
  const { client, demo, config, channels, profiles, presence, ensureProfiles, refreshChannels } =
    useWorkspace();
  const [agents, setAgents] = useState<RelayAgent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const memberPubkeys = new Set(channel.members.map((member) => member.pubkey.toLowerCase()));

  // Names/presence refine the list but must not re-run discovery on every update.
  const latest = useRef({ config, channels, profiles, presence, ensureProfiles });
  latest.current = { config, channels, profiles, presence, ensureProfiles };

  const load = useCallback(async () => {
    const { config, channels, profiles, presence, ensureProfiles } = latest.current;
    setLoadError(null);
    setAgents(null);
    try {
      const events =
        client && !demo ? await client.query({ kinds: [AGENT_PROFILE_KIND], limit: 200 }) : [];
      await ensureProfiles(events.map((event) => event.pubkey));
      setAgents(
        relayAgentsFromEvents({
          events,
          configuredAgents: config.agents,
          channels,
          profiles,
          presence,
        }),
      );
    } catch (queryError) {
      setLoadError(
        queryError instanceof Error ? queryError.message : t("workspace.addAgent.loadError"),
      );
      setAgents([]);
    }
  }, [client, demo]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (agentPubkey: string) => {
    if (!client) {
      setError(t("error.relayClient"));
      return;
    }
    setPending(agentPubkey);
    setError(null);
    try {
      await client.publish({
        kind: 9000,
        content: "",
        tags: [
          ["h", channel.id],
          ["p", agentPubkey],
          ["role", "bot"],
        ],
      });
      await refreshChannels();
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : t("workspace.addAgent.failed"),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <DialogFrame title={t("workspace.addAgent.title", { channel: channel.name })} onClose={onClose}>
      <div className="flex max-h-[70dvh] min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-xs text-muted-foreground">{t("workspace.addAgent.description")}</p>
          <button
            aria-label={t("workspace.addAgent.refresh")}
            className="buzz-icon-button h-8 w-8 flex-none"
            disabled={agents === null}
            title={t("workspace.addAgent.refresh")}
            type="button"
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {error ? (
          <p className="border-b bg-destructive/8 px-4 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {agents === null ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {t("workspace.addAgent.loading")}
            </div>
          ) : loadError ? (
            <p className="px-2 py-6 text-center text-sm text-destructive" role="alert">
              {loadError}
            </p>
          ) : agents.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("workspace.addAgent.empty")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {agents.map((agent) => {
                const added = memberPubkeys.has(agent.pubkey);
                const profile =
                  profiles[agent.pubkey] ?? fallbackProfile(agent.pubkey, agent.name, true);
                return (
                  <li
                    key={agent.pubkey}
                    className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/5"
                  >
                    <Avatar
                      profile={{ ...profile, name: agent.name, isAgent: true }}
                      relayUrl={config.relayUrl}
                      size={32}
                      showStatus
                      status={agent.status}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{agent.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {agent.about || agent.agentType}
                      </div>
                    </div>
                    {added ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5" />
                        {t("workspace.addAgent.inChannel")}
                      </span>
                    ) : (
                      <button
                        aria-label={t("workspace.addAgent.addNamed", { name: agent.name })}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-40"
                        disabled={pending !== null}
                        type="button"
                        onClick={() => void add(agent.pubkey)}
                      >
                        {pending === agent.pubkey ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Bot className="h-3.5 w-3.5" />
                        )}
                        {pending === agent.pubkey
                          ? t("workspace.addAgent.adding")
                          : t("workspace.addAgent.add")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </DialogFrame>
  );
}
