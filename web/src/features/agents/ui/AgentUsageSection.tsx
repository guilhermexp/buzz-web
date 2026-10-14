import { LoaderCircle } from "lucide-react";
import { useMemo } from "react";
import { summarizeUsage } from "@/features/agents/lib/agent-metrics";
import { errorMessage } from "@/features/agents/ui/agent-labels";
import { useAgentMetrics } from "@/features/agents/use-agent-insights";
import { getLocale, t } from "@/shared/i18n";

const SERIES_DAYS = 14;

/** Owner-private NIP-AM usage for one agent: totals and a 14-day daily series. */
export function AgentUsageSection({ agentPubkey }: { agentPubkey: string }) {
  const metrics = useAgentMetrics();
  const summary = useMemo(
    () =>
      summarizeUsage(
        (metrics.data ?? []).filter((metric) => metric.agentPubkey === agentPubkey),
        SERIES_DAYS,
      ),
    [agentPubkey, metrics.data],
  );
  const numbers = new Intl.NumberFormat(getLocale());
  const money = new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  const dayFormat = new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" });
  const peak = Math.max(1, ...summary.daily.map((day) => day.totalTokens));

  if (metrics.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t("agents.usageLoading")}
      </p>
    );
  }
  if (metrics.error) {
    return (
      <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
        {errorMessage(metrics.error, t("agents.usageError"))}
      </p>
    );
  }
  if (!metrics.isFetched) {
    return <p className="text-sm text-muted-foreground">{t("agents.privateNeedsSigner")}</p>;
  }
  const { totals } = summary;
  return (
    <section aria-label={t("agents.usageTitle")} className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">{t("agents.usageScope")}</p>
      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4"
        data-testid="agent-usage-totals"
      >
        <div>
          <dt className="text-xs text-muted-foreground">{t("agents.usageTurns")}</dt>
          <dd className="mt-1 font-medium tabular-nums">{numbers.format(totals.turns)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("agents.usageInput")}</dt>
          <dd className="mt-1 font-medium tabular-nums">{numbers.format(totals.inputTokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("agents.usageOutput")}</dt>
          <dd className="mt-1 font-medium tabular-nums">{numbers.format(totals.outputTokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("agents.usageCost")}</dt>
          <dd className="mt-1 font-medium tabular-nums">{money.format(totals.costUsd)}</dd>
        </div>
      </dl>
      {totals.unknownCostTurns ? (
        <p className="text-xs text-muted-foreground">
          {t("agents.usageUnknownCost", { count: totals.unknownCostTurns })}
        </p>
      ) : null}
      {totals.turns ? (
        <figure>
          <figcaption className="mb-2 text-xs font-medium text-muted-foreground">
            {t("agents.usageDaily", { days: SERIES_DAYS })}
          </figcaption>
          <ol className="flex h-24 items-end gap-1">
            {summary.daily.map((day) => {
              const label = t("agents.usageDayLabel", {
                day: dayFormat.format(new Date(`${day.day}T12:00:00`)),
                tokens: numbers.format(day.totalTokens),
                turns: day.turns,
              });
              return (
                <li
                  key={day.day}
                  aria-label={label}
                  className="flex h-full flex-1 items-end"
                  title={label}
                >
                  <span
                    className="block w-full rounded-t-sm bg-foreground/70"
                    style={{
                      height: `${Math.max(day.turns ? 4 : 1, (day.totalTokens / peak) * 100)}%`,
                    }}
                  />
                </li>
              );
            })}
          </ol>
        </figure>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {t("agents.usageEmpty")}
        </p>
      )}
    </section>
  );
}
