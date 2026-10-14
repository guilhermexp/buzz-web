import { ArrowLeft, Columns2, PanelRightOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AttachmentDescriptor,
  ChannelMember,
  TimelineMessage,
  UserProfile,
} from "@/features/chat/lib/chat-types";
import { isEditableShortcutTarget } from "@/features/chat/lib/workspace-shortcuts";
import { MessageComposer } from "@/features/chat/ui/MessageComposer";
import { MessageRow } from "@/features/chat/ui/MessageList";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import type { ThreadLayout } from "@/features/workspace/lib/display-preferences";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { RightPanelResizeHandle } from "@/shared/ui/right-panel-sizing";

export function ThreadPanel({
  root,
  messages,
  members,
  profiles,
  presence,
  relayUrl,
  disabled,
  maximumWidth,
  minimumWidth,
  panelWidth,
  layout,
  channelLabel,
  onClose,
  onReact,
  onResize,
  onSend,
  onToggleLayout,
  onTyping,
  currentPubkey,
  canModerate,
  onEdit,
  onDelete,
  draftKey,
  initialReplyTarget = null,
  focusedMessageId = null,
}: {
  root: TimelineMessage;
  messages: TimelineMessage[];
  members: ChannelMember[];
  profiles: Record<string, UserProfile>;
  presence: Record<string, "online" | "away" | "offline">;
  relayUrl: string;
  disabled: boolean;
  maximumWidth: number;
  minimumWidth: number;
  panelWidth: number;
  /** `split` docks beside the channel; `focus` covers it, leaving a back sliver. */
  layout: ThreadLayout;
  /** Parent conversation label used by back controls, e.g. `#general`. */
  channelLabel: string;
  onClose: () => void;
  onReact: (message: TimelineMessage, emoji: string) => Promise<void>;
  onResize: (width: number) => void;
  onSend: (
    content: string,
    attachments: AttachmentDescriptor[],
    replyTarget: TimelineMessage,
    extras: ComposerSendExtras,
  ) => Promise<void>;
  onToggleLayout: () => void;
  onTyping: (replyTarget: TimelineMessage) => void;
  currentPubkey: string;
  canModerate: boolean;
  onEdit: (message: TimelineMessage) => void;
  onDelete: (message: TimelineMessage) => void;
  draftKey: string;
  initialReplyTarget?: TimelineMessage | null;
  focusedMessageId?: string | null;
}) {
  const [replyTarget, setReplyTarget] = useState<TimelineMessage | null>(initialReplyTarget);
  const bottomRef = useRef<HTMLDivElement>(null);
  const focus = layout === "focus";
  const threadMessages = [root, ...messages.filter((message) => message.rootId === root.event.id)];
  const threadMessageCount = threadMessages.length;
  const focusedMessageLoaded = threadMessages.some(
    (message) => message.event.id === focusedMessageId,
  );
  const replyTargetPubkey = replyTarget?.event.pubkey.toLowerCase() ?? "";
  const replyTargetProfile = replyTarget
    ? (profiles[replyTargetPubkey] ?? {
        pubkey: replyTargetPubkey,
        name: truncatePubkey(replyTargetPubkey),
        about: "",
        picture: null,
        isAgent: false,
      })
    : null;
  const backLabel = t("workspace.thread.backTo", { channel: channelLabel });
  const toggleLabel = focus ? t("workspace.thread.showBeside") : t("workspace.thread.expand");

  useEffect(() => {
    if (threadMessageCount < 1) return;
    if (focusedMessageLoaded) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [focusedMessageLoaded, threadMessageCount]);

  useEffect(() => {
    if (!focus) return;
    // Registered on document so it runs before the window-level workspace
    // shortcuts, which ignore already-handled Escape presses.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableShortcutTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [focus, onClose]);

  // The wrapper and child order stay identical in both layouts so switching
  // layout never remounts the reply composer (and its in-progress draft).
  return (
    <div className={focus ? "absolute inset-0 z-40 flex" : "contents"}>
      {focus ? (
        <button
          aria-label={backLabel}
          className="hidden w-[72px] shrink-0 bg-black/15 transition-colors hover:bg-black/25 sm:block dark:bg-black/35"
          data-testid="focus-thread-scrim"
          title={backLabel}
          type="button"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-label={t("thread.title")}
        className={
          focus
            ? "relative flex min-h-0 min-w-0 flex-1 flex-col bg-background shadow-[-1px_0_0_0_hsl(var(--border)/0.8),-16px_0_32px_-12px_rgb(0_0_0/0.18)] sm:rounded-l-2xl"
            : "relative flex min-h-0 shrink-0 flex-col border-l bg-background/95 backdrop-blur-xl xl:bg-background/65 xl:backdrop-blur-none max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:shadow-xl max-sm:!w-full"
        }
        data-thread-layout={layout}
        style={focus ? undefined : { width: panelWidth }}
      >
        {focus ? null : (
          <RightPanelResizeHandle
            label={t("thread.resize")}
            maximum={maximumWidth}
            minimum={minimumWidth}
            panelWidth={panelWidth}
            onResize={onResize}
          />
        )}
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-2 sm:px-3">
          <button
            aria-label={backLabel}
            className="buzz-icon-button sm:!hidden"
            title={backLabel}
            type="button"
            onClick={onClose}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            aria-label={toggleLabel}
            className="buzz-icon-button max-xl:!hidden"
            data-testid="thread-view-mode-toggle"
            title={toggleLabel}
            type="button"
            onClick={onToggleLayout}
          >
            {focus ? <Columns2 className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{t("thread.title")}</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("message.replyCount", { count: threadMessages.length - 1 })}
              <span aria-hidden="true"> · </span>
              {channelLabel}
            </p>
          </div>
          <button
            aria-label={t("thread.close")}
            className="buzz-icon-button"
            title={t("thread.close")}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto py-3">
          <div className={focus ? "mx-auto w-full max-w-[880px]" : "w-full"}>
            {threadMessages.map((message) => {
              const pubkey = message.event.pubkey.toLowerCase();
              const profile = profiles[pubkey] ?? {
                pubkey,
                name: truncatePubkey(pubkey),
                about: "",
                picture: null,
                isAgent: false,
              };
              return (
                <MessageRow
                  canModerate={canModerate}
                  currentPubkey={currentPubkey}
                  focused={message.event.id === focusedMessageId}
                  key={message.event.id}
                  message={message}
                  profile={profile}
                  profiles={profiles}
                  relayUrl={relayUrl}
                  presence={presence[pubkey]}
                  showThreadAction={false}
                  onReply={message.event.id === root.event.id ? undefined : setReplyTarget}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onReact={onReact}
                />
              );
            })}
            <div ref={bottomRef} className="h-px" data-testid="thread-bottom" />
          </div>
        </div>
        <div className={focus ? "mx-auto w-full max-w-[880px]" : "w-full"}>
          <MessageComposer
            compact
            disabled={disabled}
            draftKey={draftKey}
            members={members}
            placeholder={t("thread.reply")}
            profiles={profiles}
            relayUrl={relayUrl}
            replyTarget={
              replyTarget && replyTargetProfile
                ? {
                    id: replyTarget.event.id,
                    author: replyTargetProfile.name,
                    body: replyTarget.content,
                  }
                : null
            }
            onCancelReply={() => setReplyTarget(null)}
            onSend={async (content, attachments, extras) => {
              await onSend(content, attachments, replyTarget ?? root, extras);
              setReplyTarget(null);
            }}
            onTyping={() => onTyping(replyTarget ?? root)}
          />
        </div>
      </aside>
    </div>
  );
}
