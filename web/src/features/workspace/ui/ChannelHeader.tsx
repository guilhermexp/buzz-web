import { Hash, Lock, Menu, MessagesSquare, Users } from "lucide-react";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { ChannelHeaderActions } from "@/features/chat/ui/ChannelHeaderActions";
import { ChannelHeaderExtras } from "@/features/chat/ui/WorkspaceExtensions";
import { t } from "@/shared/i18n";

export function ChannelHeader({
  channel,
  displayName,
  detailsVisible,
  onOpenNavigation,
  onSearch,
  onToggleDetails,
  onShowMembers,
}: {
  channel: BuzzChannel | null;
  displayName: string;
  detailsVisible: boolean;
  onOpenNavigation: () => void;
  onSearch: () => void;
  onToggleDetails: () => void;
  onShowMembers: () => void;
}) {
  const Icon = channel?.type === "dm" ? Users : channel?.type === "forum" ? MessagesSquare : Hash;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <button
        aria-label={t("workspace.openChannels")}
        className="buzz-icon-button md:!hidden"
        title={t("common.channel")}
        type="button"
        onClick={onOpenNavigation}
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-base font-semibold leading-6 tracking-tight">
          {displayName}
        </h1>
        {channel?.visibility === "private" ? (
          <Lock
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-label={t("common.private")}
          />
        ) : null}
      </div>
      {channel ? <ChannelHeaderExtras /> : null}
      {channel ? (
        <ChannelHeaderActions
          detailsVisible={detailsVisible}
          memberCount={channel.members.length}
          onSearch={onSearch}
          onShowDetails={onToggleDetails}
          onShowMembers={onShowMembers}
        />
      ) : null}
    </header>
  );
}
