import {
  buildMessageTags,
  memberMentionCandidates,
  resolveMentionPubkeys,
} from "@/features/chat/lib/chat-model";
import type {
  AttachmentDescriptor,
  ChannelMember,
  UserProfile,
} from "@/features/chat/lib/chat-types";
import { extractMentionPubkeys } from "@/features/composer/lib/mention-bindings";
import type { EventTemplate, NostrEvent } from "@/shared/api/nostr-types";

export const FORUM_POST_KIND = 45001;
export const FORUM_COMMENT_KIND = 45003;
export const FORUM_EDIT_KIND = 40003;
export const FORUM_DELETE_KIND = 5;
/** NIP-29 moderator removal; the Relay rejects kind 5 for anyone but the author. */
export const FORUM_MODERATOR_DELETE_KIND = 9005;
export const FORUM_LIVE_KINDS = [
  FORUM_POST_KIND,
  FORUM_COMMENT_KIND,
  FORUM_EDIT_KIND,
  FORUM_DELETE_KIND,
  FORUM_MODERATOR_DELETE_KIND,
];

type ForumBodyInput = {
  channelId: string;
  content: string;
  mentions: string[];
  attachments: AttachmentDescriptor[];
  /** Pre-built tags such as NIP-30 `emoji` tags from the composer. */
  extraTags?: readonly string[][];
};

/** Kind 45001 with Desktop's tag order: `h`, `p` mentions, `imeta`, extra tags. */
export function forumPostTemplate(input: ForumBodyInput): EventTemplate {
  return {
    kind: FORUM_POST_KIND,
    content: input.content,
    tags: buildMessageTags(
      input.channelId,
      input.mentions,
      input.attachments,
      null,
      input.extraTags,
    ),
  };
}

/**
 * Kind 45003. NIP-10 as Desktop's `thread_tags`: a direct reply to the post carries
 * one `["e", root, "", "reply"]`; a reply to a comment carries `root` then `reply`.
 */
export function forumCommentTemplate(
  input: ForumBodyInput & { rootId: string; parentId: string },
): EventTemplate {
  return {
    kind: FORUM_COMMENT_KIND,
    content: input.content,
    tags: buildMessageTags(
      input.channelId,
      input.mentions,
      input.attachments,
      { id: input.parentId, rootId: input.rootId },
      input.extraTags,
    ),
  };
}

/**
 * Members newly mentioned by an edit (the chat edit path): a typed name shared by
 * several members throws the localized `AmbiguousMentionError` instead of silently
 * notifying nobody. Mentions already in the previous content and the editor are excluded.
 */
export function forumEditMentions(input: {
  previousContent: string;
  content: string;
  members: ChannelMember[];
  profiles: Record<string, UserProfile>;
  editorPubkey: string;
}): string[] {
  const previous = new Set(
    resolveMentionPubkeys(input.previousContent, input.members, input.profiles),
  );
  const editor = input.editorPubkey.toLowerCase();
  return extractMentionPubkeys(
    input.content,
    new Map(),
    memberMentionCandidates(input.members, input.profiles),
  ).filter((mention) => !previous.has(mention) && mention !== editor);
}

/** Kind 40003 in the web timeline's edit shape: media/emoji tags survive the edit. */
export function forumEditTemplate(input: {
  channelId: string;
  target: NostrEvent;
  content: string;
  addedMentions: string[];
}): EventTemplate {
  const preserved = input.target.tags.filter((tag) => tag[0] === "imeta" || tag[0] === "emoji");
  return {
    kind: FORUM_EDIT_KIND,
    content: input.content,
    tags: [
      ["h", input.channelId],
      ["e", input.target.id],
      ...preserved,
      ...[...new Set(input.addedMentions)].map((pubkey) => ["p", pubkey]),
    ],
  };
}

/** Authors delete with kind 5; channel owners/admins remove others' events with kind 9005. */
export function forumDeleteTemplate(input: {
  channelId: string;
  targetId: string;
  asModerator: boolean;
}): EventTemplate {
  return {
    kind: input.asModerator ? FORUM_MODERATOR_DELETE_KIND : FORUM_DELETE_KIND,
    content: "",
    tags: [
      ["h", input.channelId],
      ["e", input.targetId],
    ],
  };
}

/**
 * Root and parent of a forum comment, following Desktop's `forum_reply_from_event`:
 * `root`/`reply` markers win; an unmarked `e` tag is the parent when no `reply` marker
 * exists. A lone `reply` marker means the parent is the root.
 */
export function forumReplyReference(event: NostrEvent): {
  rootId: string | null;
  parentId: string | null;
} {
  let root: string | null = null;
  let reply: string | null = null;
  let unmarked: string | null = null;
  for (const tag of event.tags) {
    if (tag[0] !== "e" || !tag[1]) continue;
    if (tag[3] === "root") root ??= tag[1];
    else if (tag[3] === "reply") reply ??= tag[1];
    else unmarked ??= tag[1];
  }
  const parentId = reply ?? unmarked ?? root;
  return { rootId: root ?? parentId, parentId };
}

/** Target event of an edit or deletion (its first `e` tag). */
export function referencedEventId(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "e" && Boolean(tag[1]))?.[1] ?? null;
}

/** Keyset cursor for the Relay's `created_at DESC, id ASC` order (`until` + `before_id`). */
export function nextPageCursor(
  page: readonly NostrEvent[],
): { until: number; beforeId: string } | null {
  let cursor: { until: number; beforeId: string } | null = null;
  for (const event of page) {
    if (
      !cursor ||
      event.created_at < cursor.until ||
      (event.created_at === cursor.until && event.id > cursor.beforeId)
    ) {
      cursor = { until: event.created_at, beforeId: event.id };
    }
  }
  return cursor;
}
