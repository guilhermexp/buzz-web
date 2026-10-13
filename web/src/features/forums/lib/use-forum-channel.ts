import { useCallback, useEffect, useRef, useState } from "react";
import { messageRecipientPubkeys } from "@/features/chat/lib/chat-model";
import type { AttachmentDescriptor, BuzzChannel } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { ComposerSendExtras } from "@/features/composer/lib/send-extras";
import {
  FORUM_COMMENT_KIND,
  FORUM_EDIT_KIND,
  FORUM_LIVE_KINDS,
  FORUM_POST_KIND,
  forumCommentTemplate,
  forumDeleteTemplate,
  forumEditMentions,
  forumEditTemplate,
  forumPostTemplate,
  nextPageCursor,
} from "@/features/forums/lib/forum-events";
import { type ForumFocusTarget, resolveForumFocus } from "@/features/forums/lib/forum-focus";
import { forumActionError } from "@/features/forums/lib/forum-format";
import {
  composeTopicContent,
  EMPTY_FORUM_STATE,
  type ForumEntry,
  type ForumState,
  mergeForumEvents,
} from "@/features/forums/lib/forum-model";
import type { EventTemplate, NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";

const PAGE_SIZE = 30;
const RELAY_MAX_LIMIT = 1_000;
const MAX_PAGES_PER_QUERY = 20;
const IDS_PER_FILTER = 100;

type PageCursor = { until: number; beforeId: string };
/** Buzz Relay keyset pagination extension (`before_id` requires `until`). */
type RelayPageFilter = NostrFilter & { before_id?: string };

/** Read every page of `filter` using the Relay's `until` + `before_id` keyset cursor. */
async function queryAllPages(client: BuzzRelayClient, filter: NostrFilter): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  let cursor: PageCursor | null = null;
  for (let page = 0; page < MAX_PAGES_PER_QUERY; page += 1) {
    const paged: RelayPageFilter = cursor
      ? { ...filter, limit: RELAY_MAX_LIMIT, until: cursor.until, before_id: cursor.beforeId }
      : { ...filter, limit: RELAY_MAX_LIMIT };
    const batch = await client.query(paged);
    events.push(...batch);
    cursor = nextPageCursor(batch);
    if (batch.length < RELAY_MAX_LIMIT || !cursor) break;
  }
  return events;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Every comment and edit that belongs to `posts` (plus the posts themselves). */
async function withThreads(
  client: BuzzRelayClient,
  channelId: string,
  posts: NostrEvent[],
): Promise<NostrEvent[]> {
  const postIds = posts.map((post) => post.id);
  const comments: NostrEvent[] = [];
  for (const ids of chunks(postIds, IDS_PER_FILTER)) {
    comments.push(
      ...(await queryAllPages(client, {
        kinds: [FORUM_COMMENT_KIND],
        "#h": [channelId],
        "#e": ids,
      })),
    );
  }
  const edits: NostrEvent[] = [];
  for (const ids of chunks(
    [...postIds, ...comments.map((comment) => comment.id)],
    IDS_PER_FILTER,
  )) {
    edits.push(
      ...(await queryAllPages(client, { kinds: [FORUM_EDIT_KIND], "#h": [channelId], "#e": ids })),
    );
  }
  return [...posts, ...comments, ...edits];
}

/** One page of posts plus every comment and edit that belongs to them. */
async function loadForumPage(
  client: BuzzRelayClient,
  channelId: string,
  cursor: PageCursor | null,
) {
  const postFilter: RelayPageFilter = {
    kinds: [FORUM_POST_KIND],
    "#h": [channelId],
    limit: PAGE_SIZE,
    ...(cursor ? { until: cursor.until, before_id: cursor.beforeId } : {}),
  };
  const posts = await client.query(postFilter);
  return {
    events: await withThreads(client, channelId, posts),
    cursor: nextPageCursor(posts),
    hasMore: posts.length === PAGE_SIZE,
  };
}

/** Forum data for one channel plus Relay-backed actions; actions throw localized errors. */
export type ForumChannelData = {
  state: ForumState;
  status: "loading" | "ready" | "error";
  loadError: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  retry: () => void;
  createPost: (
    title: string,
    body: string,
    attachments: AttachmentDescriptor[],
    extras?: ComposerSendExtras,
  ) => Promise<NostrEvent>;
  reply: (
    post: NostrEvent,
    parent: NostrEvent | null,
    content: string,
    attachments: AttachmentDescriptor[],
    extras?: ComposerSendExtras,
  ) => Promise<void>;
  edit: (entry: ForumEntry, content: string) => Promise<void>;
  remove: (event: NostrEvent) => Promise<void>;
  /** Load the topic containing a post/reply id; null when it is not in this forum (or deleted). */
  focusEvent: (eventId: string) => Promise<ForumFocusTarget | null>;
};

export function useForumChannel(channel: BuzzChannel): ForumChannelData {
  const { client, pubkey, profiles, canManageSelectedChannel, ensureProfiles } = useWorkspace();
  const channelId = channel.id;
  const [state, setState] = useState<ForumState>(EMPTY_FORUM_STATE);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<PageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestedProfiles = useRef(new Set<string>());

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const since = Math.floor(Date.now() / 1_000);
    void client
      .subscribe({ kinds: FORUM_LIVE_KINDS, "#h": [channelId], since, limit: 0 }, (event) =>
        setState((current) => mergeForumEvents(current, [event], channelId)),
      )
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [channelId, client]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setStatus("loading");
    setLoadError(null);
    loadForumPage(client, channelId, null)
      .then((page) => {
        if (cancelled) return;
        setState((current) => mergeForumEvents(current, page.events, channelId));
        setCursor(page.cursor);
        setHasMore(page.hasMore);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(forumActionError("collab.forums.error.load", error).message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, channelId, client]);

  useEffect(() => {
    const missing = new Set<string>();
    for (const event of [...state.posts.values(), ...state.comments.values()]) {
      for (const candidate of [
        event.pubkey,
        ...event.tags.filter((tag) => tag[0] === "p" || tag[0] === "mention").map((tag) => tag[1]),
      ]) {
        const key = candidate?.toLowerCase();
        if (key && /^[0-9a-f]{64}$/.test(key) && !requestedProfiles.current.has(key)) {
          missing.add(key);
        }
      }
    }
    if (!missing.size) return;
    for (const key of missing) requestedProfiles.current.add(key);
    void ensureProfiles([...missing]).catch(() => undefined);
  }, [ensureProfiles, state.comments, state.posts]);

  const loadMore = useCallback(async () => {
    if (!client || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadForumPage(client, channelId, cursor);
      setState((current) => mergeForumEvents(current, page.events, channelId));
      setCursor(page.cursor ?? cursor);
      setHasMore(page.hasMore);
    } catch (error) {
      throw forumActionError("collab.forums.error.load", error);
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, client, cursor, loadingMore]);

  const publish = useCallback(
    async (template: EventTemplate, action: Parameters<typeof forumActionError>[0]) => {
      if (!client) throw new Error(t("error.relayClient"));
      try {
        const { event } = await client.publish(template);
        setState((current) => mergeForumEvents(current, [event], channelId));
        return event;
      } catch (error) {
        throw forumActionError(action, error);
      }
    },
    [channelId, client],
  );

  const createPost = useCallback(
    async (
      title: string,
      body: string,
      attachments: AttachmentDescriptor[],
      extras?: ComposerSendExtras,
    ): Promise<NostrEvent> => {
      if (!title.trim()) throw new Error(t("collab.forums.titleRequired"));
      const content = composeTopicContent(title, body);
      const mentions = messageRecipientPubkeys(
        content,
        channel,
        profiles,
        pubkey,
        null,
        [],
        extras?.mentionPubkeys,
      );
      return publish(
        forumPostTemplate({
          channelId,
          content,
          mentions,
          attachments,
          extraTags: extras?.emojiTags,
        }),
        "collab.forums.error.post",
      );
    },
    [channel, channelId, profiles, publish, pubkey],
  );

  const reply = useCallback(
    async (
      post: NostrEvent,
      parent: NostrEvent | null,
      content: string,
      attachments: AttachmentDescriptor[],
      extras?: ComposerSendExtras,
    ): Promise<void> => {
      if (!content.trim() && !attachments.length) return;
      const mentions = messageRecipientPubkeys(
        content,
        channel,
        profiles,
        pubkey,
        { authorPubkey: (parent ?? post).pubkey, rootId: post.id },
        [],
        extras?.mentionPubkeys,
      );
      await publish(
        forumCommentTemplate({
          channelId,
          rootId: post.id,
          parentId: parent?.id ?? post.id,
          content,
          mentions,
          attachments,
          extraTags: extras?.emojiTags,
        }),
        "collab.forums.error.reply",
      );
    },
    [channel, channelId, profiles, publish, pubkey],
  );

  const edit = useCallback(
    async (entry: ForumEntry, content: string): Promise<void> => {
      if (!content.trim() || content === entry.content) return;
      // Throws the localized AmbiguousMentionError; ForumEntryView shows it (role=alert).
      const addedMentions = forumEditMentions({
        previousContent: entry.content,
        content,
        members: channel.members,
        profiles,
        editorPubkey: pubkey,
      });
      await publish(
        forumEditTemplate({ channelId, target: entry.event, content, addedMentions }),
        "collab.forums.error.edit",
      );
    },
    [channel.members, channelId, profiles, publish, pubkey],
  );

  const remove = useCallback(
    async (event: NostrEvent): Promise<void> => {
      const asModerator = event.pubkey.toLowerCase() !== pubkey.toLowerCase();
      if (asModerator && !canManageSelectedChannel) {
        throw new Error(t("collab.forums.error.deletePermission"));
      }
      await publish(
        forumDeleteTemplate({ channelId, targetId: event.id, asModerator }),
        "collab.forums.error.delete",
      );
    },
    [canManageSelectedChannel, channelId, publish, pubkey],
  );

  const focusEvent = useCallback(
    async (eventId: string): Promise<ForumFocusTarget | null> => {
      if (!client) throw new Error(t("error.relayClient"));
      try {
        const [event] = await client.query({
          ids: [eventId],
          kinds: [FORUM_POST_KIND, FORUM_COMMENT_KIND],
        });
        const target = event ? resolveForumFocus(event, channelId) : null;
        if (!target) return null;
        const posts = await client.query({
          ids: [target.postId],
          kinds: [FORUM_POST_KIND],
          "#h": [channelId],
        });
        if (!posts.length) return null;
        const events = await withThreads(client, channelId, posts);
        setState((current) => mergeForumEvents(current, events, channelId));
        return target;
      } catch (error) {
        throw forumActionError("collab.forums.error.load", error);
      }
    },
    [channelId, client],
  );

  return {
    state,
    status,
    loadError,
    hasMore,
    loadingMore,
    loadMore,
    retry: () => setAttempt((value) => value + 1),
    createPost,
    reply,
    edit,
    remove,
    focusEvent,
  };
}
