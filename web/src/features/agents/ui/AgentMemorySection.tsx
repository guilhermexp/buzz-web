import { LoaderCircle, RefreshCw } from "lucide-react";
import { errorMessage, secondaryButtonClass } from "@/features/agents/ui/agent-labels";
import { useAgentMemory } from "@/features/agents/use-agent-insights";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";

/**
 * NIP-AE engrams read as the owner: core profile, live memories (tombstones dropped) and which
 * ones are reachable from core. Engrams are agent-signed, so the owner view is read-only.
 */
export function AgentMemorySection({ agentPubkey }: { agentPubkey: string }) {
  const memory = useAgentMemory(agentPubkey);

  if (memory.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t("agents.memoryLoading")}
      </p>
    );
  }
  if (memory.error) {
    return (
      <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
        {errorMessage(memory.error, t("agents.memoryError"))}
      </p>
    );
  }
  if (!memory.data) {
    return <p className="text-sm text-muted-foreground">{t("agents.privateNeedsSigner")}</p>;
  }
  const { core, memories, truncated, dTagsVerified } = memory.data;
  return (
    <section aria-label={t("agents.memoryTitle")} className="space-y-4">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
          {t("agents.memoryScope")}
        </p>
        <button
          aria-label={t("agents.memoryRefresh")}
          className={secondaryButtonClass}
          disabled={memory.isFetching}
          title={t("agents.memoryRefresh")}
          type="button"
          onClick={() => void memory.refetch()}
        >
          <RefreshCw className={`h-4 w-4 ${memory.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      {!dTagsVerified ? (
        <p className="text-xs text-muted-foreground">{t("agents.memoryUnverifiedAddresses")}</p>
      ) : null}
      {truncated ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("agents.memoryTruncated")}</p>
      ) : null}
      <div>
        <h4 className="text-xs font-semibold">{t("agents.memoryCore")}</h4>
        {core ? (
          <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-foreground/[0.04] px-3 py-2 text-sm">
            {core.profile}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">{t("agents.memoryNoCore")}</p>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold">
          {t("agents.memoryEntries", { count: memories.length })}
        </h4>
        {memories.length ? (
          <ul className="mt-1.5 divide-y rounded-lg border" data-testid="agent-memory-entries">
            {memories.map((entry) => (
              <li key={entry.slug} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <code className="font-medium">{entry.slug}</code>
                  {!entry.reachable ? (
                    <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t("agents.memoryOrphan")}
                    </span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground">
                    {relativeTime(entry.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{entry.value}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">{t("agents.memoryEmpty")}</p>
        )}
      </div>
    </section>
  );
}
