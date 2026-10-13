/**
 * Client view of workflow execution: durable run/approval records read from
 * the Relay, merged with what this browser has submitted. A submitted decision
 * is never shown as an outcome; outcomes come only from records the Relay
 * returns. A decision whose delivery is uncertain blocks retry until the
 * approval has been re-read.
 */

import type {
  WorkflowApproval,
  WorkflowRun,
  WorkflowRunStatus,
} from "@/features/workflows/lib/workflow-http";
import type { NostrEvent } from "@/shared/api/nostr-types";

export type Decision = "grant" | "deny";

export type DecisionState =
  | { phase: "sending"; decision: Decision }
  /** The Relay acknowledged the decision; its effect on the run is not yet observed. */
  | { phase: "submitted"; decision: Decision; eventId: string }
  | { phase: "rejected"; decision: Decision; message: string }
  /**
   * The connection failed before the Relay's verdict. `rechecked` turns true
   * once a fresh approval read still shows the gate pending; only then may the
   * same signed event be resent.
   */
  | {
      phase: "uncertain";
      decision: Decision;
      event: NostrEvent;
      message: string;
      rechecked: boolean;
    };

export type RunsState = {
  runs: WorkflowRun[];
  /** Runs this browser started whose record has not been read back yet. */
  startedRunIds: string[];
  approvals: Readonly<Record<string, WorkflowApproval[]>>;
  decisions: Readonly<Record<string, DecisionState>>;
};

export type RunsAction =
  | { type: "runsLoaded"; runs: WorkflowRun[] }
  | { type: "runStarted"; runId: string }
  | { type: "approvalsLoaded"; runId: string; approvals: WorkflowApproval[] }
  | { type: "decisionSending"; approvalRef: string; decision: Decision }
  | { type: "decisionAccepted"; approvalRef: string; decision: Decision; eventId: string }
  | { type: "decisionRejected"; approvalRef: string; decision: Decision; message: string }
  | {
      type: "decisionUncertain";
      approvalRef: string;
      decision: Decision;
      event: NostrEvent;
      message: string;
    }
  | { type: "decisionDismissed"; approvalRef: string };

export const initialRunsState: RunsState = {
  runs: [],
  startedRunIds: [],
  approvals: {},
  decisions: {},
};

const TERMINAL: readonly WorkflowRunStatus[] = ["completed", "failed", "cancelled"];

export function isTerminalRun(status: WorkflowRunStatus): boolean {
  return TERMINAL.includes(status);
}

function withoutKey<T>(map: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** Newer records replace older ones; a read never resurrects an older status. */
function mergeRuns(
  current: readonly WorkflowRun[],
  incoming: readonly WorkflowRun[],
): WorkflowRun[] {
  const byId: Record<string, WorkflowRun> = {};
  for (const run of current) byId[run.id] = run;
  for (const run of incoming) {
    const previous = byId[run.id];
    if (previous && isTerminalRun(previous.status) && !isTerminalRun(run.status)) continue;
    byId[run.id] = run;
  }
  return Object.values(byId).sort(
    (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
}

export function runsReducer(state: RunsState, action: RunsAction): RunsState {
  switch (action.type) {
    case "runsLoaded": {
      const runs = mergeRuns(state.runs, action.runs);
      const known = new Set(runs.map((run) => run.id));
      return { ...state, runs, startedRunIds: state.startedRunIds.filter((id) => !known.has(id)) };
    }
    case "runStarted":
      if (
        state.startedRunIds.includes(action.runId) ||
        state.runs.some((run) => run.id === action.runId)
      ) {
        return state;
      }
      return { ...state, startedRunIds: [action.runId, ...state.startedRunIds] };
    case "approvalsLoaded": {
      let decisions = state.decisions;
      for (const approval of action.approvals) {
        const decision = decisions[approval.approvalRef];
        if (!decision || decision.phase === "sending" || decision.phase === "rejected") continue;
        if (approval.status !== "pending") {
          // The Relay's record now answers the question; the outcome is shown from it.
          decisions = withoutKey(decisions, approval.approvalRef);
        } else if (decision.phase === "uncertain" && !decision.rechecked) {
          decisions = { ...decisions, [approval.approvalRef]: { ...decision, rechecked: true } };
        }
      }
      return {
        ...state,
        approvals: { ...state.approvals, [action.runId]: action.approvals },
        decisions,
      };
    }
    case "decisionSending":
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.approvalRef]: { phase: "sending", decision: action.decision },
        },
      };
    case "decisionAccepted":
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.approvalRef]: {
            phase: "submitted",
            decision: action.decision,
            eventId: action.eventId,
          },
        },
      };
    case "decisionRejected":
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.approvalRef]: {
            phase: "rejected",
            decision: action.decision,
            message: action.message,
          },
        },
      };
    case "decisionUncertain":
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.approvalRef]: {
            phase: "uncertain",
            decision: action.decision,
            event: action.event,
            message: action.message,
            rechecked: false,
          },
        },
      };
    case "decisionDismissed":
      return { ...state, decisions: withoutKey(state.decisions, action.approvalRef) };
  }
}

/** The step a run is at: trace position for active runs, `current_step` otherwise. */
export function currentStepId(run: WorkflowRun, stepIds: readonly string[]): string | null {
  if (run.status === "waiting_approval" || run.status === "running") {
    const last = run.executionTrace[run.executionTrace.length - 1];
    if (last && (last.status === "waiting_approval" || last.status === "dispatching")) {
      return last.stepId;
    }
  }
  return run.currentStep !== null ? (stepIds[run.currentStep] ?? null) : null;
}

/** Whether a run still needs polling to observe its outcome. */
export function needsLiveRefresh(state: RunsState): "fast" | "slow" | null {
  if (state.startedRunIds.length) return "fast";
  if (
    Object.values(state.decisions).some(
      (decision) => decision.phase === "submitted" || decision.phase === "uncertain",
    )
  ) {
    return "fast";
  }
  if (state.runs.some((run) => run.status === "pending" || run.status === "running")) return "fast";
  if (state.runs.some((run) => run.status === "waiting_approval")) return "slow";
  return null;
}

/** Whether `pubkey` may decide this approval according to the Relay's rule. */
export function isDesignatedApprover(approval: WorkflowApproval, pubkey: string): boolean {
  const spec = approval.approverSpec.trim();
  return spec === "" || spec === "any" || spec.toLowerCase() === pubkey.toLowerCase();
}

/** Whether the run's durable record reflects a decided gate (not just our submission). */
export function decisionObserved(
  approval: WorkflowApproval,
  run: WorkflowRun | undefined,
): boolean {
  if (approval.status === "pending") return false;
  return run ? run.status !== "waiting_approval" : true;
}
