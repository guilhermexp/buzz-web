import { Check, LoaderCircle, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useId, useState } from "react";
import {
  type Decision,
  type DecisionState,
  decisionObserved,
  isDesignatedApprover,
} from "@/features/workflows/lib/run-state";
import { formatTime, runStatusLabel } from "@/features/workflows/lib/workflow-format";
import type { WorkflowApproval, WorkflowRun } from "@/features/workflows/lib/workflow-http";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/** One approval gate: Relay-recorded status, and decision controls for the designated approver. */
export function WorkflowApprovalPanel({
  approval,
  run,
  decision,
  pubkey,
  personLabel,
  onDecide,
  onResend,
  onDismiss,
}: {
  approval: WorkflowApproval;
  run: WorkflowRun | undefined;
  decision: DecisionState | undefined;
  pubkey: string;
  personLabel: (pubkey: string) => string;
  onDecide: (decision: Decision, note: string) => void;
  onResend: () => void;
  onDismiss: () => void;
}) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const approver =
    approval.approverSpec === "any"
      ? t("workflows.approverAny")
      : personLabel(approval.approverSpec);
  const expiresAt = Date.parse(approval.expiresAt);
  const lapsed = Number.isFinite(expiresAt) && expiresAt <= Date.now();
  const pending = approval.status === "pending";
  const canDecide = pending && !lapsed && isDesignatedApprover(approval, pubkey);
  const busy = decision?.phase === "sending" || decision?.phase === "submitted";

  return (
    <section
      aria-label={t("workflows.approval")}
      className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5"
      data-testid="workflow-approval"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        {t("workflows.approval")}
      </p>

      {pending ? (
        <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
          <p>{t("workflows.approvalWaiting", { approver })}</p>
          {Number.isFinite(expiresAt) ? (
            <p>
              {t("workflows.approvalExpires", { time: formatTime(Math.floor(expiresAt / 1_000)) })}
            </p>
          ) : null}
          {lapsed ? <p>{t("workflows.approvalLapsed")}</p> : null}
        </div>
      ) : (
        <div className="mt-1 grid gap-0.5 text-xs" data-testid="workflow-approval-outcome">
          <p className="font-medium">
            {approval.status === "expired"
              ? t("workflows.approvalStatus.expired")
              : t(
                  approval.status === "granted"
                    ? "workflows.approvalStatus.granted"
                    : "workflows.approvalStatus.denied",
                  {
                    who: approval.approverPubkey ? personLabel(approval.approverPubkey) : approver,
                  },
                )}
          </p>
          {approval.note ? (
            <p className="break-words text-muted-foreground">
              {t("workflows.approvalRecordedNote", { note: approval.note })}
            </p>
          ) : null}
          {run && decisionObserved(approval, run) ? (
            <p className="text-muted-foreground">{runStatusLabel(run.status)}</p>
          ) : null}
        </div>
      )}

      {decision ? (
        <DecisionStatus decision={decision} onDismiss={onDismiss} onResend={onResend} />
      ) : null}

      {canDecide && decision?.phase !== "uncertain" ? (
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor={noteId}>
            {t("workflows.approvalNote")}
            <input
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              disabled={busy}
              id={noteId}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} size="sm" type="button" onClick={() => onDecide("grant", note)}>
              <Check />
              {t("workflows.approve")}
            </Button>
            <Button
              disabled={busy}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onDecide("deny", note)}
            >
              <X />
              {t("workflows.deny")}
            </Button>
          </div>
        </div>
      ) : pending && !lapsed && !canDecide ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("workflows.notApprover", { approver })}
        </p>
      ) : null}
    </section>
  );
}

function DecisionStatus({
  decision,
  onResend,
  onDismiss,
}: {
  decision: DecisionState;
  onResend: () => void;
  onDismiss: () => void;
}) {
  if (decision.phase === "sending" || decision.phase === "submitted") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {decision.phase === "sending"
          ? t("workflows.decisionSending")
          : t("workflows.decisionSubmitted")}
      </p>
    );
  }
  if (decision.phase === "rejected") {
    return (
      <div
        className="mt-2 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-2 text-xs text-destructive"
        role="alert"
      >
        <p className="break-words">
          {t("workflows.decisionRejected", { message: decision.message })}
        </p>
        <button
          className="mt-1 font-medium underline underline-offset-2"
          type="button"
          onClick={onDismiss}
        >
          {t("workflows.dismiss")}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-md border px-2.5 py-2 text-xs" role="status">
      {decision.rechecked ? (
        <>
          <p>{t("workflows.decisionUnconfirmed")}</p>
          <Button className="mt-2" size="sm" type="button" variant="outline" onClick={onResend}>
            <RotateCcw />
            {t("workflows.decisionResend")}
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {t("workflows.decisionUncertain")}
        </p>
      )}
    </div>
  );
}
