import { parseDocument, stringify } from "yaml";
import type { WorkflowRun } from "@/features/workflows/lib/workflow-http";
import type {
  WorkflowIssue,
  WorkflowStep,
  WorkflowTrigger,
} from "@/features/workflows/lib/workflow-schema";
import { getLocale, type MessageKey, t } from "@/shared/i18n";

export function issueText(issue: WorkflowIssue): string {
  const message = t(`workflows.issue.${issue.code}` as MessageKey, issue.params);
  const location = [issue.path, issue.line ? t("workflows.issueLine", { line: issue.line }) : ""]
    .filter(Boolean)
    .join(", ");
  return location ? t("workflows.issueAt", { location, message }) : message;
}

export function triggerSummary(trigger: WorkflowTrigger): string {
  if (trigger.on === "schedule") {
    return trigger.cron !== null
      ? t("workflows.triggerSummary.cron", { cron: trigger.cron })
      : t("workflows.triggerSummary.interval", { interval: trigger.interval ?? "" });
  }
  if (trigger.on === "reaction_added" && trigger.emoji) {
    return t("workflows.triggerSummary.reactionEmoji", { emoji: trigger.emoji });
  }
  return t(`workflows.triggerSummary.${trigger.on}`);
}

/** One-line description of what a step does, from its authored fields. */
export function stepDetail(step: WorkflowStep, approverLabel: (spec: string) => string): string {
  const field = (name: string) => {
    const value = step.fields[name];
    return typeof value === "string" ? value : "";
  };
  switch (step.action) {
    case "send_message":
    case "send_dm":
      return field("text");
    case "set_channel_topic":
      return field("topic");
    case "add_reaction":
      return `:${field("emoji")}:`;
    case "call_webhook":
      return `${field("method") || "POST"} ${field("url")}`;
    case "request_approval":
      return t("workflows.stepApproval", {
        approver: approverLabel(field("from")),
        timeout: field("timeout") || "24h",
      });
    case "delay":
      return t("workflows.stepDelay", { duration: field("duration") });
  }
}

export function runStatusLabel(status: WorkflowRun["status"]): string {
  return t(`workflows.runStatus.${status}`);
}

const STEP_STATUSES = [
  "completed",
  "skipped",
  "dispatching",
  "waiting_approval",
  "denied",
  "expired",
];

export function stepStatusLabel(status: string): string {
  return STEP_STATUSES.includes(status)
    ? t(`workflows.stepStatus.${status}` as MessageKey)
    : status;
}

const KNOWN_RUN_ERRORS = [
  "approval_denied",
  "approval_expired",
  "owner_unauthorized",
  "action_not_implemented",
  "step_timeout",
  "webhook_failed",
];

/** Localized cause plus the Relay's own diagnostic, when it recorded one. */
export function runErrorText(run: WorkflowRun): string | null {
  if (!run.errorCode && !run.errorMessage) return null;
  const cause = run.errorCode
    ? KNOWN_RUN_ERRORS.includes(run.errorCode)
      ? t(`workflows.runError.${run.errorCode}` as MessageKey)
      : t("workflows.runError.other", { code: run.errorCode })
    : null;
  return [cause, run.errorMessage?.trim() || null].filter(Boolean).join(" ");
}

export function formatTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "medium" }).format(
    unixSeconds * 1_000,
  );
}

/** Starter definition: a webhook-triggered run gated by an approval. */
export function workflowTemplate(): string {
  return stringify({
    name: t("workflows.template.name"),
    trigger: { on: "webhook" },
    steps: [
      { id: "before", action: "send_message", text: t("workflows.template.before") },
      {
        id: "gate",
        action: "request_approval",
        from: "any",
        message: t("workflows.template.message"),
        timeout: "24h",
      },
      { id: "after", action: "send_message", text: t("workflows.template.after") },
    ],
  });
}

/** Set `enabled` while keeping the author's formatting and comments. */
export function yamlWithEnabled(source: string, enabled: boolean): string | null {
  const document = parseDocument(source, { uniqueKeys: false });
  if (document.errors.length) return null;
  document.set("enabled", enabled);
  return document.toString();
}
