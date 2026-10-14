import { threadReference } from "@/features/chat/lib/chat-model";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { ExportChannelSummary } from "./content-export-archive";
import { deletedEventIds } from "./content-export-model";

const CONTENT_KINDS: ReadonlySet<number> = new Set([9, 40002, 40008, 40099, 45001, 45003]);

export type TranscriptLabels = {
  channelId: string;
  edited: string;
  deleted: string;
  reactions: string;
  canvas: string;
  empty: string;
  /** Human text for a kind:40099 system row, or null when unknown. */
  describeSystem: (event: NostrEvent) => string | null;
  nameOf: (pubkey: string) => string;
};

function firstReference(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "e")?.[1] ?? null;
}

function quote(text: string, depth: number): string {
  if (depth === 0) return text;
  const prefix = "> ";
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join("\n");
}

/**
 * Readable transcript: author names, ISO timestamps, latest edits applied, thread replies
 * quoted under their root, deleted messages noted without their content.
 * `events` must be the raw (unscoped) channel events so deletions can still be noted.
 */
export function renderChannelTranscript(
  channel: ExportChannelSummary,
  events: readonly NostrEvent[],
  canvasHead: NostrEvent | null,
  labels: TranscriptLabels,
): string {
  const deleted = deletedEventIds(events);
  const authors = new Map(events.map((event) => [event.id, event.pubkey]));
  const edits = new Map<string, NostrEvent>();
  const reactions = new Map<string, Map<string, number>>();
  for (const event of events) {
    const target = firstReference(event);
    if (!target || deleted.has(event.id)) continue;
    if (event.kind === 40003) {
      const author = authors.get(target);
      const current = edits.get(target);
      if (author === event.pubkey && (!current || current.created_at <= event.created_at)) {
        edits.set(target, event);
      }
    } else if (event.kind === 7) {
      const counts = reactions.get(target) ?? new Map<string, number>();
      const emoji = event.content.trim() || "+";
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
      reactions.set(target, counts);
    }
  }

  const messages = events
    .filter((event) => CONTENT_KINDS.has(event.kind))
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id));
  const ids = new Set(messages.map((event) => event.id));
  const replies = new Map<string, NostrEvent[]>();
  const roots: NostrEvent[] = [];
  for (const event of messages) {
    const { rootId } = threadReference(event);
    if (rootId && rootId !== event.id && ids.has(rootId)) {
      replies.set(rootId, [...(replies.get(rootId) ?? []), event]);
    } else {
      roots.push(event);
    }
  }

  const renderMessage = (event: NostrEvent, depth: number): string => {
    const time = new Date(event.created_at * 1000).toISOString();
    const header = `**${labels.nameOf(event.pubkey)}** · ${time}`;
    let body: string;
    if (deleted.has(event.id)) {
      body = `_${labels.deleted}_`;
    } else if (event.kind === 40099) {
      body = `_${labels.describeSystem(event) ?? event.content}_`;
    } else {
      const edit = edits.get(event.id);
      body = edit ? `${edit.content}\n\n_${labels.edited}_` : event.content;
    }
    const counts = deleted.has(event.id) ? undefined : reactions.get(event.id);
    const reactionLine = counts?.size
      ? `\n\n${labels.reactions}: ${[...counts].map(([emoji, count]) => `${emoji} ${count}`).join(", ")}`
      : "";
    return quote(`${header}\n\n${body}${reactionLine}`, depth);
  };

  const blocks: string[] = [`# ${channel.name}`, `${labels.channelId}: \`${channel.id}\``];
  if (!roots.length) blocks.push(`_${labels.empty}_`);
  for (const root of roots) {
    blocks.push(renderMessage(root, 0));
    for (const reply of replies.get(root.id) ?? []) blocks.push(renderMessage(reply, 1));
  }
  if (canvasHead) {
    blocks.push(`## ${labels.canvas}`, canvasHead.content);
  }
  return `${blocks.join("\n\n")}\n`;
}
