import { isRecord } from "@/features/agents/lib/guards";
import type { ArchivedFrame } from "@/features/agents/lib/observer-archive";
import {
  describeObserverFrame,
  frameUpdate,
  type ObserverFramePresentation,
} from "@/features/chat/lib/agent-activity";

const MAX_MESSAGE_CHARS = 20_000;

export type TurnStep = { id: string; at: number; presentation: ObserverFramePresentation };

export type ObservedTurn = {
  key: string;
  turnId: string | null;
  channelId: string;
  startedAt: number;
  lastAt: number;
  /** Agent-visible reply text assembled from agent_message_chunk updates. */
  reply: string;
  steps: TurnStep[];
  ended: boolean;
};

export type ObservedSession = {
  key: string;
  agentPubkey: string;
  sessionId: string | null;
  channelId: string;
  startedAt: number;
  lastAt: number;
  turns: ObservedTurn[];
};

function chunkText(frame: ArchivedFrame["frame"]): string {
  const update = frameUpdate(frame);
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  const content = update.content;
  if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
    return content.text;
  }
  return "";
}

function frameTime(frame: ArchivedFrame): number {
  const parsed = Date.parse(frame.frame.timestamp);
  return Number.isFinite(parsed) ? parsed : frame.receivedAt;
}

/**
 * Rebuild the session → turn timeline from archived frames, newest session first. Frames are
 * keyed by (agent, sessionId or channel) and turns by turnId; frames without a turn attach to the
 * session's current turn.
 */
export function buildObservedSessions(frames: readonly ArchivedFrame[]): ObservedSession[] {
  const ordered = [...frames].sort(
    (left, right) => frameTime(left) - frameTime(right) || left.frame.seq - right.frame.seq,
  );
  const sessions = new Map<string, ObservedSession>();
  for (const record of ordered) {
    const { frame } = record;
    const at = frameTime(record);
    const sessionKey = `${record.agentPubkey}|${frame.sessionId ?? `channel:${record.channelId}`}`;
    let session = sessions.get(sessionKey);
    if (!session) {
      session = {
        key: sessionKey,
        agentPubkey: record.agentPubkey,
        sessionId: frame.sessionId,
        channelId: record.channelId,
        startedAt: at,
        lastAt: at,
        turns: [],
      };
      sessions.set(sessionKey, session);
    }
    session.lastAt = Math.max(session.lastAt, at);
    const kind = frame.kind.toLowerCase();
    let turn = frame.turnId
      ? session.turns.find((candidate) => candidate.turnId === frame.turnId)
      : session.turns[session.turns.length - 1];
    const startsTurn = !frame.turnId && (kind === "turn_started" || turn?.ended === true);
    if (!turn || startsTurn) {
      turn = {
        key: `${sessionKey}|${frame.turnId ?? frame.seq}`,
        turnId: frame.turnId,
        channelId: record.channelId,
        startedAt: at,
        lastAt: at,
        reply: "",
        steps: [],
        ended: false,
      };
      session.turns.push(turn);
    }
    turn.lastAt = Math.max(turn.lastAt, at);
    if (["turn_completed", "turn_error", "agent_panic"].includes(kind)) turn.ended = true;
    const text = chunkText(frame);
    if (text) {
      if (turn.reply.length < MAX_MESSAGE_CHARS) {
        turn.reply = `${turn.reply}${text}`.slice(0, MAX_MESSAGE_CHARS);
      }
      continue;
    }
    turn.steps.push({ id: record.id, at, presentation: describeObserverFrame(frame) });
  }
  return [...sessions.values()].sort((left, right) => right.lastAt - left.lastAt);
}
