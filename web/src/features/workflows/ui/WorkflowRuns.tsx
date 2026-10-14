import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { currentStepId, isTerminalRun } from "@/features/workflows/lib/run-state";
import type { WorkflowExecution } from "@/features/workflows/lib/use-workflow-runs";
import {
  formatTime,
  runErrorText,
  runStatusLabel,
  stepStatusLabel,
} from "@/features/workflows/lib/workflow-format";
import type { WorkflowRun, WorkflowRunStatus } from "@/features/workflows/lib/workflow-http";
import { WorkflowApprovalPanel } from "@/features/workflows/ui/WorkflowApprovalPanel";
import { t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";

const STATUS_TONE: Record<WorkflowRunStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  waiting_approval: "bg-amber-500/14 text-amber-800 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunStatusBadge({ status }: { status: WorkflowRunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        STATUS_TONE[status],
      )}
      data-status={status}
    >
      {runStatusLabel(status)}
    </span>
  );
}

export function WorkflowRuns({
  execution,
  stepIds,
  pubkey,
  personLabel,
  expandedRunId,
  onExpand,
}: {
  execution: WorkflowExecution;
  stepIds: readonly string[];
  pubkey: string;
  personLabel: (pubkey: string) => string;
  expandedRunId: string | null;
  onExpand: (runId: string | null) => void;
}) {
  const { state } = execution;
  return (
    <section
      aria-labelledby="workflow-runs-heading"
      className="grid grid-cols-[minmax(0,1fr)] gap-2"
    >
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground" id="workflow-runs-heading">
          {t("workflows.runs")}
        </h4>
        {execution.live ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("workflows.runsLive")}
          </span>
        ) : null}
        <button
          aria-label={t("workflows.refreshRuns")}
          className="buzz-icon-button ml-auto"
          title={t("workflows.refreshRuns")}
          type="button"
          onClick={() => void execution.refresh()}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {execution.error ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {execution.error}
        </p>
      ) : null}

      {state.startedRunIds.map((runId) => (
        <p
          className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
          key={runId}
          role="status"
        >
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {t("workflows.runPendingRecord", { id: runId.slice(0, 8) })}
        </p>
      ))}

      {execution.loading && !state.runs.length ? (
        <p className="flex items-center gap-1.5 py-4 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          {t("workflows.runsLoading")}
        </p>
      ) : !state.runs.length && !state.startedRunIds.length && !execution.error ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
          {t("workflows.runsEmpty")}
        </p>
      ) : null}

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {state.runs.map((run) => (
          <li key={run.id}>
            <RunRow
              execution={execution}
              expanded={expandedRunId === run.id}
              personLabel={personLabel}
              pubkey={pubkey}
              run={run}
              stepIds={stepIds}
              onToggle={() => onExpand(expandedRunId === run.id ? null : run.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunRow({
  run,
  expanded,
  execution,
  stepIds,
  pubkey,
  personLabel,
  onToggle,
}: {
  run: WorkflowRun;
  expanded: boolean;
  execution: WorkflowExecution;
  stepIds: readonly string[];
  pubkey: string;
  personLabel: (pubkey: string) => string;
  onToggle: () => void;
}) {
  const step = currentStepId(run, stepIds);
  const failure = runErrorText(run);
  const approvals = execution.state.approvals[run.id] ?? [];
  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        expanded ? "border-primary/40 bg-primary/[0.03]" : "hover:bg-foreground/[0.03]",
      )}
      data-run-id={run.id}
      data-testid="workflow-run"
    >
      <button
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        type="button"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">
              {t("workflows.runLabel", { id: run.id.slice(0, 8) })}
            </span>
            <RunStatusBadge status={run.status} />
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{t("workflows.runCreated", { time: formatTime(run.createdAt) })}</span>
            {run.completedAt !== null ? (
              <span>{t("workflows.runFinished", { time: formatTime(run.completedAt) })}</span>
            ) : null}
            {step && !isTerminalRun(run.status) ? (
              <span>{t("workflows.currentStep", { step })}</span>
            ) : null}
          </span>
          {failure ? (
            <span
              className="text-xs text-destructive [overflow-wrap:anywhere]"
              data-testid="workflow-run-error"
            >
              {failure}
            </span>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="border-t px-3 py-3">
          <h5 className="mb-2 text-[11px] font-semibold text-muted-foreground">
            {t("workflows.trace")}
          </h5>
          {run.executionTrace.length ? (
            <ol className="grid gap-1.5" data-testid="workflow-run-trace">
              {run.executionTrace.map((entry) => (
                <li
                  className="rounded-md bg-muted/40 px-2.5 py-2"
                  data-step-status={entry.status}
                  key={entry.stepId}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-medium">{entry.stepId}</span>
                    <span className="text-muted-foreground">{stepStatusLabel(entry.status)}</span>
                  </div>
                  {entry.output && Object.keys(entry.output).length ? (
                    <details className="mt-1 text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground">
                        {t("workflows.stepOutput")}
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                        {JSON.stringify(entry.output, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">{t("workflows.traceEmpty")}</p>
          )}

          {execution.approvalsError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {execution.approvalsError}
            </p>
          ) : null}
          {approvals.map((approval) => (
            <WorkflowApprovalPanel
              approval={approval}
              decision={execution.state.decisions[approval.approvalRef]}
              key={approval.approvalRef}
              personLabel={personLabel}
              pubkey={pubkey}
              run={run}
              onDecide={(decision, note) => void execution.decide(approval, decision, note)}
              onDismiss={() => execution.dismissDecision(approval.approvalRef)}
              onResend={() => void execution.resendDecision(approval.approvalRef)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
