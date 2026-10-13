import { MessagesSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { subscribeForumFocus, takeForumFocus } from "@/features/forums/lib/forum-focus";
import {
  type ForumSort,
  sortTopics,
  summarizeTopics,
  topicReadFrontier,
} from "@/features/forums/lib/forum-model";
import { useForumChannel } from "@/features/forums/lib/use-forum-channel";
import { ForumNewPost } from "@/features/forums/ui/ForumNewPost";
import { ForumTopicDetail } from "@/features/forums/ui/ForumTopicDetail";
import { ForumTopicList } from "@/features/forums/ui/ForumTopicList";
import { t } from "@/shared/i18n";

function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function ForumChannelBody({ channel }: { channel: BuzzChannel }) {
  const {
    relayUrl,
    pubkey,
    profiles,
    connected,
    canManageSelectedChannel,
    readContexts,
    markContextRead,
  } = useWorkspace();
  const forum = useForumChannel(channel);
  const now = useNowSeconds();
  const [sort, setSort] = useState<ForumSort>("activity");
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(() => takeForumFocus(channel.id));
  const [highlightedReplyId, setHighlightedReplyId] = useState<string | null>(null);

  // Deep links (Inbox, reminders) ask for a post/reply via requestForumFocus.
  useEffect(
    () =>
      subscribeForumFocus(() => {
        const eventId = takeForumFocus(channel.id);
        if (eventId) setFocusRequest(eventId);
      }),
    [channel.id],
  );
  const { focusEvent } = forum;
  useEffect(() => {
    if (!focusRequest) return;
    let cancelled = false;
    focusEvent(focusRequest)
      .then((target) => {
        if (cancelled) return;
        if (!target) {
          toast.error(t("collab.forums.focusMissing"));
          return;
        }
        setComposing(false);
        setOpenTopicId(target.postId);
        setHighlightedReplyId(target.replyId);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : t("collab.forums.error.load"));
      })
      .finally(() => {
        if (!cancelled) setFocusRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [focusEvent, focusRequest]);

  const topics = useMemo(
    () =>
      sortTopics(
        summarizeTopics(forum.state, pubkey, (postId) =>
          topicReadFrontier(readContexts, channel.id, postId),
        ),
        sort,
      ),
    [channel.id, forum.state, pubkey, readContexts, sort],
  );
  const openTopic = openTopicId
    ? (topics.find((topic) => topic.event.id === openTopicId) ?? null)
    : null;

  // A topic deleted while open (here or by a moderator elsewhere) returns to the list.
  useEffect(() => {
    if (openTopicId && forum.state.deleted.has(openTopicId)) setOpenTopicId(null);
  }, [forum.state.deleted, openTopicId]);

  // Viewing a topic marks everything up to its latest activity as read (shared read state).
  const openTopicActivity = openTopic?.lastActivity ?? 0;
  useEffect(() => {
    if (openTopicId && openTopicActivity > 0) {
      markContextRead(`thread:${openTopicId}`, openTopicActivity);
    }
  }, [markContextRead, openTopicActivity, openTopicId]);

  const canPost = connected && channel.isMember && !channel.archived;
  const blockedReason = channel.archived
    ? t("collab.forums.archived")
    : !channel.isMember
      ? t("collab.forums.joinToPost")
      : !connected
        ? t("collab.forums.offline")
        : null;
  const permissions = { pubkey, canModerate: canManageSelectedChannel, canPost };

  return (
    <section
      aria-label={t("collab.forums.region")}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {openTopic ? (
        <ForumTopicDetail
          key={openTopic.event.id}
          actions={forum}
          channel={channel}
          highlightedReplyId={highlightedReplyId}
          now={now}
          permissions={permissions}
          profiles={profiles}
          relayUrl={relayUrl}
          state={forum.state}
          topic={openTopic}
          onBack={() => {
            setOpenTopicId(null);
            setHighlightedReplyId(null);
          }}
          onHighlightShown={() => setHighlightedReplyId(null)}
        />
      ) : (
        <ForumTopicList
          blockedReason={blockedReason}
          canPost={canPost}
          composing={composing && canPost}
          hasMore={forum.hasMore}
          loadError={forum.loadError}
          loadingMore={forum.loadingMore}
          newPostForm={
            <ForumNewPost
              channel={channel}
              createPost={forum.createPost}
              profiles={profiles}
              pubkey={pubkey}
              relayUrl={relayUrl}
              onClose={() => setComposing(false)}
            />
          }
          now={now}
          profiles={profiles}
          relayUrl={relayUrl}
          sort={sort}
          status={forum.status}
          topics={topics}
          onLoadMore={forum.loadMore}
          onNewPost={() => setComposing(true)}
          onOpen={setOpenTopicId}
          onRetry={forum.retry}
          onSortChange={setSort}
        />
      )}
    </section>
  );
}

/**
 * Body of a forum channel (kind 45001 posts, 45003 replies), replacing the timeline
 * and composer. Renders nothing for other channel types.
 */
export function ForumChannelView() {
  const { selectedChannel, client, demo } = useWorkspace();
  if (selectedChannel?.type !== "forum") return null;
  if (demo || !client) {
    return (
      <section
        aria-label={t("collab.forums.region")}
        className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <MessagesSquare aria-hidden="true" className="h-9 w-9 text-muted-foreground/50" />
        <p className="max-w-sm text-sm text-muted-foreground">{t("collab.forums.relayRequired")}</p>
      </section>
    );
  }
  return <ForumChannelBody channel={selectedChannel} />;
}
