import { History, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { RETENTION_CHOICES } from "@/features/agents/lib/observer-archive";
import type { ObservedSession } from "@/features/agents/lib/observer-sessions";
import { fieldClass, secondaryButtonClass } from "@/features/agents/ui/agent-labels";
import { useObserverHistory } from "@/features/agents/use-observer-history";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { getLocale, t } from "@/shared/i18n";

function timeLabel(at: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    at,
  );
}

function SessionBlock({ session, channelName }: { session: ObservedSession; channelName: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="rounded-lg border">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-foreground/[0.03] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">#{channelName}</span>
          <span className="block text-xs text-muted-foreground">
            {t("agents.sessionSummary", {
              turns: session.turns.length,
              when: timeLabel(session.lastAt),
            })}
          </span>
        </span>
      </button>
      {open ? (
        <ol className="space-y-3 border-t px-3 py-3" id={id}>
          {session.turns.map((turn) => (
            <li key={turn.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{timeLabel(turn.startedAt)}</span>
                <span>{turn.ended ? t("agents.turnEnded") : t("agents.turnOpen")}</span>
              </div>
              {turn.steps.length ? (
                <ul className="space-y-1 text-xs">
                  {turn.steps.slice(-20).map((step) => (
                    <li key={step.id} className="flex min-w-0 gap-2">
                      <span className="shrink-0 font-medium">{step.presentation.title}</span>
                      {step.presentation.detail ? (
                        <code className="min-w-0 truncate text-muted-foreground">
                          {step.presentation.detail}
                        </code>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {turn.reply ? (
                <p className="whitespace-pre-wrap break-words rounded-md bg-foreground/[0.04] px-3 py-2 text-sm">
                  {turn.reply}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** Durable history = frames this browser archived while observing live; labelled as such. */
export function AgentHistorySection({ agentPubkey }: { agentPubkey: string }) {
  const { channels } = useWorkspace();
  const history = useObserverHistory(agentPubkey);
  const retentionId = useId();
  const [clearing, setClearing] = useState(false);
  const channelName = (id: string) => channels.find((channel) => channel.id === id)?.name ?? id;

  if (!history.available) {
    return <p className="text-sm text-muted-foreground">{t("agents.historyUnavailable")}</p>;
  }
  return (
    <section aria-label={t("agents.historyTitle")} className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">{t("agents.historyScope")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={retentionId}>
          {t("agents.retentionLabel")}
          <select
            className={`${fieldClass} w-40`}
            id={retentionId}
            value={history.retentionDays}
            onChange={(event) => history.setRetentionDays(Number(event.target.value))}
          >
            {RETENTION_CHOICES.map((days) => (
              <option key={days} value={days}>
                {t("agents.retentionDays", { days })}
              </option>
            ))}
          </select>
        </label>
        <button
          className={secondaryButtonClass}
          disabled={clearing || history.frameCount === 0}
          type="button"
          onClick={() => {
            setClearing(true);
            void history.clear().finally(() => setClearing(false));
          }}
        >
          {clearing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          {t("agents.clearHistory")}
        </button>
      </div>
      {history.error ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {t("agents.historyError")}
        </p>
      ) : null}
      {history.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("agents.historyLoading")}
        </p>
      ) : history.sessions.length ? (
        <ul className="space-y-2" data-testid="agent-history-sessions">
          {history.sessions.map((session) => (
            <SessionBlock
              key={session.key}
              channelName={channelName(session.channelId)}
              session={session}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {t("agents.historyEmpty")}
        </p>
      )}
    </section>
  );
}
