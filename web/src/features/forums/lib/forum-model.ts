import {
  FORUM_COMMENT_KIND,
  FORUM_DELETE_KIND,
  FORUM_EDIT_KIND,
  FORUM_MODERATOR_DELETE_KIND,
  FORUM_POST_KIND,
  forumReplyReference,
  referencedEventId,
} from "@/features/forums/lib/forum-events";
import type { NostrEvent } from "@/shared/api/nostr-types";

/** Everything the Relay returned for one forum channel. Immutable; merge returns a new value. */
export type ForumState = {
  posts: ReadonlyMap<string, NostrEvent>;
  comments: ReadonlyMap<string, NostrEvent>;
  /** Edit events by target id; validity (same author) is checked when resolving. */
  edits: ReadonlyMap<string, readonly NostrEvent[]>;
  deleted: ReadonlySet<string>;
};

export const EMPTY_FORUM_STATE: ForumState = {
  posts: new Map(),
  comments: new Map(),
  edits: new Map(),
  deleted: new Set(),
};

export type ForumSort = "activity" | "newest";

export type ForumEntry = {
  event: NostrEvent;
  /** Content after the author's latest edit. */
  content: string;
  edited: boolean;
  /** `p`/`mention` tags of the event and its accepted edits. */
  mentionPubkeys: string[];
};

export type ForumTopic = ForumEntry & {
  title: string;
  excerpt: string;
  replyCount: number;
  lastReplyAt: number | null;
  /** max(post, comments) created_at. */
  lastActivity: number;
  /** Latest post/comment created_at by someone other than the current identity (0 if none). */
  latestOtherActivity: number;
  participants: string[];
  unread: boolean;
};

export type ForumReplyNode = ForumEntry & {
  parentId: string;
  children: ForumReplyNode[];
};

function channelOf(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

/** Merge Relay events for `channelId`; returns the same object when nothing changed. */
export function mergeForumEvents(
  state: ForumState,
  events: readonly NostrEvent[],
  channelId: string,
): ForumState {
  let posts: Map<string, NostrEvent> | null = null;
  let comments: Map<string, NostrEvent> | null = null;
  let edits: Map<string, readonly NostrEvent[]> | null = null;
  let deleted: Set<string> | null = null;
  for (const event of events) {
    if (channelOf(event) !== channelId) continue;
    if (event.kind === FORUM_POST_KIND) {
      if (state.posts.has(event.id) || posts?.has(event.id)) continue;
      posts ??= new Map(state.posts);
      posts.set(event.id, event);
    } else if (event.kind === FORUM_COMMENT_KIND) {
      if (state.comments.has(event.id) || comments?.has(event.id)) continue;
      comments ??= new Map(state.comments);
      comments.set(event.id, event);
    } else if (event.kind === FORUM_EDIT_KIND) {
      const target = referencedEventId(event);
      if (!target) continue;
      const current = edits?.get(target) ?? state.edits.get(target) ?? [];
      if (current.some((edit) => edit.id === event.id)) continue;
      edits ??= new Map(state.edits);
      edits.set(target, [...current, event]);
    } else if (event.kind === FORUM_DELETE_KIND || event.kind === FORUM_MODERATOR_DELETE_KIND) {
      // The Relay accepted these only from the author (5) or a channel owner/admin (9005).
      for (const tag of event.tags) {
        if (tag[0] !== "e" || !tag[1] || state.deleted.has(tag[1]) || deleted?.has(tag[1])) {
          continue;
        }
        deleted ??= new Set(state.deleted);
        deleted.add(tag[1]);
      }
    }
  }
  if (!posts && !comments && !edits && !deleted) return state;
  return {
    posts: posts ?? state.posts,
    comments: comments ?? state.comments,
    edits: edits ?? state.edits,
    deleted: deleted ?? state.deleted,
  };
}

function eventMentionPubkeys(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => (tag[0] === "p" || tag[0] === "mention") && /^[0-9a-f]{64}$/i.test(tag[1]))
    .map((tag) => tag[1].toLowerCase());
}

/** Apply the latest edit signed by the event's own author (ties broken by id). */
export function resolveEntry(state: ForumState, event: NostrEvent): ForumEntry {
  let latest: NostrEvent | null = null;
  const mentions = new Set(eventMentionPubkeys(event));
  for (const edit of state.edits.get(event.id) ?? []) {
    if (edit.pubkey !== event.pubkey || state.deleted.has(edit.id)) continue;
    for (const pubkey of eventMentionPubkeys(edit)) mentions.add(pubkey);
    if (
      !latest ||
      edit.created_at > latest.created_at ||
      (edit.created_at === latest.created_at && edit.id > latest.id)
    ) {
      latest = edit;
    }
  }
  return {
    event,
    content: latest?.content ?? event.content,
    edited: latest !== null,
    mentionPubkeys: [...mentions],
  };
}

const HEADING = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * Desktop forum posts have no title tag; content is Markdown. Web encodes the title
 * as a leading ATX heading so Desktop renders it as the post's heading.
 */
export function composeTopicContent(title: string, body: string): string {
  const heading = title.replace(/\s+/g, " ").trim();
  const text = body.trim();
  if (!heading) return text;
  return text ? `# ${heading}\n\n${text}` : `# ${heading}`;
}

/**
 * Title = leading heading (`fromHeading`), else the first non-empty line;
 * body = the remainder. Desktop-authored posts usually have no heading.
 */
export function splitTopicContent(content: string): {
  title: string;
  body: string;
  fromHeading: boolean;
} {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return { title: "", body: "", fromHeading: false };
  const line = lines[first].trim();
  const heading = HEADING.exec(line);
  return {
    title: heading ? heading[1].trim() : markdownToPlainText(line),
    body: lines
      .slice(first + 1)
      .join("\n")
      .trim(),
    fromHeading: heading !== null,
  };
}

/** Rough Markdown → plain text for one-line previews (never rendered as HTML). */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function topicReadFrontier(
  readContexts: Readonly<Record<string, number>>,
  channelId: string,
  postId: string,
): number {
  return Math.max(readContexts[channelId] ?? 0, readContexts[`thread:${postId}`] ?? 0);
}

function commentsByRoot(state: ForumState): Map<string, NostrEvent[]> {
  const grouped = new Map<string, NostrEvent[]>();
  for (const comment of state.comments.values()) {
    if (state.deleted.has(comment.id)) continue;
    const { rootId } = forumReplyReference(comment);
    if (!rootId) continue;
    grouped.set(rootId, [...(grouped.get(rootId) ?? []), comment]);
  }
  return grouped;
}

export function summarizeTopics(
  state: ForumState,
  currentPubkey: string,
  readFrontier: (postId: string) => number,
): ForumTopic[] {
  const me = currentPubkey.toLowerCase();
  const grouped = commentsByRoot(state);
  const topics: ForumTopic[] = [];
  for (const post of state.posts.values()) {
    if (state.deleted.has(post.id)) continue;
    const entry = resolveEntry(state, post);
    const replies = grouped.get(post.id) ?? [];
    let lastReplyAt: number | null = null;
    let latestOtherActivity = post.pubkey.toLowerCase() === me ? 0 : post.created_at;
    const participants = new Set<string>([post.pubkey.toLowerCase()]);
    for (const reply of replies) {
      lastReplyAt = Math.max(lastReplyAt ?? 0, reply.created_at);
      participants.add(reply.pubkey.toLowerCase());
      if (reply.pubkey.toLowerCase() !== me) {
        latestOtherActivity = Math.max(latestOtherActivity, reply.created_at);
      }
    }
    const { title, body } = splitTopicContent(entry.content);
    topics.push({
      ...entry,
      title,
      excerpt: markdownToPlainText(body),
      replyCount: replies.length,
      lastReplyAt,
      lastActivity: Math.max(post.created_at, lastReplyAt ?? 0),
      latestOtherActivity,
      participants: [...participants],
      unread: latestOtherActivity > readFrontier(post.id),
    });
  }
  return topics;
}

export function sortTopics(topics: readonly ForumTopic[], sort: ForumSort): ForumTopic[] {
  return [...topics].sort((left, right) => {
    if (sort === "activity" && left.lastActivity !== right.lastActivity) {
      return right.lastActivity - left.lastActivity;
    }
    if (left.event.created_at !== right.event.created_at) {
      return right.event.created_at - left.event.created_at;
    }
    return left.event.id.localeCompare(right.event.id);
  });
}

/**
 * Nested replies of one post. A reply whose parent is missing (deleted or not loaded)
 * is shown at the top level instead of disappearing with it.
 */
export function buildReplyTree(state: ForumState, postId: string): ForumReplyNode[] {
  const replies = commentsByRoot(state).get(postId) ?? [];
  const nodes = new Map<string, ForumReplyNode>();
  for (const reply of replies) {
    const { parentId } = forumReplyReference(reply);
    nodes.set(reply.id, {
      ...resolveEntry(state, reply),
      parentId: parentId ?? postId,
      children: [],
    });
  }
  const reachesRoot = (node: ForumReplyNode): boolean => {
    const seen = new Set<string>([node.event.id]);
    let parent = nodes.get(node.parentId);
    while (parent) {
      if (seen.has(parent.event.id)) return false;
      seen.add(parent.event.id);
      parent = nodes.get(parent.parentId);
    }
    return true;
  };
  const roots: ForumReplyNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parentId);
    if (parent && reachesRoot(node)) parent.children.push(node);
    else roots.push(node);
  }
  const byTime = (left: ForumReplyNode, right: ForumReplyNode) =>
    left.event.created_at - right.event.created_at || left.event.id.localeCompare(right.event.id);
  const sortDeep = (list: ForumReplyNode[]) => {
    list.sort(byTime);
    for (const node of list) sortDeep(node.children);
  };
  sortDeep(roots);
  return roots;
}
