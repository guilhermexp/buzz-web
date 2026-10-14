import type { NostrEvent, NostrFilter } from "@/shared/api/nostr-types";

/** Channel canvas: a versioned Markdown document, one kind-40100 event per revision. */
export const KIND_CANVAS = 40100;

/** `expected-revision` value asserting that the channel has no canvas yet. */
export const CANVAS_EXPECTED_REVISION_NONE = "none";

/**
 * A head timestamped further than this ahead of the local clock is treated as
 * a poisoned timeline: stamping `head + 1` would carry every later write past
 * the Relay's 300 s canvas ceiling. Matches the Buzz SDK constant.
 */
export const CANVAS_MAX_FUTURE_SKEW_SECS = 60;

export const CANVAS_HISTORY_PAGE_SIZE = 20;

/** Revisions read back after a save to confirm it is (or underlies) the head. */
export const CANVAS_ANCESTRY_WALK_LIMIT = 32;

export type CanvasRevision = {
  eventId: string;
  content: string;
  createdAt: number;
  author: string;
  /** The revision this one was written against (`none` for a first write), if asserted. */
  expectedRevision: string | null;
};

export type CanvasHistoryCursor = { createdAt: number; eventId: string };

/**
 * Relay filter extensions: `consistency: "strong"` pins write-gating reads to
 * the writer database; `before_id` pairs with `until` as a composite cursor
 * over the Relay order `created_at DESC, id ASC`.
 */
type CanvasRelayFilter = NostrFilter & { consistency?: "strong"; before_id?: string };

const EVENT_ID = /^[0-9a-f]{64}$/;

/** A revision for `channelId`, or null when the event is not one of its canvas writes. */
export function canvasRevisionFromEvent(
  event: NostrEvent,
  channelId: string,
): CanvasRevision | null {
  if (event.kind !== KIND_CANVAS) return null;
  let channel: string | undefined;
  let expectedRevision: string | undefined;
  for (const [name, value] of event.tags) {
    if (name === "h") channel ??= value;
    else if (name === "expected-revision") expectedRevision ??= value;
  }
  if (channel !== channelId) return null;
  return {
    eventId: event.id,
    content: event.content,
    createdAt: event.created_at,
    author: event.pubkey.toLowerCase(),
    expectedRevision: expectedRevision ?? null,
  };
}

/** Sort comparator in Relay head order: newest first, ties by ascending id. */
export function compareCanvasRevisions(left: CanvasRevision, right: CanvasRevision): number {
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
}

/** Whether `candidate` would replace `current` as the head under Relay order. */
export function supersedesHead(candidate: CanvasRevision, current: CanvasRevision | null): boolean {
  if (!current) return true;
  return compareCanvasRevisions(candidate, current) < 0;
}

export class CanvasTimelineError extends Error {
  constructor() {
    super("canvas head is timestamped too far in the future");
    this.name = "CanvasTimelineError";
  }
}

/**
 * Writer discipline: `created_at = max(now, base + 1)` so the write sorts
 * strictly ahead of the head it was edited against. A first write (no base)
 * uses `now`.
 */
export function canvasWriteCreatedAt(baseCreatedAt: number | null, now: number): number {
  if (baseCreatedAt === null) return now;
  if (baseCreatedAt > now + CANVAS_MAX_FUTURE_SKEW_SECS) throw new CanvasTimelineError();
  return Math.max(now, baseCreatedAt + 1);
}

/** Tags for a compare-and-swap write against `baseRevisionId` (null: no canvas yet). */
export function canvasWriteTags(channelId: string, baseRevisionId: string | null): string[][] {
  return [
    ["h", channelId],
    ["expected-revision", baseRevisionId ?? CANVAS_EXPECTED_REVISION_NONE],
  ];
}

/** The current head; `strong` because conflict recovery bases the next write on it. */
export function canvasHeadFilter(channelId: string): NostrFilter {
  const filter: CanvasRelayFilter = {
    kinds: [KIND_CANVAS],
    "#h": [channelId],
    limit: 1,
    consistency: "strong",
  };
  return filter;
}

/** Live head stream: the current head, then every later revision. */
export function canvasLiveFilter(channelId: string): NostrFilter {
  return { kinds: [KIND_CANVAS], "#h": [channelId], limit: 1 };
}

/** Post-write verification read; must observe the caller's own accepted write. */
export function canvasAncestryFilter(channelId: string): NostrFilter {
  const filter: CanvasRelayFilter = {
    kinds: [KIND_CANVAS],
    "#h": [channelId],
    limit: CANVAS_ANCESTRY_WALK_LIMIT,
    consistency: "strong",
  };
  return filter;
}

/** One history page; the Relay requires `until` whenever `before_id` is present. */
export function canvasHistoryFilter(
  channelId: string,
  pageSize: number,
  cursor: CanvasHistoryCursor | null,
): NostrFilter {
  const filter: CanvasRelayFilter = { kinds: [KIND_CANVAS], "#h": [channelId], limit: pageSize };
  if (cursor) {
    if (!EVENT_ID.test(cursor.eventId)) throw new Error("invalid canvas history cursor");
    filter.until = cursor.createdAt;
    filter.before_id = cursor.eventId;
  }
  return filter;
}

/** A full page may hide older revisions; a short page is the tail. */
export function nextHistoryCursor(
  page: readonly CanvasRevision[],
  pageSize: number,
): CanvasHistoryCursor | null {
  if (page.length < pageSize) return null;
  const last = page[page.length - 1];
  return last ? { createdAt: last.createdAt, eventId: last.eventId } : null;
}

/** Merge pages and live heads into one de-duplicated list in Relay order. */
export function mergeRevisions(
  current: readonly CanvasRevision[],
  incoming: readonly CanvasRevision[],
): CanvasRevision[] {
  const byId = new Map(current.map((revision) => [revision.eventId, revision]));
  for (const revision of incoming) byId.set(revision.eventId, revision);
  return [...byId.values()].sort(compareCanvasRevisions);
}

/**
 * Whether our accepted write is the head or in the head's `expected-revision`
 * ancestry. Every other outcome (stranger head, broken chain, cycle, depth
 * exhausted, no head) reports superseded: the write is in history, not lost.
 */
export function canvasWriteSurvived(
  ourId: string,
  revisions: readonly Pick<CanvasRevision, "eventId" | "expectedRevision">[],
): boolean {
  const head = revisions[0];
  if (!head) return false;
  const ours = ourId.toLowerCase();
  const parents = new Map(
    revisions.map((revision) => [
      revision.eventId.toLowerCase(),
      revision.expectedRevision?.toLowerCase() ?? null,
    ]),
  );
  const seen = new Set<string>();
  let cursor: string | null = head.eventId.toLowerCase();
  while (cursor !== null) {
    if (cursor === ours) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

export const CANVAS_SUPERSEDED_MARKER =
  "conflict: canvas save was superseded by a concurrent write";

/** How a canvas write failed, for recovery UI; null for errors without a canvas meaning. */
export type CanvasWriteFailure =
  | "changed"
  | "missing"
  | "stale"
  | "superseded"
  | "forbidden"
  | "archived"
  | "timeline";

export function classifyCanvasError(error: unknown): CanvasWriteFailure | null {
  if (error instanceof CanvasTimelineError) return "timeline";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes(CANVAS_SUPERSEDED_MARKER)) return "superseded";
  if (message.includes("conflict: canvas changed since it was loaded")) return "changed";
  if (message.includes("conflict: canvas revision does not exist")) return "missing";
  if (message.includes("conflict: canvas write does not supersede the current head")) {
    return "stale";
  }
  if (/channel is archived/i.test(message)) return "archived";
  if (/^restricted:/i.test(message) || /not a channel member/i.test(message)) return "forbidden";
  return null;
}

/** Pre-write CAS rejections: the draft was not published and must be kept. */
export function isCanvasConflict(failure: CanvasWriteFailure | null): boolean {
  return failure === "changed" || failure === "missing" || failure === "stale";
}
