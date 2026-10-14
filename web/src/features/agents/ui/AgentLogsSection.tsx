import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { AgentControlClient } from "@/features/agents/lib/agent-control-client";
import { errorMessage, secondaryButtonClass } from "@/features/agents/ui/agent-labels";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";

/** Runtime logs from Agent Control (owner-only; the service redacts keys and auth material). */
export function AgentLogsSection({
  agentPubkey,
  control,
}: {
  agentPubkey: string;
  control: AgentControlClient;
}) {
  const { relayUrl, pubkey } = useWorkspace();
  const logs = useQuery({
    queryKey: ["managed-agent-logs", relayUrl, pubkey.toLowerCase(), agentPubkey],
    queryFn: () => control.logs(agentPubkey, 200),
    refetchInterval: 5_000,
    retry: false,
  });
  return (
    <section aria-label={t("agents.logsTitle")} className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("agents.logsScope")}</p>
        <button
          aria-label={t("agents.logsRefresh")}
          className={secondaryButtonClass}
          disabled={logs.isFetching}
          title={t("agents.logsRefresh")}
          type="button"
          onClick={() => void logs.refetch()}
        >
          <RefreshCw className={`h-4 w-4 ${logs.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      {logs.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("agents.logsLoading")}
        </p>
      ) : logs.error ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          {errorMessage(logs.error, t("agents.logsError"))}
        </p>
      ) : logs.data?.length ? (
        <pre
          className="buzz-scrollbar max-h-96 overflow-auto rounded-md bg-foreground/[0.05] p-3 font-mono text-[11px] leading-5"
          data-testid="agent-runtime-logs"
        >
          {(() => {
            // Content-derived keys stay stable as the tail window shifts; repeats get a counter.
            const seen = new Map<string, number>();
            return logs.data.map((line) => {
              const base = `${line.ts}|${line.stream}|${line.text}`;
              const occurrence = (seen.get(base) ?? 0) + 1;
              seen.set(base, occurrence);
              return { line, key: `${base}|${occurrence}` };
            });
          })().map(({ line, key }) => (
            <span
              key={key}
              className={`block whitespace-pre-wrap break-all ${
                line.stream === "stderr" ? "text-amber-700 dark:text-amber-400" : ""
              }`}
            >
              {line.ts ? `${line.ts} ` : ""}
              {line.text}
            </span>
          ))}
        </pre>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {t("agents.logsEmpty")}
        </p>
      )}
    </section>
  );
}
