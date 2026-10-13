import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AttachmentDescriptor,
  BuzzChannel,
  SessionState,
  TimelineMessage,
} from "@/features/chat/lib/chat-types";
import { conversationDraftKey } from "@/features/chat/lib/conversation-drafts";
import { AgentActivityIndicator } from "@/features/chat/ui/AgentActivityIndicator";
import { MessageComposer } from "@/features/chat/ui/MessageComposer";
import { MessageList } from "@/features/chat/ui/MessageList";
import { ChannelBodyOverride, ChannelSurfaceExtras } from "@/features/chat/ui/WorkspaceExtensions";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import { channelAddRoles } from "@/features/workspace/lib/channel-permissions";
import { ChannelHeader } from "@/features/workspace/ui/ChannelHeader";
import { ChannelIntro } from "@/features/workspace/ui/ChannelIntro";
import { t } from "@/shared/i18n";

type ActivityIndicatorProps = Pick<
  Parameters<typeof AgentActivityIndicator>[0],
  "itemCount" | "statuses"
>;

export function ChannelSurface({
  state,
  channel,
  displayName,
  pubkey,
  relayUrl,
  connected,
  canManageChannel,
  focusedMessageId,
  unreadAfter,
  detailsVisible,
  insertMention,
  typingNames,
  activity,
  hidden,
  onMentionInserted,
  onOpenNavigation,
  onSearchChannel,
  onToggleDetails,
  onShowMembers,
  onAddPeople,
  onAddAgent,
  onOpenThread,
  onReact,
  onEdit,
  onDelete,
  onOpenActivity,
  onSend,
  onTyping,
  onChangeIdentity,
}: {
  state: SessionState;
  channel: BuzzChannel | null;
  displayName: string;
  pubkey: string;
  relayUrl: string;
  connected: boolean;
  canManageChannel: boolean;
  focusedMessageId: string | null;
  unreadAfter: number | null;
  detailsVisible: boolean;
  insertMention: string | null;
  typingNames: string[];
  activity: ActivityIndicatorProps;
  /** Focused thread mode covers the conversation; keep it mounted but inert. */
  hidden: boolean;
  onMentionInserted: () => void;
  onOpenNavigation: () => void;
  onSearchChannel: () => void;
  onToggleDetails: () => void;
  onShowMembers: () => void;
  onAddPeople: () => void;
  onAddAgent: () => void;
  onOpenThread: (message: TimelineMessage, reply: boolean) => void;
  onReact: (message: TimelineMessage, emoji: string) => Promise<void>;
  onEdit: (message: TimelineMessage) => void;
  onDelete: (message: TimelineMessage) => void;
  onOpenActivity: () => void;
  onSend: (
    content: string,
    attachments: AttachmentDescriptor[],
    extras: ComposerSendExtras,
  ) => Promise<void>;
  onTyping: () => void;
  onChangeIdentity: () => void;
}) {
  const override = channel ? ChannelBodyOverride({ channel }) : null;
  // The session loads the newest 150 timeline events; fewer means the
  // channel's beginning is loaded, so the intro belongs at the top.
  const historyStartLoaded = !state.loadingMessages && state.messages.length < 150;
  let body: ReactNode;
  if (!channel) {
    body = (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {state.loadingChannels ? (
          <>
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            {t("workspace.loadingChannels")}
          </>
        ) : (
          t("workspace.noChannels")
        )}
      </div>
    );
  } else if (override) {
    body = override;
  } else {
    body = (
      <>
        <ChannelSurfaceExtras />
        <MessageList
          canModerate={canManageChannel}
          currentPubkey={pubkey}
          focusedMessageId={focusedMessageId}
          intro={
            historyStartLoaded && channel.type !== "dm" ? (
              <ChannelIntro
                canAdd={channelAddRoles(channel, pubkey).length > 0}
                channel={channel}
                onAddAgent={onAddAgent}
                onAddPeople={onAddPeople}
              />
            ) : null
          }
          loading={state.loadingMessages}
          messages={state.messages}
          presence={state.presence}
          profiles={state.profiles}
          relayUrl={relayUrl}
          unreadAfter={unreadAfter}
          onDelete={onDelete}
          onEdit={onEdit}
          onOpenThread={(message) => onOpenThread(message, false)}
          onReact={onReact}
          onReply={(message) => onOpenThread(message, true)}
        />
        <AgentActivityIndicator
          itemCount={activity.itemCount}
          profiles={state.profiles}
          statuses={activity.statuses}
          onOpen={onOpenActivity}
        />
        {typingNames.length ? (
          <div className="h-6 shrink-0 px-5 text-[11px] text-muted-foreground">
            {t("workspace.typing", { names: typingNames.slice(0, 3).join(", ") })}
          </div>
        ) : null}
        <MessageComposer
          key={channel.id}
          disabled={!connected}
          draftKey={conversationDraftKey(relayUrl, pubkey, channel.id)}
          insertMention={insertMention}
          members={channel.members}
          placeholder={t("workspace.sendTo", {
            target: channel.type === "dm" ? displayName : `#${displayName}`,
          })}
          profiles={state.profiles}
          relayUrl={relayUrl}
          onMentionInserted={onMentionInserted}
          onSend={onSend}
          onTyping={onTyping}
        />
      </>
    );
  }

  return (
    <main
      aria-hidden={hidden || undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      inert={hidden}
    >
      <ChannelHeader
        channel={channel}
        detailsVisible={detailsVisible}
        displayName={displayName}
        onOpenNavigation={onOpenNavigation}
        onSearch={onSearchChannel}
        onShowMembers={onShowMembers}
        onToggleDetails={onToggleDetails}
      />
      {state.error ? (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/8 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{state.error}</span>
          {state.error.toLowerCase().includes("member") || state.error.includes("成员") ? (
            <button
              className="shrink-0 font-medium underline"
              type="button"
              onClick={onChangeIdentity}
            >
              {t("workspace.changeIdentity")}
            </button>
          ) : null}
        </div>
      ) : null}
      {body}
    </main>
  );
}
