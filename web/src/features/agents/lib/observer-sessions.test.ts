import { describe, expect, it } from "vitest";
import type { ArchivedFrame } from "@/features/agents/lib/observer-archive";
import { buildObservedSessions } from "@/features/agents/lib/observer-sessions";

const AGENT = "a".repeat(64);

function frame(
  seq: number,
  kind: string,
  options: { session?: string; turn?: string | null; payload?: unknown } = {},
): ArchivedFrame {
  return {
    id: `scope|${AGENT}|${seq}`,
    scope: "scope",
    agentPubkey: AGENT,
    channelId: "channel",
    receivedAt: 1_000 + seq,
    frame: {
      seq,
      timestamp: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
      kind,
      channelId: "channel",
      sessionId: options.session ?? "s1",
      turnId: options.turn === undefined ? "t1" : options.turn,
      payload: options.payload ?? null,
    },
  };
}

const chunk = (text: string) => ({
  method: "session/update",
  params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
});

describe("buildObservedSessions", () => {
  it("groups frames into sessions and turns and assembles reply text in order", () => {
    const sessions = buildObservedSessions([
      frame(3, "acp_read", { payload: chunk("world") }),
      frame(1, "turn_started"),
      frame(2, "acp_read", { payload: chunk("hello ") }),
      frame(4, "turn_completed"),
      frame(5, "turn_started", { turn: "t2" }),
      frame(6, "turn_started", { session: "s2", turn: "t9" }),
    ]);
    expect(sessions.map((session) => session.sessionId)).toEqual(["s2", "s1"]);
    const s1 = sessions[1];
    expect(s1?.turns.map((turn) => turn.turnId)).toEqual(["t1", "t2"]);
    expect(s1?.turns[0]).toMatchObject({ reply: "hello world", ended: true });
    expect(s1?.turns[1]?.ended).toBe(false);
  });

  it("starts a new turn for uncorrelated frames after the previous turn ended", () => {
    const sessions = buildObservedSessions([
      frame(1, "turn_started", { turn: null }),
      frame(2, "turn_completed", { turn: null }),
      frame(3, "acp_read", { turn: null, payload: chunk("again") }),
    ]);
    expect(sessions[0]?.turns.map((turn) => turn.reply)).toEqual(["", "again"]);
  });
});
