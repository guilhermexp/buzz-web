import { AlertTriangle, CheckCircle2, LoaderCircle, RotateCcw, XCircle } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  publishWithOutcome,
  revisionStored,
  signWorkflowDefinition,
  type WorkflowRecord,
  webhookSecretFrom,
} from "@/features/workflows/lib/workflow-events";
import { issueText, workflowTemplate } from "@/features/workflows/lib/workflow-format";
import { validateWorkflowYaml } from "@/features/workflows/lib/workflow-schema";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

export type SavedWorkflow = {
  workflowId: string;
  /** Present once, when this save first gave the workflow a webhook trigger. */
  webhookSecret: string | null;
  /** The save was stored but the reply carrying a new secret was lost. */
  webhookSecretLost: boolean;
};

type SaveState =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "rejected"; message: string; conflict: boolean }
  | { phase: "uncertain"; event: NostrEvent; expectsSecret: boolean }
  | { phase: "notStored" };

export function WorkflowEditor({
  workflow,
  latest,
  channels,
  defaultChannelId,
  onCancel,
  onSaved,
  onConflict,
}: {
  /** The revision being edited; `null` creates a new workflow. */
  workflow: WorkflowRecord | null;
  /** The newest known revision of the same workflow, for conflict recovery. */
  latest: WorkflowRecord | null;
  channels: readonly BuzzChannel[];
  defaultChannelId: string | null;
  onCancel: () => void;
  onSaved: (saved: SavedWorkflow) => void;
  onConflict: () => void;
}) {
  const { client, connected, pubkey } = useWorkspace();
  const fieldId = useId();
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const [workflowId] = useState(() => workflow?.id ?? crypto.randomUUID());
  const [channelId, setChannelId] = useState(
    workflow?.channelId ?? defaultChannelId ?? channels[0]?.id ?? "",
  );
  const [baseRevision, setBaseRevision] = useState(workflow?.revision ?? null);
  const [baseTrigger, setBaseTrigger] = useState(
    workflow?.validation.ok ? workflow.validation.definition.trigger.on : null,
  );
  const [yaml, setYaml] = useState(() => workflow?.yaml ?? workflowTemplate());
  const [save, setSave] = useState<SaveState>({ phase: "idle" });
  const deferredYaml = useDeferredValue(yaml);
  const validation = useMemo(() => validateWorkflowYaml(deferredYaml), [deferredYaml]);
  const channel = channels.find((candidate) => candidate.id === channelId) ?? null;
  const role = channel?.members.find(
    (member) => member.pubkey.toLowerCase() === pubkey.toLowerCase(),
  )?.role;
  const needsElevatedRole =
    validation.ok &&
    validation.definition.steps.some((step) => step.action === "call_webhook") &&
    role !== "owner" &&
    role !== "admin";
  const busy = save.phase === "saving" || save.phase === "uncertain";
  const canSave = validation.ok && deferredYaml === yaml && Boolean(channelId) && !busy;

  // An unconfirmed save is resolved from the Relay's stored events once connected.
  useEffect(() => {
    if (save.phase !== "uncertain" || !connected || !client) return;
    let active = true;
    void revisionStored(client, save.event.id)
      .then((stored) => {
        if (!active) return;
        if (stored) {
          onSavedRef.current({
            workflowId,
            webhookSecret: null,
            webhookSecretLost: save.expectsSecret,
          });
        } else {
          setSave({ phase: "notStored" });
        }
      })
      .catch(() => {
        if (active) setSave({ phase: "notStored" });
      });
    return () => {
      active = false;
    };
  }, [client, connected, save, workflowId]);

  async function submit() {
    if (!validation.ok || !client) return;
    setSave({ phase: "saving" });
    const expectsSecret =
      validation.definition.trigger.on === "webhook" && baseTrigger !== "webhook";
    try {
      const event = await signWorkflowDefinition({
        workflowId,
        channelId,
        yaml,
        expectedRevision: baseRevision,
      });
      const outcome = await publishWithOutcome(client, event);
      if (outcome.kind === "accepted") {
        const webhookSecret = webhookSecretFrom(outcome.message);
        setBaseRevision(event.id);
        setBaseTrigger(validation.definition.trigger.on);
        setSave({ phase: "idle" });
        onSaved({ workflowId, webhookSecret, webhookSecretLost: false });
      } else if (outcome.kind === "rejected") {
        const conflict = outcome.message.startsWith("conflict:");
        if (conflict) onConflict();
        setSave({ phase: "rejected", message: outcome.message, conflict });
      } else {
        setSave({ phase: "uncertain", event, expectsSecret });
      }
    } catch (saveError) {
      setSave({
        phase: "rejected",
        message: saveError instanceof Error ? saveError.message : String(saveError),
        conflict: false,
      });
    }
  }

  function loadLatest() {
    if (!latest) return;
    setYaml(latest.yaml);
    setBaseRevision(latest.revision);
    setBaseTrigger(latest.validation.ok ? latest.validation.definition.trigger.on : null);
    setSave({ phase: "idle" });
  }

  return (
    <form
      aria-label={workflow ? t("workflows.editorEdit") : t("workflows.editorCreate")}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="buzz-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <h3 className="text-sm font-semibold">
          {workflow ? t("workflows.editorEdit") : t("workflows.editorCreate")}
        </h3>
        <div className="grid gap-1.5">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`${fieldId}-channel`}
          >
            {t("workflows.editorChannel")}
          </label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60"
            disabled={Boolean(workflow) || busy}
            id={`${fieldId}-channel`}
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            {channels.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                #{candidate.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-h-0 flex-1 gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`${fieldId}-yaml`}>
            {t("workflows.editorYaml")}
          </label>
          <textarea
            aria-describedby={`${fieldId}-status`}
            aria-invalid={!validation.ok}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-[18rem] flex-1 resize-y rounded-md border border-input bg-background p-3 font-mono text-[13px] leading-5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={busy}
            id={`${fieldId}-yaml`}
            spellCheck={false}
            value={yaml}
            onChange={(event) => {
              setYaml(event.target.value);
              if (save.phase === "rejected" || save.phase === "notStored")
                setSave({ phase: "idle" });
            }}
          />
        </div>
        <div aria-live="polite" className="grid gap-2 text-xs" id={`${fieldId}-status`}>
          {validation.ok ? (
            <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {t("workflows.editorValid")}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-destructive" role="alert">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{issueText(validation.error)}</span>
            </p>
          )}
          {validation.ok && (validation.warnings.length > 0 || needsElevatedRole) ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-amber-800 dark:text-amber-300">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t("workflows.editorWarnings")}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {needsElevatedRole ? <li>{t("workflows.elevatedRole")}</li> : null}
                {validation.warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.path}`}>{issueText(warning)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {save.phase === "rejected" ? (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive"
              role="alert"
            >
              <p className="font-medium">
                {save.conflict ? t("workflows.conflict") : t("workflows.saveRejected")}
              </p>
              <p className="mt-0.5 break-words">{save.message}</p>
              {save.conflict ? (
                <Button
                  className="mt-2"
                  disabled={!latest || latest.revision === baseRevision}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={loadLatest}
                >
                  <RotateCcw />
                  {t("workflows.reloadLatest")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {save.phase === "uncertain" ? (
            <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
              {t("workflows.saveUncertain")}
            </p>
          ) : null}
          {save.phase === "notStored" ? (
            <p className="text-destructive" role="alert">
              {t("workflows.saveNotStored")}
            </p>
          ) : null}
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
        <Button disabled={save.phase === "saving"} type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!canSave} type="submit">
          {save.phase === "saving" ? <LoaderCircle className="animate-spin" /> : null}
          {save.phase === "saving" ? t("workflows.saving") : t("workflows.save")}
        </Button>
      </footer>
    </form>
  );
}
