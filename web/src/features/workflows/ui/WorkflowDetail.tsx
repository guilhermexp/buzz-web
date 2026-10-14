import { ArrowLeft, LoaderCircle, Pause, Pencil, Play, Trash2, Zap } from "lucide-react";
import { useId, useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { useWorkflowRuns } from "@/features/workflows/lib/use-workflow-runs";
import {
  publishWithOutcome,
  signWorkflowDefinition,
  signWorkflowDeletion,
  type WorkflowRecord,
} from "@/features/workflows/lib/workflow-events";
import {
  issueText,
  stepDetail,
  triggerSummary,
  yamlWithEnabled,
} from "@/features/workflows/lib/workflow-format";
import { WorkflowRuns } from "@/features/workflows/ui/WorkflowRuns";
import { WorkflowWebhook } from "@/features/workflows/ui/WorkflowWebhook";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/** Example payload: trigger fields become `{{trigger.<key>}}` for the run. */
const FIELDS_EXAMPLE = '{"version": "1.2.0"}';

type WriteState =
  | { phase: "idle" }
  | { phase: "busy"; action: "toggle" | "delete" }
  | { phase: "failed"; message: string }
  | { phase: "uncertain" };

function parseTriggerFields(source: string): Record<string, unknown> | null | "invalid" {
  if (!source.trim()) return null;
  try {
    const value: unknown = JSON.parse(source);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : "invalid";
  } catch {
    return "invalid";
  }
}

export function WorkflowDetail({
  workflow,
  channelName,
  personLabel,
  webhookSecret,
  webhookSecretLost,
  onBack,
  onEdit,
  onChanged,
  onDeleted,
  onSecretDone,
}: {
  workflow: WorkflowRecord;
  channelName: string;
  personLabel: (pubkey: string) => string;
  webhookSecret: string | null;
  webhookSecretLost: boolean;
  onBack: () => void;
  onEdit: () => void;
  /** Ask the list to re-read definitions from the Relay. */
  onChanged: () => void;
  onDeleted: () => void;
  onSecretDone: () => void;
}) {
  const { client, pubkey, relayUrl } = useWorkspace();
  const fieldsId = useId();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const execution = useWorkflowRuns(workflow, expandedRunId);
  const [write, setWrite] = useState<WriteState>({ phase: "idle" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [fieldsText, setFieldsText] = useState("");
  const isOwner = workflow.ownerPubkey.toLowerCase() === pubkey.toLowerCase();
  const definition = workflow.validation.ok ? workflow.validation.definition : null;
  const stepIds = definition?.steps.map((step) => step.id) ?? [];
  const fields = parseTriggerFields(fieldsText);
  const { triggerState } = execution;
  const triggerBlocked =
    triggerState.phase === "sending" ||
    (triggerState.phase === "uncertain" && !triggerState.rechecked);
  const approverLabel = (spec: string) =>
    spec.trim().toLowerCase() === "any" ? t("workflows.approverAny") : personLabel(spec.trim());

  async function publishDefinitionChange(action: "toggle" | "delete") {
    if (!client || !definition) return;
    setWrite({ phase: "busy", action });
    try {
      let event: NostrEvent;
      if (action === "delete") {
        event = await signWorkflowDeletion(workflow.ownerPubkey, workflow.id);
      } else {
        const yaml = yamlWithEnabled(workflow.yaml, !definition.enabled);
        if (yaml === null) {
          setWrite({ phase: "failed", message: t("workflows.saveRejected") });
          return;
        }
        event = await signWorkflowDefinition({
          workflowId: workflow.id,
          channelId: workflow.channelId,
          yaml,
          expectedRevision: workflow.revision,
        });
      }
      const outcome = await publishWithOutcome(client, event);
      if (outcome.kind === "rejected") {
        setWrite({ phase: "failed", message: outcome.message });
        return;
      }
      setWrite(outcome.kind === "uncertain" ? { phase: "uncertain" } : { phase: "idle" });
      setConfirmDelete(false);
      if (action === "delete" && outcome.kind === "accepted") onDeleted();
      else onChanged();
    } catch (writeError) {
      setWrite({
        phase: "failed",
        message: writeError instanceof Error ? writeError.message : String(writeError),
      });
    }
  }

  async function startRun() {
    if (fields === "invalid") return;
    const runId = await execution.trigger(fields);
    if (runId) {
      setExpandedRunId(runId);
      setTriggerOpen(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <button
          aria-label={t("workflows.backToList")}
          className="buzz-icon-button lg:!hidden"
          title={t("workflows.backToList")}
          type="button"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {definition?.name ?? workflow.id}
        </h3>
        {isOwner && definition ? (
          <>
            <Button size="sm" type="button" variant="outline" onClick={onEdit}>
              <Pencil />
              <span className="max-sm:sr-only">{t("workflows.edit")}</span>
            </Button>
            <Button
              aria-expanded={triggerOpen}
              size="sm"
              type="button"
              onClick={() => setTriggerOpen((open) => !open)}
            >
              <Zap />
              <span className="max-sm:sr-only">{t("workflows.trigger")}</span>
            </Button>
          </>
        ) : null}
      </header>

      <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 p-4">
          <section
            aria-label={t("workflows.definition")}
            className="grid grid-cols-[minmax(0,1fr)] gap-2"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>#{channelName}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t("workflows.ownedBy", {
                  name: isOwner ? t("workflows.you") : personLabel(workflow.ownerPubkey),
                })}
              </span>
              {definition ? (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-medium ${definition.enabled ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted"}`}
                  data-testid="workflow-enabled-state"
                >
                  {definition.enabled ? t("workflows.enabled") : t("workflows.disabled")}
                </span>
              ) : null}
            </div>
            {definition?.description ? <p className="text-sm">{definition.description}</p> : null}
            {definition ? (
              <p className="text-sm font-medium" data-testid="workflow-trigger-summary">
                {triggerSummary(definition.trigger)}
                {definition.trigger.filter ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    {t("workflows.triggerFilter", { filter: definition.trigger.filter })}
                  </span>
                ) : null}
              </p>
            ) : !workflow.validation.ok ? (
              <p className="text-xs text-destructive">
                {t("workflows.invalidStored", { reason: issueText(workflow.validation.error) })}
              </p>
            ) : null}
            {!isOwner ? (
              <p className="text-xs text-muted-foreground">{t("workflows.ownerOnly")}</p>
            ) : null}
          </section>

          {triggerOpen && isOwner ? (
            <form
              aria-label={t("workflows.triggerTitle")}
              className="grid gap-2 rounded-lg border px-3 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void startRun();
              }}
            >
              <label className="text-xs font-medium text-muted-foreground" htmlFor={fieldsId}>
                {t("workflows.triggerFields")}
              </label>
              <textarea
                aria-invalid={fields === "invalid"}
                className="min-h-20 rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                id={fieldsId}
                placeholder={FIELDS_EXAMPLE}
                spellCheck={false}
                value={fieldsText}
                onChange={(event) => setFieldsText(event.target.value)}
              />
              {fields === "invalid" ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("workflows.triggerFieldsInvalid", { example: '{"key": "value"}' })}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={fields === "invalid" || triggerBlocked} size="sm" type="submit">
                  {triggerState.phase === "sending" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  {triggerState.phase === "sending"
                    ? t("workflows.triggering")
                    : t("workflows.trigger")}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => setTriggerOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          ) : null}

          {triggerState.phase === "rejected" ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {triggerState.message}
            </p>
          ) : triggerState.phase === "uncertain" ? (
            <p className="rounded-md border px-3 py-2 text-xs" role="status">
              {t("workflows.triggerUncertain")}
            </p>
          ) : null}

          {definition ? (
            <section
              aria-labelledby="workflow-steps-heading"
              className="grid grid-cols-[minmax(0,1fr)] gap-2"
            >
              <h4
                className="text-xs font-semibold text-muted-foreground"
                id="workflow-steps-heading"
              >
                {t("workflows.steps")}
              </h4>
              <ol className="grid gap-1.5">
                {definition.steps.map((step, index) => (
                  <li className="flex gap-2.5 rounded-lg border px-3 py-2" key={step.id}>
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="font-medium">{t(`workflows.action.${step.action}`)}</span>
                        <span className="font-mono text-muted-foreground">
                          {step.name ?? step.id}
                        </span>
                      </p>
                      <p className="mt-0.5 line-clamp-3 break-words text-xs text-muted-foreground">
                        {stepDetail(step, approverLabel)}
                      </p>
                      {step.if ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {t("workflows.condition", { expression: step.if })}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {isOwner && definition?.trigger.on === "webhook" ? (
            <WorkflowWebhook
              relayUrl={relayUrl}
              secret={webhookSecret}
              secretLost={webhookSecretLost}
              workflowId={workflow.id}
              onSecretDone={onSecretDone}
            />
          ) : null}

          <WorkflowRuns
            execution={execution}
            expandedRunId={expandedRunId}
            personLabel={personLabel}
            pubkey={pubkey}
            stepIds={stepIds}
            onExpand={setExpandedRunId}
          />

          {isOwner && definition ? (
            <section className="grid gap-2 border-t pt-4">
              {write.phase === "failed" ? (
                <p
                  className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {write.message}
                </p>
              ) : write.phase === "uncertain" ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {t("workflows.saveUncertain")}
                </p>
              ) : null}
              {confirmDelete ? (
                <div className="grid gap-2 rounded-lg border border-destructive/30 px-3 py-2.5">
                  <p className="text-xs">{t("workflows.deleteConfirm")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={write.phase === "busy"}
                      size="sm"
                      type="button"
                      variant="destructive"
                      onClick={() => void publishDefinitionChange("delete")}
                    >
                      {write.phase === "busy" && write.action === "delete" ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                      {write.phase === "busy" && write.action === "delete"
                        ? t("workflows.deleting")
                        : t("workflows.deleteAction")}
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmDelete(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={write.phase === "busy"}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => void publishDefinitionChange("toggle")}
                  >
                    {write.phase === "busy" && write.action === "toggle" ? (
                      <LoaderCircle className="animate-spin" />
                    ) : definition.enabled ? (
                      <Pause />
                    ) : (
                      <Play />
                    )}
                    {write.phase === "busy" && write.action === "toggle"
                      ? t("workflows.updating")
                      : definition.enabled
                        ? t("workflows.disable")
                        : t("workflows.enable")}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 />
                    {t("workflows.delete")}
                  </Button>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
