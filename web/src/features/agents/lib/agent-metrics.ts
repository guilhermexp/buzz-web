import { verifyEvent } from "nostr-tools/pure";
import { HEX_PUBKEY, isRecord } from "@/features/agents/lib/guards";
import type { NostrEvent } from "@/shared/api/nostr-types";

export const AGENT_TURN_METRIC_KIND = 44200;
const MAX_PLAINTEXT_BYTES = 65_535;

export type UsageCounters = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
};

export type TurnMetric = {
  eventId: string;
  agentPubkey: string;
  harness: string;
  model: string | null;
  channelId: string | null;
  sessionId: string | null;
  turnSeq: number | null;
  timestamp: string;
  turn: UsageCounters | null;
  cumulative: UsageCounters | null;
  deltaReliable: boolean;
  stopReason: "end_turn" | "max_tokens" | "cancelled" | "error" | "unknown" | null;
};

export type UsageTotals = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Turns whose cost is unknown (null, unreliable delta or counter reset); never summed as zero. */
  unknownCostTurns: number;
};

export type DailyUsage = UsageTotals & { day: string };

const STOP_REASONS = ["end_turn", "max_tokens", "cancelled", "error", "unknown"] as const;
const COUNTER_KEYS = ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const;

/** Envelope check before decryption (NIP-AM): signed by the agent, addressed to exactly this owner. */
export function validateMetricEnvelope(event: NostrEvent, ownerPubkey: string): string | null {
  if (event.kind !== AGENT_TURN_METRIC_KIND) return null;
  const owner = ownerPubkey.toLowerCase();
  const recipients = event.tags.filter((tag) => tag[0] === "p");
  const agents = event.tags.filter((tag) => tag[0] === "agent");
  const agent = event.pubkey.toLowerCase();
  if (recipients.length !== 1 || recipients[0]?.[1]?.toLowerCase() !== owner) return null;
  if (agents.length !== 1 || agents[0]?.[1]?.toLowerCase() !== agent) return null;
  if (event.tags.some((tag) => tag[0] === "h") || !HEX_PUBKEY.test(agent)) return null;
  try {
    return verifyEvent(event) ? agent : null;
  } catch {
    return null;
  }
}

function counters(value: unknown): UsageCounters | null {
  if (!isRecord(value)) return null;
  const result: UsageCounters = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
  for (const key of COUNTER_KEYS) {
    const raw = value[key];
    if (raw === null || raw === undefined) continue;
    const valid =
      typeof raw === "number" &&
      Number.isFinite(raw) &&
      raw >= 0 &&
      (key === "costUsd" || Number.isSafeInteger(raw));
    if (!valid) return null;
    result[key] = raw;
  }
  return result;
}

/** Parse decrypted NIP-AM content; invalid payloads are ignored rather than partially trusted. */
export function parseTurnMetric(
  plaintext: string,
  eventId: string,
  agentPubkey: string,
): TurnMetric | null {
  if (new TextEncoder().encode(plaintext).length > MAX_PLAINTEXT_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { harness, timestamp } = value;
  if (typeof harness !== "string" || !harness.trim()) return null;
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) return null;
  const turn = value.turn === undefined || value.turn === null ? null : counters(value.turn);
  const cumulative =
    value.cumulative === undefined || value.cumulative === null ? null : counters(value.cumulative);
  if ((value.turn != null && !turn) || (value.cumulative != null && !cumulative)) return null;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : null;
  const turnSeq =
    typeof value.turnSeq === "number" && Number.isSafeInteger(value.turnSeq) ? value.turnSeq : null;
  if (cumulative && (sessionId === null || turnSeq === null)) return null;
  const stopReason =
    typeof value.stopReason === "string"
      ? (STOP_REASONS.find((reason) => reason === value.stopReason) ?? "unknown")
      : null;
  return {
    eventId,
    agentPubkey,
    harness,
    model: typeof value.model === "string" ? value.model : null,
    channelId: typeof value.channelId === "string" ? value.channelId : null,
    sessionId,
    turnSeq,
    timestamp,
    turn,
    cumulative,
    deltaReliable: value.deltaReliable !== false,
    stopReason,
  };
}

function emptyTotals(): UsageTotals {
  return {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unknownCostTurns: 0,
  };
}

/**
 * Owner pipeline: dedupe by id, check the envelope before decrypting, decrypt from the agent,
 * parse. Events addressed to another owner or that fail to decrypt are silently dropped.
 */
export async function readTurnMetrics(
  events: readonly NostrEvent[],
  ownerPubkey: string,
  decryptFromPeer: (peerPubkey: string, ciphertext: string) => Promise<string>,
): Promise<TurnMetric[]> {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const metrics = await Promise.all(
    unique.map(async (event) => {
      const agent = validateMetricEnvelope(event, ownerPubkey);
      if (!agent) return null;
      try {
        return parseTurnMetric(await decryptFromPeer(agent, event.content), event.id, agent);
      } catch {
        return null;
      }
    }),
  );
  return metrics.filter((metric): metric is TurnMetric => metric !== null);
}

/**
 * Per-turn usage. Within one session, consecutive cumulative snapshots ordered by turnSeq are
 * authoritative; a decreasing counter yields unknown (null), never negative usage. The first
 * observed turn of a session falls back to `turn` only when the publisher marked it reliable.
 */
export function turnUsage(metrics: readonly TurnMetric[]): Map<string, UsageCounters> {
  const usage = new Map<string, UsageCounters>();
  const unique = [...new Map(metrics.map((metric) => [metric.eventId, metric])).values()];
  const sessions = new Map<string, TurnMetric[]>();
  for (const metric of unique) {
    if (!metric.cumulative || metric.sessionId === null || metric.turnSeq === null) {
      usage.set(metric.eventId, metric.deltaReliable && metric.turn ? metric.turn : nullCounters());
      continue;
    }
    const key = `${metric.agentPubkey}|${metric.sessionId}`;
    sessions.set(key, [...(sessions.get(key) ?? []), metric]);
  }
  for (const series of sessions.values()) {
    series.sort((left, right) => (left.turnSeq ?? 0) - (right.turnSeq ?? 0));
    let previous: TurnMetric | null = null;
    for (const metric of series) {
      if (previous?.turnSeq === metric.turnSeq) continue;
      if (!previous?.cumulative || !metric.cumulative) {
        usage.set(
          metric.eventId,
          metric.deltaReliable && metric.turn ? metric.turn : nullCounters(),
        );
      } else {
        const delta = nullCounters();
        for (const key of COUNTER_KEYS) {
          const current = metric.cumulative[key];
          const before = previous.cumulative[key];
          if (current !== null && before !== null && current >= before) {
            delta[key] = current - before;
          }
        }
        usage.set(metric.eventId, delta);
      }
      previous = metric;
    }
  }
  return usage;
}

function nullCounters(): UsageCounters {
  return { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null };
}

function addUsage(target: UsageTotals, usage: UsageCounters): void {
  target.turns += 1;
  target.inputTokens += usage.inputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? 0;
  if (usage.costUsd === null) target.unknownCostTurns += 1;
  else target.costUsd += usage.costUsd;
}

function localDay(timestamp: string): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Totals plus a contiguous local-day series ending today (empty days included as zero turns). */
export function summarizeUsage(
  metrics: readonly TurnMetric[],
  days: number,
  now = new Date(),
): { totals: UsageTotals; daily: DailyUsage[] } {
  const usage = turnUsage(metrics);
  const totals = emptyTotals();
  const byDay = new Map<string, UsageTotals>();
  for (const metric of metrics) {
    const counters = usage.get(metric.eventId);
    if (!counters) continue;
    usage.delete(metric.eventId);
    addUsage(totals, counters);
    const day = localDay(metric.timestamp);
    const bucket = byDay.get(day) ?? emptyTotals();
    addUsage(bucket, counters);
    byDay.set(day, bucket);
  }
  const daily: DailyUsage[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12);
    const day = localDay(date.toISOString());
    daily.push({ day, ...(byDay.get(day) ?? emptyTotals()) });
  }
  return { totals, daily };
}
