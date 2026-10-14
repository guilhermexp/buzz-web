/**
 * Workflow Nostr protocol: kind 30620 definitions (d = workflow UUID,
 * h = channel, content = YAML, `expected-revision` for compare-and-swap
 * updates), kind 5 deletion by `a` coordinate, kind 46020 manual triggers and
 * kind 46030/46031 approval decisions (d = approval_ref). The Relay answers
 * command kinds with `OK … "response:{json}"`.
 */

import {
  validateWorkflowYaml,
  type WorkflowValidation,
} from "@/features/workflows/lib/workflow-schema";
import type { NostrEvent, NostrFilter, RelayPublishResult } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

export const KIND_WORKFLOW_DEFINITION = 30620;
export const KIND_WORKFLOW_TRIGGER = 46020;
export const KIND_APPROVAL_REQUESTED = 46010;
export const KIND_APPROVAL_GRANTED = 46011;
export const KIND_APPROVAL_DENIED = 46012;
export const KIND_APPROVAL_GRANT = 46030;
export const KIND_APPROVAL_DENY = 46031;

/** Channel batch size for definition queries (desktop uses the same bound). */
const CHANNEL_BATCH = 50;

export type WorkflowRecord = {
  id: string;
  /** Event id of the current kind:30620 revision, sent as `expected-revision` on edits. */
  revision: string;
  channelId: string;
  ownerPubkey: string;
  yaml: string;
  updatedAt: number;
  validation: WorkflowValidation;
};

/** Outcome of a write whose delivery may be uncertain. */
export type PublishOutcome =
  | { kind: "accepted"; message: string; event: NostrEvent }
  | { kind: "rejected"; message: string }
  /** The connection failed before the Relay's verdict arrived; state must be re-read. */
  | { kind: "uncertain"; message: string; event: NostrEvent };

/**
 * NIP-01 machine-readable OK prefixes. A failure carrying one of these is the
 * Relay's verdict; anything else (timeout, socket loss) leaves delivery unknown.
 */
const RELAY_VERDICT =
  /^(invalid|forbidden|restricted|error|blocked|rate-limited|pow|auth-required|conflict|duplicate):/i;

function tagValue(event: NostrEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

export function workflowFromEvent(event: NostrEvent): WorkflowRecord | null {
  const id = tagValue(event, "d");
  const channelId = tagValue(event, "h");
  if (event.kind !== KIND_WORKFLOW_DEFINITION || !id || !channelId) return null;
  return {
    id,
    revision: event.id,
    channelId,
    ownerPubkey: event.pubkey,
    yaml: event.content,
    updatedAt: event.created_at,
    validation: validateWorkflowYaml(event.content),
  };
}

/** Latest revision per (owner, workflow id), newest first. */
export function latestWorkflows(events: readonly NostrEvent[]): WorkflowRecord[] {
  const latest: Record<string, WorkflowRecord> = {};
  for (const event of events) {
    const workflow = workflowFromEvent(event);
    if (!workflow) continue;
    const key = `${workflow.ownerPubkey}:${workflow.id}`;
    const previous = latest[key];
    if (
      !previous ||
      workflow.updatedAt > previous.updatedAt ||
      (workflow.updatedAt === previous.updatedAt && workflow.revision > previous.revision)
    ) {
      latest[key] = workflow;
    }
  }
  return Object.values(latest).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function listWorkflows(
  client: BuzzRelayClient,
  channelIds: readonly string[],
): Promise<WorkflowRecord[]> {
  const events: NostrEvent[] = [];
  for (let index = 0; index < channelIds.length; index += CHANNEL_BATCH) {
    const filter: NostrFilter = {
      kinds: [KIND_WORKFLOW_DEFINITION],
      "#h": channelIds.slice(index, index + CHANNEL_BATCH),
      limit: 500,
    };
    events.push(...(await client.query(filter)));
  }
  return latestWorkflows(events);
}

/** Parse the JSON body of an `OK` message of the form `response:{…}`. */
export function commandResponse(message: string): Record<string, unknown> | null {
  if (!message.startsWith("response:")) return null;
  try {
    const value: unknown = JSON.parse(message.slice("response:".length));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isRelayVerdict(message: string): boolean {
  return RELAY_VERDICT.test(message.trim());
}

/** Publish an already-signed event, separating Relay verdicts from lost delivery. */
export async function publishWithOutcome(
  client: BuzzRelayClient,
  event: NostrEvent,
): Promise<PublishOutcome> {
  let result: RelayPublishResult;
  try {
    result = await client.publishSigned(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isRelayVerdict(message)
      ? { kind: "rejected", message }
      : { kind: "uncertain", message, event };
  }
  return { kind: "accepted", message: result.message, event: result.event };
}

export function signWorkflowDefinition(input: {
  workflowId: string;
  channelId: string;
  yaml: string;
  expectedRevision: string | null;
}): Promise<NostrEvent> {
  const tags = [
    ["d", input.workflowId],
    ["h", input.channelId],
  ];
  if (input.expectedRevision) tags.push(["expected-revision", input.expectedRevision]);
  return signNostrEvent(
    { kind: KIND_WORKFLOW_DEFINITION, content: input.yaml, tags },
    { requireActive: true },
  );
}

export function signWorkflowDeletion(ownerPubkey: string, workflowId: string): Promise<NostrEvent> {
  return signNostrEvent(
    {
      kind: 5,
      content: "",
      tags: [["a", `${KIND_WORKFLOW_DEFINITION}:${ownerPubkey}:${workflowId}`]],
    },
    { requireActive: true },
  );
}

/** Manual trigger; `fields` become `{{trigger.<key>}}` webhook fields for the run. */
export function signWorkflowTrigger(
  workflowId: string,
  fields: Readonly<Record<string, unknown>> | null,
): Promise<NostrEvent> {
  return signNostrEvent(
    {
      kind: KIND_WORKFLOW_TRIGGER,
      content: fields && Object.keys(fields).length ? JSON.stringify(fields) : "",
      tags: [["d", workflowId]],
    },
    { requireActive: true },
  );
}

export function signApprovalDecision(
  approvalRef: string,
  decision: "grant" | "deny",
  note: string,
): Promise<NostrEvent> {
  return signNostrEvent(
    {
      kind: decision === "grant" ? KIND_APPROVAL_GRANT : KIND_APPROVAL_DENY,
      content: note.trim(),
      tags: [["d", approvalRef.toLowerCase()]],
    },
    { requireActive: true },
  );
}

/** One-time webhook secret, present only when a save first gives a workflow a webhook trigger. */
export function webhookSecretFrom(message: string): string | null {
  const secret = commandResponse(message)?.webhook_secret;
  return typeof secret === "string" && secret ? secret : null;
}

export function runIdFrom(message: string): string | null {
  const runId = commandResponse(message)?.run_id;
  return typeof runId === "string" && runId ? runId : null;
}

/** Whether a stored revision exists, used to resolve an uncertain definition save. */
export async function revisionStored(client: BuzzRelayClient, eventId: string): Promise<boolean> {
  const events = await client.query({ ids: [eventId], limit: 1 });
  return events.some((event) => event.id === eventId);
}
