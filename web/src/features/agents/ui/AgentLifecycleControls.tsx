import { KeyRound, LoaderCircle, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ManagedAgent } from "@/features/agents/lib/agent-control-client";
import {
  dangerButtonClass,
  errorMessage,
  primaryButtonClass,
  processStatusLabel,
  secondaryButtonClass,
} from "@/features/agents/ui/agent-labels";
import type { LifecycleAction, ManagedAgentsApi } from "@/features/agents/use-managed-agents";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";

/** Real lifecycle controls; every state shown comes back from Agent Control after the operation. */
export function AgentLifecycleControls({
  agent,
  managed,
  onRemoved,
}: {
  agent: ManagedAgent;
  managed: ManagedAgentsApi;
  onRemoved: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pendingAction =
    managed.lifecycle.isPending && managed.lifecycle.variables?.pubkey === agent.pubkey
      ? managed.lifecycle.variables.action
      : null;
  const busy =
    managed.lifecycle.isPending || managed.remove.isPending || managed.authorize.isPending;
  const run = (action: LifecycleAction) =>
    managed.lifecycle.mutate({ pubkey: agent.pubkey, action });
  const failure =
    (managed.lifecycle.variables?.pubkey === agent.pubkey ? managed.lifecycle.error : null) ??
    (managed.remove.variables === agent.pubkey ? managed.remove.error : null) ??
    (managed.authorize.variables === agent.pubkey ? managed.authorize.error : null);
  const running = agent.status === "running" || agent.status === "starting";
  const icon = (action: LifecycleAction, Icon: typeof Play) =>
    pendingAction === action ? (
      <LoaderCircle className="h-4 w-4 animate-spin" />
    ) : (
      <Icon className="h-4 w-4" />
    );

  return (
    <section aria-label={t("agents.lifecycle")} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${
            agent.status === "running"
              ? "text-emerald-700 dark:text-emerald-400"
              : agent.status === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
          data-testid="managed-agent-status"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              agent.status === "running"
                ? "bg-emerald-500"
                : agent.status === "error"
                  ? "bg-destructive"
                  : agent.status === "starting"
                    ? "bg-amber-500"
                    : "bg-neutral-400"
            }`}
          />
          {t("agents.processLabel", { status: processStatusLabel(agent.status) })}
        </span>
        {agent.lastExit ? (
          <span className="text-muted-foreground">
            {t("agents.lastExit", {
              code: agent.lastExit.code ?? "—",
              when: relativeTime(agent.lastExit.at),
            })}
          </span>
        ) : null}
      </div>
      {!agent.authorized ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">{t("agents.notAuthorized")}</span>
          <button
            className={primaryButtonClass}
            disabled={busy}
            type="button"
            onClick={() => managed.authorize.mutate(agent.pubkey)}
          >
            {managed.authorize.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("agents.authorize")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {running ? (
          <button
            className={secondaryButtonClass}
            disabled={busy}
            type="button"
            onClick={() => run("stop")}
          >
            {icon("stop", Square)}
            {t("agents.stopAgent")}
          </button>
        ) : (
          <button
            className={primaryButtonClass}
            disabled={busy || !agent.authorized}
            type="button"
            onClick={() => run("start")}
          >
            {icon("start", Play)}
            {t("agents.startAgent")}
          </button>
        )}
        <button
          className={secondaryButtonClass}
          disabled={busy || !agent.authorized}
          type="button"
          onClick={() => run("restart")}
        >
          {icon("restart", RotateCw)}
          {t("agents.restartAgent")}
        </button>
        {confirmRemove ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("agents.removeConfirm")}</span>
            <button
              className={dangerButtonClass}
              disabled={busy}
              type="button"
              onClick={() =>
                managed.remove.mutate(agent.pubkey, {
                  onSuccess: onRemoved,
                  onSettled: () => setConfirmRemove(false),
                })
              }
            >
              {managed.remove.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {t("agents.removeAgentConfirm")}
            </button>
            <button
              className={secondaryButtonClass}
              disabled={busy}
              type="button"
              onClick={() => setConfirmRemove(false)}
            >
              {t("common.cancel")}
            </button>
          </span>
        ) : (
          <button
            className={dangerButtonClass}
            disabled={busy}
            type="button"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("agents.removeAgent")}
          </button>
        )}
      </div>
      {failure ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {errorMessage(failure, t("error.agentUpdate"))}
        </p>
      ) : null}
    </section>
  );
}
