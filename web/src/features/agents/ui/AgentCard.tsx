import { BadgeCheck, MoreVertical } from "lucide-react";
import type { RelayAgent } from "@/features/agents/lib/relay-agents";
import {
  presenceLabel,
  processStatusLabel,
  respondToLabel,
} from "@/features/agents/ui/agent-labels";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { Avatar } from "@/features/chat/ui/Avatar";
import { t } from "@/shared/i18n";

export function AgentCard({
  agent,
  profile,
  relayUrl,
  ownerLabel,
  onSelect,
}: {
  agent: RelayAgent;
  profile: UserProfile;
  relayUrl: string;
  /** Display name of the NIP-OA-verified owner ("managed by"), never shown as the author. */
  ownerLabel: string | null;
  onSelect: () => void;
}) {
  const manageLabel = t("agents.manage", { name: agent.name });
  return (
    <article className="relative flex min-h-[260px] flex-col rounded-lg border bg-background/25 p-4">
      <button
        aria-label={manageLabel}
        className="buzz-icon-button absolute right-3 top-3"
        title={manageLabel}
        type="button"
        onClick={onSelect}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      <button
        aria-label={manageLabel}
        className="mx-auto mt-8 flex h-28 w-28 items-center justify-center rounded-full bg-foreground/[0.035] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onSelect}
      >
        <Avatar profile={profile} relayUrl={relayUrl} size={104} showStatus status={agent.status} />
      </button>
      <div className="mt-auto pt-6">
        <div className="truncate text-sm font-semibold">{agent.name}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span
            className={agent.status === "online" ? "text-emerald-700 dark:text-emerald-400" : ""}
          >
            {presenceLabel(agent.status)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{respondToLabel(agent.respondTo)}</span>
        </div>
        {agent.managed ? (
          <div className="mt-1 text-xs text-muted-foreground" data-testid="agent-card-process">
            {t("agents.processLabel", { status: processStatusLabel(agent.managed.status) })}
          </div>
        ) : null}
        {ownerLabel ? (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
            {t("agents.managedBy", { owner: ownerLabel })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
