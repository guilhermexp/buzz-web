import { tagValue, tagValues, threadReference } from "@/features/chat/lib/chat-model";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

export const INBOX_EVENT_KINDS = [1, 9, 40002, 45001, 45003, 46010, 46011, 46012];

export type InboxCategory = "mention" | "dm" | "thread" | "needs_action";

/** Desktop-aligned Inbox groups, in display order. */
export const INBOX_GROUPS: readonly InboxCategory[] = ["needs_action", "mention", "thread", "dm"];

export type ApprovalResolution = "granted" | "denied" | "expired";

/** Workflow approval request (kind 46010, relay-signed) fields shown in the Inbox. */
export type ApprovalRequest = {
  reference: string;
  workflowId: string | null;
  runId: string | null;
  stepId: string | null;
  summary: string | null;
  approver: string | null;
  expiresAt: number | null;
  /** Outcome the Relay published (kind 46011/46012), if observed. */
  resolution: ApprovalResolution | null;
};

export type InboxItem = {
  id: string;
  event: NostrEvent;
  category: InboxCategory;
  channelId: string | null;
  threadRootId: string | null;
  unread: boolean;
  approval: ApprovalRequest | null;
};

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

export function parseApprovalRequest(
  event: NostrEvent,
  resolution: ApprovalResolution | null,
): ApprovalRequest | null {
  const reference = tagValue(event, "d");
  if (event.kind !== 46010 || !reference || !/^[0-9a-f]{64}$/i.test(reference)) return null;
  let content: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      content = parsed as Record<string, unknown>;
    }
  } catch {
    // Unstructured content keeps the reference only.
  }
  const expires = content.expires_at;
  return {
    reference: reference.toLowerCase(),
    workflowId: stringField(content, "workflow_id"),
    runId: stringField(content, "run_id"),
    stepId: stringField(content, "step_id"),
    summary: stringField(content, "summary"),
    approver: stringField(content, "approver"),
    expiresAt: typeof expires === "number" && Number.isFinite(expires) ? expires : null,
    resolution,
  };
}

function approvalResolutions(events: Iterable<NostrEvent>): Map<string, ApprovalResolution> {
  const resolutions = new Map<string, ApprovalResolution>();
  for (const event of events) {
    if (event.kind !== 46011 && event.kind !== 46012) continue;
    const reference = tagValue(event, "d")?.toLowerCase();
    if (!reference) continue;
    resolutions.set(
      reference,
      event.kind === 46011
        ? "granted"
        : tagValue(event, "status") === "expired"
          ? "expired"
          : "denied",
    );
  }
  return resolutions;
}

function replyEventId(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")?.[1] ?? null;
}

function explicitThreadRootId(event: NostrEvent): string | null {
  return event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ?? null;
}

/** Resolve nested replies to their top-level root, including legacy reply-only events. */
export function threadRootIds(events: readonly NostrEvent[]): ReadonlyMap<string, string> {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const roots = new Map<string, string>();
  const unresolved = new Set<string>();

  const resolve = (event: NostrEvent, visiting: Set<string>): string | null => {
    const cached = roots.get(event.id);
    if (cached) return cached;
    if (unresolved.has(event.id) || visiting.has(event.id)) return null;

    const explicitRoot = explicitThreadRootId(event);
    if (explicitRoot) {
      roots.set(event.id, explicitRoot);
      return explicitRoot;
    }

    const parentId = replyEventId(event);
    if (!parentId) {
      unresolved.add(event.id);
      return null;
    }

    const parent = eventsById.get(parentId);
    const nextVisiting = new Set(visiting).add(event.id);
    const rootId = parent ? (resolve(parent, nextVisiting) ?? parentId) : parentId;
    roots.set(event.id, rootId);
    return rootId;
  };

  for (const event of events) resolve(event, new Set());
  return roots;
}

/** Threads the current identity authored, joined, or was mentioned in. */
export function threadNotificationRootIds(
  events: readonly NostrEvent[],
  currentPubkey: string,
  rootsByEvent: ReadonlyMap<string, string> = threadRootIds(events),
): ReadonlySet<string> {
  const current = currentPubkey.toLowerCase();
  const roots = new Set<string>();
  for (const event of events) {
    const rootId = rootsByEvent.get(event.id);
    if (event.pubkey.toLowerCase() === current) {
      roots.add(rootId ?? event.id);
    }
    if (rootId && tagValues(event, "p").some((pubkey) => pubkey.toLowerCase() === current)) {
      roots.add(rootId);
    }
  }
  return roots;
}

export function inboxPreview(event: NostrEvent): string {
  const content = event.content.trim();
  if (!content.startsWith("{")) return content;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const preview = value.message ?? value.summary ?? value.title ?? value.text ?? value.action;
    return typeof preview === "string" ? preview : content;
  } catch {
    return content;
  }
}

export function buildInboxItems({
  events,
  channels,
  currentPubkey,
  readIds,
  keepApprovalIds = new Set(),
}: {
  events: readonly NostrEvent[];
  channels: readonly BuzzChannel[];
  currentPubkey: string;
  readIds: ReadonlySet<string>;
  /** Approvals this session decided stay visible after resolution to show the outcome. */
  keepApprovalIds?: ReadonlySet<string>;
}): InboxItem[] {
  const current = currentPubkey.toLowerCase();
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const authoredIds = new Set(
    events.filter((event) => event.pubkey.toLowerCase() === current).map((event) => event.id),
  );
  const unique = new Map(events.map((event) => [event.id, event]));
  const rootsByEvent = threadRootIds([...unique.values()]);
  const notificationRoots = threadNotificationRootIds([...unique.values()], current, rootsByEvent);
  const resolutions = approvalResolutions(unique.values());

  return [...unique.values()]
    .filter(
      (event) =>
        INBOX_EVENT_KINDS.includes(event.kind) &&
        event.pubkey.toLowerCase() !== current &&
        !(
          event.kind === 46010 &&
          resolutions.has(tagValue(event, "d")?.toLowerCase() ?? "") &&
          !keepApprovalIds.has(event.id)
        ),
    )
    .map((event): InboxItem | null => {
      const channelId = tagValue(event, "h");
      const channel = channelId ? channelsById.get(channelId) : undefined;
      const refs = threadReference(event);
      const threadRootId = rootsByEvent.get(event.id) ?? null;
      const referencedOwnMessage = event.tags
        .filter((tag) => tag[0] === "e")
        .some((tag) => authoredIds.has(tag[1] ?? ""));
      const mentioned = tagValues(event, "p").some((value) => value.toLowerCase() === current);
      let category: InboxCategory | null = null;
      if (event.kind === 46010) category = "needs_action";
      else if (channel?.type === "dm") category = "dm";
      else if (
        refs.parentId &&
        (referencedOwnMessage || (threadRootId ? notificationRoots.has(threadRootId) : false))
      ) {
        category = "thread";
      } else if (mentioned) category = "mention";
      if (!category) return null;
      return {
        id: event.id,
        event,
        category,
        channelId,
        threadRootId,
        unread: !readIds.has(event.id),
        approval:
          event.kind === 46010
            ? parseApprovalRequest(
                event,
                resolutions.get(tagValue(event, "d")?.toLowerCase() ?? "") ?? null,
              )
            : null,
      };
    })
    .filter((item): item is InboxItem => item !== null)
    .sort((left, right) => right.event.created_at - left.event.created_at);
}
