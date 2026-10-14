import { describe, expect, it } from "vitest";
import {
  currentStepId,
  decisionObserved,
  initialRunsState,
  isDesignatedApprover,
  needsLiveRefresh,
  type RunsAction,
  type RunsState,
  runsReducer,
} from "@/features/workflows/lib/run-state";
import type { WorkflowApproval, WorkflowRun } from "@/features/workflows/lib/workflow-http";
import type { NostrEvent } from "@/shared/api/nostr-types";

const APPROVER = "b".repeat(64);
const REF = "c".repeat(64);

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflowId: "wf-1",
    status: "waiting_approval",
    currentStep: 1,
    executionTrace: [
      { stepId: "before", status: "completed", output: { event_id: "e" } },
      { stepId: "gate", status: "waiting_approval", output: { approval_ref: REF } },
    ],
    startedAt: 100,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: 100,
    ...overrides,
  };
}

function approval(overrides: Partial<WorkflowApproval> = {}): WorkflowApproval {
  return {
    approvalRef: REF,
    workflowId: "wf-1",
    runId: "run-1",
    stepId: "gate",
    stepIndex: 1,
    approverSpec: APPROVER,
    status: "pending",
    approverPubkey: null,
    note: null,
    expiresAt: "2026-10-13T12:00:00Z",
    createdAt: 101,
    ...overrides,
  };
}

const signed = { id: "d".repeat(64) } as NostrEvent;

function apply(...actions: Parameters<typeof runsReducer>[1][]): RunsState {
  return actions.reduce(runsReducer, initialRunsState);
}

describe("decision lifecycle", () => {
  it("keeps an acknowledged decision as submitted until the Relay records the outcome", () => {
    const submitted = apply(
      { type: "runsLoaded", runs: [run()] },
      { type: "decisionSending", approvalRef: REF, decision: "grant" },
      { type: "decisionAccepted", approvalRef: REF, decision: "grant", eventId: signed.id },
      { type: "approvalsLoaded", runId: "run-1", approvals: [approval()] },
    );
    expect(submitted.decisions[REF]).toMatchObject({ phase: "submitted" });
    expect(needsLiveRefresh(submitted)).toBe("fast");

    const observed: RunsAction[] = [
      {
        type: "approvalsLoaded",
        runId: "run-1",
        approvals: [approval({ status: "granted", approverPubkey: APPROVER })],
      },
      { type: "runsLoaded", runs: [run({ status: "completed", completedAt: 120 })] },
    ];
    const settled = observed.reduce(runsReducer, submitted);
    expect(settled.decisions[REF]).toBeUndefined();
    expect(settled.runs[0]?.status).toBe("completed");
    expect(needsLiveRefresh(settled)).toBeNull();
  });

  it("blocks resending after a lost connection until the approval is re-read", () => {
    const uncertain = apply(
      { type: "decisionSending", approvalRef: REF, decision: "deny" },
      {
        type: "decisionUncertain",
        approvalRef: REF,
        decision: "deny",
        event: signed,
        message: "connection lost",
      },
    );
    expect(uncertain.decisions[REF]).toMatchObject({ phase: "uncertain", rechecked: false });

    const stillPending = runsReducer(uncertain, {
      type: "approvalsLoaded",
      runId: "run-1",
      approvals: [approval()],
    });
    expect(stillPending.decisions[REF]).toMatchObject({ phase: "uncertain", rechecked: true });

    const alreadyDecided = runsReducer(uncertain, {
      type: "approvalsLoaded",
      runId: "run-1",
      approvals: [approval({ status: "denied", approverPubkey: APPROVER })],
    });
    expect(alreadyDecided.decisions[REF]).toBeUndefined();
  });

  it("keeps the Relay's rejection visible even after the approval record changes", () => {
    const rejected = apply(
      {
        type: "decisionRejected",
        approvalRef: REF,
        decision: "grant",
        message: "invalid: approval already granted",
      },
      {
        type: "approvalsLoaded",
        runId: "run-1",
        approvals: [approval({ status: "granted" })],
      },
    );
    expect(rejected.decisions[REF]).toEqual({
      phase: "rejected",
      decision: "grant",
      message: "invalid: approval already granted",
    });
    expect(
      runsReducer(rejected, { type: "decisionDismissed", approvalRef: REF }).decisions,
    ).toEqual({});
  });
});

describe("run records", () => {
  it("tracks a started run until its durable record is read", () => {
    const started = apply({ type: "runStarted", runId: "run-2" });
    expect(needsLiveRefresh(started)).toBe("fast");
    const loaded = runsReducer(started, {
      type: "runsLoaded",
      runs: [run({ id: "run-2", status: "running", createdAt: 200 })],
    });
    expect(loaded.startedRunIds).toEqual([]);
    expect(runsReducer(loaded, { type: "runStarted", runId: "run-2" })).toBe(loaded);
  });

  it("never lets a stale read move a finished run back to an active status", () => {
    const finished = apply({
      type: "runsLoaded",
      runs: [run({ status: "cancelled", errorCode: "approval_denied" })],
    });
    const stale = runsReducer(finished, { type: "runsLoaded", runs: [run()] });
    expect(stale.runs[0]).toMatchObject({ status: "cancelled", errorCode: "approval_denied" });
  });

  it("orders runs newest first and polls slowly while only approvals are pending", () => {
    const state = apply({
      type: "runsLoaded",
      runs: [
        run({ id: "old", createdAt: 1, status: "completed" }),
        run({ id: "new", createdAt: 9 }),
      ],
    });
    expect(state.runs.map((item) => item.id)).toEqual(["new", "old"]);
    expect(needsLiveRefresh(state)).toBe("slow");
  });

  it("reports the step a suspended or dispatching run is at", () => {
    expect(currentStepId(run(), ["before", "gate", "after"])).toBe("gate");
    expect(
      currentStepId(
        run({
          status: "running",
          currentStep: 2,
          executionTrace: [
            { stepId: "before", status: "completed", output: null },
            { stepId: "gate", status: "completed", output: null },
            { stepId: "after", status: "dispatching", output: null },
          ],
        }),
        ["before", "gate", "after"],
      ),
    ).toBe("after");
    expect(currentStepId(run({ status: "failed", currentStep: 1 }), ["before", "gate"])).toBe(
      "gate",
    );
  });
});

describe("approval authority mirrors the Relay", () => {
  it("allows the designated pubkey case-insensitively and any member for `any`", () => {
    expect(isDesignatedApprover(approval(), APPROVER.toUpperCase())).toBe(true);
    expect(isDesignatedApprover(approval(), "a".repeat(64))).toBe(false);
    expect(isDesignatedApprover(approval({ approverSpec: "any" }), "a".repeat(64))).toBe(true);
  });

  it("treats a decided gate as observed only once the run left waiting_approval", () => {
    expect(decisionObserved(approval({ status: "granted" }), run())).toBe(false);
    expect(decisionObserved(approval({ status: "granted" }), run({ status: "running" }))).toBe(
      true,
    );
    expect(decisionObserved(approval(), run({ status: "running" }))).toBe(false);
  });
});
