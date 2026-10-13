/**
 * Authorized reads of the Relay's workflow execution records. Runs and
 * approvals are Relay database rows (not Nostr events) exposed through
 * NIP-98-signed `GET /workflows/{id}/runs` and
 * `GET /workflows/{id}/runs/{run_id}/approvals`.
 */
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowTraceEntry = {
  stepId: string;
  /** completed | skipped | dispatching | waiting_approval | denied | expired */
  status: string;
  output: Record<string, unknown> | null;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentStep: number | null;
  executionTrace: WorkflowTraceEntry[];
  startedAt: number | null;
  completedAt: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
};

export type WorkflowApprovalStatus = "pending" | "granted" | "denied" | "expired";

export type WorkflowApproval = {
  approvalRef: string;
  workflowId: string;
  runId: string;
  stepId: string;
  stepIndex: number;
  /** Lowercase hex pubkey of the designated approver, or `any` channel member. */
  approverSpec: string;
  status: WorkflowApprovalStatus;
  approverPubkey: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: number;
};

export type WorkflowRunPage = {
  runs: WorkflowRun[];
  /** Keyset cursor: the last run's RFC 3339 `created_at` and id. */
  next: { before: string; beforeId: string } | null;
};

const RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "pending",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
];
const APPROVAL_STATUSES: readonly WorkflowApprovalStatus[] = [
  "pending",
  "granted",
  "denied",
  "expired",
];
/** Bound for `readWorkflowRun` paging (100 runs per page). */
const MAX_RUN_PAGES = 10;

export class WorkflowHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTraceEntry(value: unknown): WorkflowTraceEntry | null {
  const entry = record(value);
  const stepId = text(entry?.step_id);
  const status = text(entry?.status);
  if (!entry || !stepId || !status) return null;
  return { stepId, status, output: record(entry.output) };
}

export function parseWorkflowRun(value: unknown): WorkflowRun | null {
  const raw = record(value);
  const id = text(raw?.id);
  const workflowId = text(raw?.workflow_id);
  const status = RUN_STATUSES.find((candidate) => candidate === raw?.status);
  const createdAt = integer(raw?.created_at);
  if (!raw || !id || !workflowId || !status || createdAt === null) return null;
  const trace = Array.isArray(raw.execution_trace) ? raw.execution_trace : [];
  return {
    id,
    workflowId,
    status,
    currentStep: integer(raw.current_step),
    executionTrace: trace
      .map(parseTraceEntry)
      .filter((entry): entry is WorkflowTraceEntry => entry !== null),
    startedAt: integer(raw.started_at),
    completedAt: integer(raw.completed_at),
    errorCode: text(raw.error_code),
    errorMessage: text(raw.error_message),
    createdAt,
  };
}

export function parseWorkflowApproval(value: unknown): WorkflowApproval | null {
  const raw = record(value);
  const approvalRef = text(raw?.approval_ref);
  const workflowId = text(raw?.workflow_id);
  const runId = text(raw?.run_id);
  const stepId = text(raw?.step_id);
  const approverSpec = text(raw?.approver_spec);
  const expiresAt = text(raw?.expires_at);
  const status = APPROVAL_STATUSES.find((candidate) => candidate === raw?.status);
  if (!raw || !approvalRef || !workflowId || !runId || !stepId || !status || !expiresAt) {
    return null;
  }
  return {
    approvalRef,
    workflowId,
    runId,
    stepId,
    stepIndex: integer(raw.step_index) ?? 0,
    approverSpec: approverSpec ?? "any",
    status,
    approverPubkey: text(raw.approver_pubkey),
    note: text(raw.note),
    expiresAt,
    createdAt: integer(raw.created_at) ?? 0,
  };
}

/**
 * Signed GET. Each request carries a fresh `nonce` so concurrent reads of the
 * same URL within one second never collide with the Relay's NIP-98 replay guard.
 */
async function signedGet(relayUrl: string, path: string): Promise<unknown> {
  const url = `${relayHttpOrigin(relayUrl)}${path}`;
  const auth = await signNostrEvent(
    {
      kind: 27235,
      content: "",
      tags: [
        ["u", url],
        ["method", "GET"],
        ["nonce", crypto.randomUUID()],
      ],
    },
    { requireActive: true },
  );
  const response = await fetch(url, {
    headers: { Authorization: `Nostr ${btoa(JSON.stringify(auth))}` },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = text(record(body)?.error) ?? text(record(record(body)?.error)?.message);
    throw new WorkflowHttpError(
      response.status,
      detail
        ? t("workflows.http.failedDetail", {
            status: response.status,
            detail: detail.slice(0, 300),
          })
        : t("workflows.http.failed", { status: response.status }),
    );
  }
  return body;
}

/** One page of a workflow's runs, newest first. */
export async function readWorkflowRuns(
  relayUrl: string,
  workflowId: string,
  options: { limit?: number; before?: { before: string; beforeId: string } } = {},
): Promise<WorkflowRunPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.before) {
    query.set("before", options.before.before);
    query.set("before_id", options.before.beforeId);
  }
  const body = record(
    await signedGet(relayUrl, `/workflows/${encodeURIComponent(workflowId)}/runs?${query}`),
  );
  const runs = (Array.isArray(body?.runs) ? body.runs : [])
    .map(parseWorkflowRun)
    .filter((run): run is WorkflowRun => run !== null);
  const next = record(body?.next);
  const before = text(next?.before);
  const beforeId = text(next?.before_id);
  return { runs, next: before && beforeId ? { before, beforeId } : null };
}

/** The current durable record of one run, or `null` when the Relay has none visible. */
export async function readWorkflowRun(
  relayUrl: string,
  workflowId: string,
  runId: string,
): Promise<WorkflowRun | null> {
  let before: WorkflowRunPage["next"] = null;
  for (let page = 0; page < MAX_RUN_PAGES; page += 1) {
    const result = await readWorkflowRuns(relayUrl, workflowId, {
      limit: 100,
      before: before ?? undefined,
    });
    const run = result.runs.find((candidate) => candidate.id === runId);
    if (run) return run;
    if (!result.next) return null;
    before = result.next;
  }
  return null;
}

export async function readRunApprovals(
  relayUrl: string,
  workflowId: string,
  runId: string,
): Promise<WorkflowApproval[]> {
  const body = record(
    await signedGet(
      relayUrl,
      `/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/approvals`,
    ),
  );
  return (Array.isArray(body?.approvals) ? body.approvals : [])
    .map(parseWorkflowApproval)
    .filter((approval): approval is WorkflowApproval => approval !== null);
}
