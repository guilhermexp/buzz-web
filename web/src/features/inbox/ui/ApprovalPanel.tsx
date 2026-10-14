import { CheckCircle2, CircleDashed, LoaderCircle, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalRequest, ApprovalResolution } from "@/features/inbox/lib/inbox-model";
import {
  readRunApprovals,
  readWorkflowRun,
  type WorkflowApproval,
  type WorkflowRun,
} from "@/features/workflows/lib/workflow-http";
import { getLocale, t } from "@/shared/i18n";

type Decision = "granted" | "denied";
type RunSnapshot = { run: WorkflowRun | null; approval: WorkflowApproval | null };

const POLL_INTERVAL_MS = 2_000;
const POLL_LIMIT = 30;

function runStatusLabel(run: WorkflowRun): string {
  const status = t(`workspace.approval.run.${run.status}`);
  return run.errorCode ? `${status} (${run.errorCode})` : status;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

/** True once the backend recorded the decision and the run left this approval step. */
export function approvalSettled(snapshot: RunSnapshot | null): boolean {
  if (!snapshot?.approval || snapshot.approval.status === "pending") return false;
  const { run, approval } = snapshot;
  if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return true;
  const lastStep = run.executionTrace[run.executionTrace.length - 1]?.stepId;
  return run.status === "waiting_approval" && lastStep !== approval.stepId;
}

/**
 * Approve/deny controls for a workflow approval request. After the Relay
 * accepts a decision the panel says "submitted" and then reports only what
 * the backend's run and approval records say — it never infers that the run
 * resumed from the OK alone.
 */
export function ApprovalPanel({
  approval,
  relayUrl,
  demo,
  decision,
  pending,
  disabled,
  onRespond,
}: {
  approval: ApprovalRequest;
  relayUrl: string;
  demo: boolean;
  decision: Decision | undefined;
  pending: boolean;
  disabled: boolean;
  onRespond: (approved: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const decided = Boolean(decision || approval.resolution);
  const expired =
    !decided && approval.expiresAt !== null && approval.expiresAt * 1_000 < Date.now();
  const canRead = !demo && decided && approval.workflowId && approval.runId;

  const read = useCallback(async () => {
    if (!approval.workflowId || !approval.runId) return null;
    const [run, approvals] = await Promise.all([
      readWorkflowRun(relayUrl, approval.workflowId, approval.runId),
      readRunApprovals(relayUrl, approval.workflowId, approval.runId),
    ]);
    return {
      run,
      approval: approvals.find((entry) => entry.approvalRef === approval.reference) ?? null,
    };
  }, [approval.reference, approval.runId, approval.workflowId, relayUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts polling on retry
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    let timer: number | null = null;
    let polls = 0;
    const poll = async () => {
      setReading(true);
      try {
        const next = await read();
        if (cancelled) return;
        setSnapshot(next);
        setReadError(null);
        polls += 1;
        if (!approvalSettled(next) && polls < POLL_LIMIT) {
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          setReadError(error instanceof Error ? error.message : t("workspace.approval.readError"));
        }
      } finally {
        if (!cancelled) setReading(false);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [attempt, canRead, read]);

  const recordedStatus = snapshot?.approval?.status;
  const outcome: ApprovalResolution | null =
    recordedStatus && recordedStatus !== "pending" ? recordedStatus : approval.resolution;

  return (
    <section
      aria-label={t("workspace.approval.title")}
      className="mb-3 rounded-xl border bg-background/45 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("workspace.approval.title")}</span>
        {approval.stepId ? (
          <span>{t("workspace.approval.step", { step: approval.stepId })}</span>
        ) : null}
        {approval.expiresAt ? (
          <span>
            {t("workspace.approval.expires", {
              time: new Intl.DateTimeFormat(getLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(approval.expiresAt * 1_000),
            })}
          </span>
        ) : null}
      </div>

      {decided ? (
        <div className="mt-2 space-y-1.5" role="status">
          <p className="flex items-center gap-2">
            {outcome === "granted" ? (
              <CheckCircle2
                aria-hidden="true"
                className="h-4 w-4 text-[hsl(var(--buzz-positive))]"
              />
            ) : outcome === "denied" || outcome === "expired" ? (
              <XCircle aria-hidden="true" className="h-4 w-4 text-destructive" />
            ) : (
              <CircleDashed aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            )}
            {outcome
              ? t(`workspace.approval.recorded.${outcome}`)
              : decision === "granted"
                ? t("workspace.approval.submittedGrant")
                : t("workspace.approval.submittedDeny")}
          </p>
          {snapshot?.run ? (
            <p className="text-xs text-muted-foreground">
              {t("workspace.approval.runState", { status: runStatusLabel(snapshot.run) })}
            </p>
          ) : snapshot && !snapshot.run ? (
            <p className="text-xs text-muted-foreground">{t("workspace.approval.runHidden")}</p>
          ) : demo || !approval.workflowId || !approval.runId ? (
            <p className="text-xs text-muted-foreground">
              {t("workspace.approval.runUnavailable")}
            </p>
          ) : reading ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              {t("workspace.approval.reading")}
            </p>
          ) : null}
          {readError ? (
            <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
              <span className="min-w-0 flex-1">{readError}</span>
              <button
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-medium text-foreground hover:bg-foreground/5"
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                <RefreshCw className="h-3 w-3" />
                {t("common.refresh")}
              </button>
            </p>
          ) : null}
        </div>
      ) : expired ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {t("workspace.approval.expired")}
        </p>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onRespond(false)}
          >
            {t("inbox.deny")}
          </button>
          <button
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onRespond(true)}
          >
            {pending ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {t("inbox.approve")}
          </button>
        </div>
      )}
    </section>
  );
}
