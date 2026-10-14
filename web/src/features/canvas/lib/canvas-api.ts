import {
  CANVAS_HISTORY_PAGE_SIZE,
  CANVAS_SUPERSEDED_MARKER,
  type CanvasHistoryCursor,
  type CanvasRevision,
  canvasAncestryFilter,
  canvasHeadFilter,
  canvasHistoryFilter,
  canvasRevisionFromEvent,
  canvasWriteCreatedAt,
  canvasWriteSurvived,
  canvasWriteTags,
  compareCanvasRevisions,
  KIND_CANVAS,
  nextHistoryCursor,
} from "@/features/canvas/lib/canvas-protocol";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

export type CanvasHistoryPage = {
  revisions: CanvasRevision[];
  nextCursor: CanvasHistoryCursor | null;
};

export type CanvasWriteResult = {
  revision: CanvasRevision;
  /** False when the post-write read failed: the write is durable but unconfirmed. */
  verified: boolean;
};

function revisionsFrom(events: readonly NostrEvent[], channelId: string): CanvasRevision[] {
  return events
    .map((event) => canvasRevisionFromEvent(event, channelId))
    .filter((revision): revision is CanvasRevision => revision !== null)
    .sort(compareCanvasRevisions);
}

/** The live head (strongly consistent), or null when the channel has no canvas. */
export async function fetchCanvasHead(
  client: BuzzRelayClient,
  channelId: string,
): Promise<CanvasRevision | null> {
  return revisionsFrom(await client.query(canvasHeadFilter(channelId)), channelId)[0] ?? null;
}

export async function fetchCanvasHistoryPage(
  client: BuzzRelayClient,
  channelId: string,
  cursor: CanvasHistoryCursor | null,
): Promise<CanvasHistoryPage> {
  const events = await client.query(
    canvasHistoryFilter(channelId, CANVAS_HISTORY_PAGE_SIZE, cursor),
  );
  const revisions = revisionsFrom(events, channelId);
  return { revisions, nextCursor: nextHistoryCursor(revisions, CANVAS_HISTORY_PAGE_SIZE) };
}

/**
 * Publish `content` as the new head, compare-and-swap against `base` (the
 * revision the editor or restore dialog loaded; null when there was none).
 * The Relay rejects a stale base with `conflict: …`; that rejection propagates
 * unchanged so callers keep the draft. An accepted write is re-read to detect
 * a concurrent head that superseded it.
 */
export async function publishCanvasRevision(
  client: BuzzRelayClient,
  channelId: string,
  content: string,
  base: Pick<CanvasRevision, "eventId" | "createdAt"> | null,
): Promise<CanvasWriteResult> {
  const createdAt = canvasWriteCreatedAt(base?.createdAt ?? null, Math.floor(Date.now() / 1_000));
  const { event } = await client.publish({
    kind: KIND_CANVAS,
    created_at: createdAt,
    content,
    tags: canvasWriteTags(channelId, base?.eventId ?? null),
  });
  const revision = canvasRevisionFromEvent(event, channelId);
  if (!revision) throw new Error("canvas write was signed with unexpected tags");

  let ancestry: CanvasRevision[];
  try {
    ancestry = revisionsFrom(await client.query(canvasAncestryFilter(channelId)), channelId);
  } catch {
    return { revision, verified: false };
  }
  if (!canvasWriteSurvived(revision.eventId, ancestry)) {
    throw new Error(CANVAS_SUPERSEDED_MARKER);
  }
  return { revision, verified: true };
}
