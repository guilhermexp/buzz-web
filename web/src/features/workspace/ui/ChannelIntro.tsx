import { Bot, Hash, Lock, UsersRound } from "lucide-react";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { t } from "@/shared/i18n";

/** Shown at the start of an empty channel, mirroring desktop's channel intro. */
export function ChannelIntro({
  channel,
  canManage,
  onAddPeople,
  onAddAgent,
}: {
  channel: BuzzChannel;
  canManage: boolean;
  onAddPeople: () => void;
  onAddAgent: () => void;
}) {
  const Icon = channel.visibility === "private" ? Lock : Hash;
  const actionClass =
    "flex w-56 min-w-0 flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <section
      aria-labelledby={`channel-intro-${channel.id}`}
      className="buzz-scrollbar flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-6 pt-10 sm:px-6"
      data-testid="message-channel-intro"
    >
      <div className="flex h-15 w-15 items-center justify-center rounded-2xl border border-border/70 bg-muted/40">
        <Icon aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
      </div>
      {/* Not a heading: the channel header's h1 already names the conversation. */}
      <p
        className="mt-4 break-words text-xl font-semibold leading-7 tracking-tight"
        id={`channel-intro-${channel.id}`}
      >
        #{channel.name}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {channel.visibility === "private"
          ? t("workspace.intro.startPrivate")
          : t("workspace.intro.start")}
      </p>
      {channel.description ? (
        <p className="mt-2 max-w-xl whitespace-pre-line break-words text-sm">
          {channel.description}
        </p>
      ) : null}
      {canManage ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={actionClass} type="button" onClick={onAddPeople}>
            <UsersRound aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("workspace.intro.addPeople")}</span>
            <span className="text-xs text-muted-foreground">
              {t("workspace.intro.addPeopleHint")}
            </span>
          </button>
          <button className={actionClass} type="button" onClick={onAddAgent}>
            <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("workspace.intro.addAgent")}</span>
            <span className="text-xs text-muted-foreground">
              {t("workspace.intro.addAgentHint")}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
