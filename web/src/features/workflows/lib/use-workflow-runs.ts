import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  type Decision,
  initialRunsState,
  needsLiveRefresh,
  type RunsState,
  runsReducer,
} from "@/features/workflows/lib/run-state";
import {
  KIND_APPROVAL_DENIED,
  KIND_APPROVAL_GRANTED,
  KIND_APPROVAL_REQUESTED,
  publishWithOutcome,
  runIdFrom,
  signApprovalDecision,
  signWorkflowTrigger,
  type WorkflowRecord,
} from "@/features/workflows/lib/workflow-events";
import {
  readRunApprovals,
  readWorkflowRuns,
  type WorkflowApproval,
} from "@/features/workflows/lib/workflow-http";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

const FAST_REFRESH_MS = 2_000;
const SLOW_REFRESH_MS = 10_000;

export type TriggerState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "started"; runId: string }
  | { phase: "rejected"; message: string }
  /** Delivery unknown; `rechecked` turns true after run history was read again. */
  | { phase: "uncertain"; message: string; rechecked: boolean };

export type WorkflowExecution = {
  state: RunsState;
  /** No run history has been read yet. */
  loading: boolean;
  error: string | null;
  approvalsError: string | null;
  /** Polling while a run or decision is in flight. */
  live: boolean;
  triggerState: TriggerState;
  clearTrigger: () => void;
  refresh: () => Promise<void>;
  /** Starts a run; resolves to its id when the Relay confirms it. */
  trigger: (fields: Record<string, unknown> | null) => Promise<string | null>;
  decide: (approval: WorkflowApproval, decision: Decision, note: string) => Promise<void>;
  resendDecision: (approvalRef: string) => Promise<void>;
  dismissDecision: (approvalRef: string) => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Durable run and approval records for one workflow, refreshed live while a
 * run or decision is in flight and re-read after every reconnect.
 */
export function useWorkflowRuns(
  workflow: WorkflowRecord,
  expandedRunId: string | null,
): WorkflowExecution {
  const { client, connected, relayUrl } = useWorkspace();
  const [state, dispatch] = useReducer(runsReducer, initialRunsState);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [triggerState, setTriggerState] = useState<TriggerState>({ phase: "idle" });
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const expandedRef = useRef(expandedRunId);
  expandedRef.current = expandedRunId;

  const readOnce = useCallback(async () => {
    try {
      const page = await readWorkflowRuns(relayUrl, workflow.id, { limit: 20 });
      dispatch({ type: "runsLoaded", runs: page.runs });
      setError(null);
      setTriggerState((current) =>
        current.phase === "uncertain" ? { ...current, rechecked: true } : current,
      );
    } catch (readError) {
      setError(errorText(readError));
    } finally {
      setLoaded(true);
    }
    const runId = expandedRef.current;
    if (!runId) return;
    try {
      const approvals = await readRunApprovals(relayUrl, workflow.id, runId);
      dispatch({ type: "approvalsLoaded", runId, approvals });
      setApprovalsError(null);
    } catch (readError) {
      setApprovalsError(errorText(readError));
    }
  }, [relayUrl, workflow.id]);

  /** Coalesces overlapping refresh requests into one trailing read. */
  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      do {
        queued.current = false;
        await readOnce();
      } while (queued.current);
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, [readOnce]);

  // Initial read and every reconnect re-read durable state.
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  // A newly expanded run needs its approvals read.
  useEffect(() => {
    if (connected && expandedRunId) void refresh();
  }, [connected, expandedRunId, refresh]);

  const mode = needsLiveRefresh(state);
  useEffect(() => {
    if (!mode || !connected) return;
    const timer = window.setInterval(
      () => void refresh(),
      mode === "fast" ? FAST_REFRESH_MS : SLOW_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [connected, mode, refresh]);

  // Relay-signed approval notices for this channel mean the records changed.
  useEffect(() => {
    if (!client || !connected) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void client
      .subscribe(
        {
          kinds: [KIND_APPROVAL_REQUESTED, KIND_APPROVAL_GRANTED, KIND_APPROVAL_DENIED],
          "#h": [workflow.channelId],
          since: Math.floor(Date.now() / 1_000),
        },
        () => void refresh(),
      )
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client, connected, refresh, workflow.channelId]);

  const sendDecision = useCallback(
    async (approvalRef: string, decision: Decision, event: NostrEvent) => {
      if (!client) throw new Error(t("error.relayClient"));
      const outcome = await publishWithOutcome(client, event);
      if (outcome.kind === "accepted") {
        dispatch({ type: "decisionAccepted", approvalRef, decision, eventId: event.id });
      } else if (outcome.kind === "rejected") {
        dispatch({ type: "decisionRejected", approvalRef, decision, message: outcome.message });
      } else {
        dispatch({
          type: "decisionUncertain",
          approvalRef,
          decision,
          event,
          message: outcome.message,
        });
      }
      await refresh();
    },
    [client, refresh],
  );

  const decide = useCallback(
    async (approval: WorkflowApproval, decision: Decision, note: string) => {
      const approvalRef = approval.approvalRef;
      dispatch({ type: "decisionSending", approvalRef, decision });
      try {
        await sendDecision(
          approvalRef,
          decision,
          await signApprovalDecision(approvalRef, decision, note),
        );
      } catch (sendError) {
        dispatch({
          type: "decisionRejected",
          approvalRef,
          decision,
          message: errorText(sendError),
        });
      }
    },
    [sendDecision],
  );

  /** Resend the identical signed event; the Relay treats a duplicate as already processed. */
  const resendDecision = useCallback(
    async (approvalRef: string) => {
      const pending = state.decisions[approvalRef];
      if (pending?.phase !== "uncertain" || !pending.rechecked) return;
      dispatch({ type: "decisionSending", approvalRef, decision: pending.decision });
      try {
        await sendDecision(approvalRef, pending.decision, pending.event);
      } catch (sendError) {
        dispatch({
          type: "decisionRejected",
          approvalRef,
          decision: pending.decision,
          message: errorText(sendError),
        });
      }
    },
    [sendDecision, state.decisions],
  );

  const trigger = useCallback(
    async (fields: Record<string, unknown> | null): Promise<string | null> => {
      if (!client) {
        setTriggerState({ phase: "rejected", message: t("error.relayClient") });
        return null;
      }
      setTriggerState({ phase: "sending" });
      try {
        const outcome = await publishWithOutcome(
          client,
          await signWorkflowTrigger(workflow.id, fields),
        );
        if (outcome.kind === "rejected") {
          setTriggerState({ phase: "rejected", message: outcome.message });
          return null;
        }
        if (outcome.kind === "uncertain") {
          setTriggerState({ phase: "uncertain", message: outcome.message, rechecked: false });
          void refresh();
          return null;
        }
        const runId = runIdFrom(outcome.message);
        if (runId) dispatch({ type: "runStarted", runId });
        setTriggerState(runId ? { phase: "started", runId } : { phase: "idle" });
        void refresh();
        return runId;
      } catch (triggerError) {
        setTriggerState({ phase: "rejected", message: errorText(triggerError) });
        return null;
      }
    },
    [client, refresh, workflow.id],
  );

  return {
    state,
    loading: !loaded,
    error,
    approvalsError,
    live: Boolean(mode),
    triggerState,
    clearTrigger: () => setTriggerState({ phase: "idle" }),
    refresh,
    trigger,
    decide,
    resendDecision,
    dismissDecision: (approvalRef: string) => dispatch({ type: "decisionDismissed", approvalRef }),
  };
}
