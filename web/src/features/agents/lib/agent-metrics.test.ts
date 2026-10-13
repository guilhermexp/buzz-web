import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTurnMetrics,
  summarizeUsage,
  type TurnMetric,
  turnUsage,
} from "@/features/agents/lib/agent-metrics";
import type { NostrEvent } from "@/shared/api/nostr-types";
import {
  activateLocalSigner,
  clearActiveSigner,
  decryptNip44FromPeer,
} from "@/shared/lib/nostr-signer";

const ownerSecret = generateSecretKey();
const owner = getPublicKey(ownerSecret);
const agentSecret = generateSecretKey();
const agent = getPublicKey(agentSecret);

function metricEvent(
  payload: unknown,
  options: { to?: string; agentTag?: string } = {},
): NostrEvent {
  const recipient = options.to ?? owner;
  return finalizeEvent(
    {
      kind: 44200,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", recipient],
        ["agent", options.agentTag ?? agent],
      ],
      content: encrypt(JSON.stringify(payload), getConversationKey(agentSecret, recipient)),
    },
    agentSecret,
  ) as NostrEvent;
}

function payload(turnSeq: number, cumulative: Record<string, number | null>, extra = {}) {
  return {
    harness: "buzz-agent",
    model: "m",
    channelId: "c",
    sessionId: "s1",
    turnId: `t${turnSeq}`,
    turnSeq,
    timestamp: new Date().toISOString(),
    turn: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.5 },
    cumulative,
    ...extra,
  };
}

afterEach(() => clearActiveSigner());

describe("readTurnMetrics", () => {
  it("decrypts the owner's metrics and drops misaddressed or forged envelopes", async () => {
    activateLocalSigner(ownerSecret);
    const good = metricEvent(
      payload(1, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 }),
    );
    const someoneElse = metricEvent(
      payload(2, { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 }),
      {
        to: getPublicKey(generateSecretKey()),
      },
    );
    const wrongAgentTag = metricEvent(payload(3, {}), {
      agentTag: getPublicKey(generateSecretKey()),
    });
    const tampered = { ...good, id: "f".repeat(64), content: good.content.replace(/.$/, "A") };

    const metrics = await readTurnMetrics(
      [good, good, someoneElse, wrongAgentTag, tampered],
      owner,
      decryptNip44FromPeer,
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ agentPubkey: agent, sessionId: "s1", turnSeq: 1 });
  });

  it("gives an unrelated identity nothing, even when it holds the owner's events", async () => {
    const events = [
      metricEvent(payload(1, { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 })),
    ];
    const strangerSecret = generateSecretKey();
    activateLocalSigner(strangerSecret);
    // Addressed to the real owner: the stranger's envelope check rejects before decrypting.
    expect(
      await readTurnMetrics(events, getPublicKey(strangerSecret), decryptNip44FromPeer),
    ).toEqual([]);
    // Even bypassing the envelope check, the stranger's conversation key cannot decrypt.
    await expect(decryptNip44FromPeer(agent, events[0]?.content ?? "")).rejects.toThrow();
  });

  it("rejects payloads that violate NIP-AM numeric and required-field rules", async () => {
    activateLocalSigner(ownerSecret);
    const events = [
      metricEvent({ ...payload(1, {}), harness: "" }),
      metricEvent(payload(2, { inputTokens: -1, outputTokens: 0, totalTokens: 0, costUsd: 0 })),
      metricEvent({
        ...payload(3, { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 }),
        turnSeq: null,
      }),
      metricEvent({ ...payload(4, {}), timestamp: "yesterday" }),
    ];
    expect(await readTurnMetrics(events, owner, decryptNip44FromPeer)).toEqual([]);
  });
});

function metric(
  id: string,
  turnSeq: number,
  cumulative: TurnMetric["cumulative"],
  reliable = true,
): TurnMetric {
  return {
    eventId: id,
    agentPubkey: agent,
    harness: "h",
    model: null,
    channelId: null,
    sessionId: "s",
    turnSeq,
    timestamp: new Date(2026, 9, 10, 12).toISOString(),
    turn: { inputTokens: 100, outputTokens: 100, totalTokens: 200, costUsd: 9 },
    cumulative,
    deltaReliable: reliable,
    stopReason: "end_turn",
  };
}

const counters = (tokens: number, cost: number | null) => ({
  inputTokens: tokens,
  outputTokens: tokens,
  totalTokens: tokens * 2,
  costUsd: cost,
});

describe("turn usage accounting", () => {
  it("recomputes deltas from cumulative snapshots and treats counter resets as unknown", () => {
    const usage = turnUsage([
      metric("b", 2, counters(30, 0.3)),
      metric("a", 1, counters(10, 0.1)),
      metric("c", 3, counters(5, 0.05)),
    ]);
    // First observed turn falls back to the reliable `turn` object.
    expect(usage.get("a")).toMatchObject({ inputTokens: 100, costUsd: 9 });
    expect(usage.get("b")?.inputTokens).toBe(20);
    expect(usage.get("b")?.costUsd).toBeCloseTo(0.2);
    // Decreasing cumulative → unknown, never negative.
    expect(usage.get("c")).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
  });

  it("never sums unknown cost as zero and keeps an unreliable first delta unknown", () => {
    const { totals, daily } = summarizeUsage(
      [metric("a", 1, counters(10, null), false), metric("b", 2, counters(20, null))],
      3,
      new Date(2026, 9, 10, 18),
    );
    expect(totals.turns).toBe(2);
    expect(totals.inputTokens).toBe(10);
    expect(totals.costUsd).toBe(0);
    expect(totals.unknownCostTurns).toBe(2);
    expect(daily.map((day) => day.day)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(daily[2]?.turns).toBe(2);
  });
});
