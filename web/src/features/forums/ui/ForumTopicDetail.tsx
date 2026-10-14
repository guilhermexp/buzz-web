import { ArrowLeft, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import { conversationDraftKey } from "@/features/chat/lib/conversation-drafts";
import { MessageComposer } from "@/features/chat/ui/MessageComposer";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import { formatReplyCount } from "@/features/forums/lib/forum-format";
import {
  buildReplyTree,
  type ForumEntry,
  type ForumReplyNode,
  type ForumState,
  type ForumTopic,
  splitTopicContent,
} from "@/features/forums/lib/forum-model";
import type { ForumChannelData } from "@/features/forums/lib/use-forum-channel";
import { ForumEntryView, profileFor } from "@/features/forums/ui/ForumEntryView";
import { t } from "@/shared/i18n";

/** Visual nesting stops here; deeper replies keep their thread but no extra indent. */
const MAX_INDENT_DEPTH = 4;

export type EntryPermissions = {
  pubkey: string;
  canModerate: boolean;
  canPost: boolean;
};

function ReplyList({
  nodes,
  depth,
  permissions,
  profiles,
  relayUrl,
  now,
  actions,
  flashId,
  onReplyTo,
}: {
  nodes: ForumReplyNode[];
  depth: number;
  permissions: EntryPermissions;
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  now: number;
  actions: ForumChannelData;
  flashId: string | null;
  onReplyTo: (entry: ForumEntry) => void;
}) {
  return (
    <ol className={depth === 0 ? "space-y-1" : "mt-1 space-y-1"}>
      {nodes.map((node) => {
        const own = node.event.pubkey.toLowerCase() === permissions.pubkey.toLowerCase();
        return (
          <li key={node.event.id}>
            <div
              className={`rounded-md px-2 py-2 transition-colors duration-700 ${
                flashId === node.event.id
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : "hover:bg-foreground/[0.025]"
              }`}
              data-highlighted={flashId === node.event.id || undefined}
            >
              <ForumEntryView
                canDelete={own || permissions.canModerate}
                canEdit={own}
                entry={node}
                kind="reply"
                now={now}
                profiles={profiles}
                relayUrl={relayUrl}
                onDelete={() => actions.remove(node.event)}
                onEdit={(content) => actions.edit(node, content)}
                onReply={permissions.canPost ? () => onReplyTo(node) : undefined}
              />
            </div>
            {node.children.length ? (
              <div
                className={
                  depth < MAX_INDENT_DEPTH ? "ml-[21px] border-l border-border pl-2 sm:pl-3" : ""
                }
              >
                <ReplyList
                  actions={actions}
                  flashId={flashId}
                  depth={depth + 1}
                  nodes={node.children}
                  now={now}
                  permissions={permissions}
                  profiles={profiles}
                  relayUrl={relayUrl}
                  onReplyTo={onReplyTo}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function countReplies(nodes: readonly ForumReplyNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countReplies(node.children), 0);
}

export function ForumTopicDetail({
  channel,
  topic,
  state,
  actions,
  permissions,
  profiles,
  relayUrl,
  now,
  highlightedReplyId,
  onBack,
  onHighlightShown,
}: {
  channel: BuzzChannel;
  topic: ForumTopic;
  state: ForumState;
  actions: ForumChannelData;
  permissions: EntryPermissions;
  profiles: Record<string, UserProfile>;
  relayUrl: string;
  now: number;
  /** Reply to scroll to and briefly highlight (deep link). */
  highlightedReplyId: string | null;
  onBack: () => void;
  onHighlightShown: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ForumEntry | null>(null);
  const tree = useMemo(() => buildReplyTree(state, topic.event.id), [state, topic.event.id]);
  const replyCount = countReplies(tree);
  const highlightPresent = highlightedReplyId !== null && state.comments.has(highlightedReplyId);

  useEffect(() => {
    if (!highlightedReplyId || !highlightPresent) return;
    const element = scrollRef.current?.querySelector<HTMLElement>(
      `[data-forum-event-id="${CSS.escape(highlightedReplyId)}"]`,
    );
    element?.scrollIntoView({ block: "center" });
    setFlashId(highlightedReplyId);
    onHighlightShown();
  }, [highlightPresent, highlightedReplyId, onHighlightShown]);
  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), 2_500);
    return () => window.clearTimeout(timer);
  }, [flashId]);
  const { title, body, fromHeading } = splitTopicContent(topic.content);
  const ownPost = topic.event.pubkey.toLowerCase() === permissions.pubkey.toLowerCase();
  const target = replyTarget && state.deleted.has(replyTarget.event.id) ? null : replyTarget;
  const targetAuthor = target ? profileFor(profiles, target.event.pubkey) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b px-2 sm:px-3">
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("collab.forums.backToPosts")}
        </button>
      </div>
      <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="mx-auto w-full max-w-[880px] px-3 pb-4 sm:px-5">
          <article aria-labelledby={`forum-topic-${topic.event.id}`} className="border-b py-4">
            <h2
              className={
                fromHeading
                  ? "mb-3 text-lg font-semibold leading-snug text-balance break-words"
                  : "sr-only"
              }
              id={`forum-topic-${topic.event.id}`}
            >
              {title || t("collab.forums.untitled")}
            </h2>
            <ForumEntryView
              body={fromHeading ? body : undefined}
              canDelete={ownPost || permissions.canModerate}
              canEdit={ownPost}
              entry={topic}
              kind="post"
              now={now}
              profiles={profiles}
              relayUrl={relayUrl}
              onDelete={async () => {
                await actions.remove(topic.event);
                onBack();
              }}
              onEdit={(content) => actions.edit(topic, content)}
            />
          </article>
          <h3 className="flex items-center gap-1.5 py-3 text-sm font-medium text-muted-foreground">
            <MessageSquare aria-hidden="true" className="h-4 w-4" />
            {formatReplyCount(replyCount)}
          </h3>
          {tree.length ? (
            <ReplyList
              actions={actions}
              flashId={flashId}
              depth={0}
              nodes={tree}
              now={now}
              permissions={permissions}
              profiles={profiles}
              relayUrl={relayUrl}
              onReplyTo={setReplyTarget}
            />
          ) : (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t("collab.forums.noReplies")}
            </p>
          )}
        </div>
      </div>
      {permissions.canPost ? (
        <div className="shrink-0 border-t pt-3">
          <div className="mx-auto w-full max-w-[880px]">
            <MessageComposer
              compact
              draftKey={conversationDraftKey(
                relayUrl,
                permissions.pubkey,
                channel.id,
                topic.event.id,
              )}
              members={channel.members}
              placeholder={t("collab.forums.replyPlaceholder")}
              profiles={profiles}
              relayUrl={relayUrl}
              replyTarget={
                target && targetAuthor
                  ? { id: target.event.id, author: targetAuthor.name, body: target.content }
                  : null
              }
              onCancelReply={() => setReplyTarget(null)}
              onSend={async (content, attachments, extras?: ComposerSendExtras) => {
                await actions.reply(
                  topic.event,
                  target?.event ?? null,
                  content,
                  attachments,
                  extras,
                );
                setReplyTarget(null);
              }}
              onTyping={() => undefined}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
