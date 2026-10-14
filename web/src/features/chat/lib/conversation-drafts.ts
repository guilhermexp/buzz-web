import type { AttachmentDescriptor } from "@/features/chat/lib/chat-types";

export type ConversationDraft = {
  /** Desktop-compatible Markdown produced by the rich composer. */
  content: string;
  attachments: AttachmentDescriptor[];
  /** Picker bindings `[label, pubkey]` so restored mentions keep their exact recipient. */
  mentions?: [string, string][];
};

type StoredConversationDraft = ConversationDraft & {
  version: 1;
  updatedAt: number;
};

export function conversationDraftKey(
  relayUrl: string,
  pubkey: string,
  channelId: string,
  threadRootId?: string | null,
): string {
  const scope = threadRootId ? `thread:${threadRootId}` : "channel";
  return [
    "buzz:web:draft:v1",
    encodeURIComponent(relayUrl),
    pubkey.toLowerCase(),
    channelId,
    scope,
  ].join(":");
}

function validAttachment(value: unknown): value is AttachmentDescriptor {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.url === "string" &&
    typeof attachment.sha256 === "string" &&
    typeof attachment.size === "number" &&
    typeof attachment.type === "string" &&
    typeof attachment.uploaded === "number"
  );
}

function validMentionBinding(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    /^[0-9a-f]{64}$/.test(value[1])
  );
}

export function readConversationDraft(key: string): ConversationDraft {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return { content: "", attachments: [] };
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || typeof value.content !== "string") {
      return { content: "", attachments: [] };
    }
    const mentions = Array.isArray(value.mentions)
      ? value.mentions.filter(validMentionBinding).slice(0, 200)
      : [];
    return {
      content: value.content,
      attachments: Array.isArray(value.attachments)
        ? value.attachments.filter(validAttachment).slice(0, 8)
        : [],
      ...(mentions.length ? { mentions } : {}),
    };
  } catch {
    return { content: "", attachments: [] };
  }
}

export function writeConversationDraft(key: string, draft: ConversationDraft): void {
  try {
    if (!draft.content.trim() && draft.attachments.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    const value: StoredConversationDraft = {
      version: 1,
      content: draft.content,
      attachments: draft.attachments,
      mentions: draft.mentions?.length ? draft.mentions : undefined,
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory draft remains usable.
  }
}

export function clearConversationDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}
