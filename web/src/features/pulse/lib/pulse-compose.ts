import { buildMessageTags, contentWithAttachments } from "@/features/chat/lib/chat-model";
import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";
import {
  extractMentionPubkeys,
  type MentionBindings,
  type MentionMemberCandidate,
  pruneMentionBindings,
} from "@/features/composer/lib/mention-bindings";

/** A draft resolved into what the Relay receives. */
export type ComposedNote = { content: string; mentions: string[]; mediaTags: string[][] };

/**
 * Final note body and tags for a draft, built with the chat send path's own
 * conventions: media lines appended via `contentWithAttachments`, `imeta`
 * exactly as `buildMessageTags` emits them (minus the channel `h`, which a
 * global kind 1 note must not carry), and `@Label` mentions resolved by the
 * shared picker-binding rules (throws `AmbiguousMentionError`).
 */
export function composeNote(
  markdown: string,
  attachments: readonly AttachmentDescriptor[],
  bindings: MentionBindings,
  candidates: readonly MentionMemberCandidate[],
): ComposedNote {
  const text = markdown.trim();
  const mentions = extractMentionPubkeys(text, pruneMentionBindings(text, bindings), candidates);
  return {
    content: contentWithAttachments(text, [...attachments]),
    mentions,
    mediaTags: buildMessageTags("", [], [...attachments]).filter((tag) => tag[0] === "imeta"),
  };
}
