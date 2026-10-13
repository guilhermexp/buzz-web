/**
 * Workflow definition parsing and validation with the same acceptance rules as
 * the Relay (`buzz_workflow::schema::parse_yaml`: serde deserialization of
 * `WorkflowDef` followed by `WorkflowDef::validate`). The first failure is
 * reported, as on the Relay. Warnings flag definitions the Relay stores but
 * whose runs are known to fail at execution time.
 */
import { decode } from "nostr-tools/nip19";
import { isValidCron } from "@/features/workflows/lib/cron";
import {
  contentKind,
  isDirectNone,
  parseUnsignedInt,
  parseYamlDocument,
  plainBool,
  type YamlValue,
} from "@/features/workflows/lib/yaml-serde";

export const TRIGGER_TYPES = [
  "message_posted",
  "reaction_added",
  "diff_posted",
  "schedule",
  "webhook",
] as const;
export const ACTION_TYPES = [
  "send_message",
  "send_dm",
  "set_channel_topic",
  "add_reaction",
  "call_webhook",
  "request_approval",
  "delay",
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

export type WorkflowTrigger = {
  on: TriggerType;
  filter: string | null;
  emoji: string | null;
  cron: string | null;
  interval: string | null;
};

export type WorkflowStep = {
  id: string;
  name: string | null;
  if: string | null;
  timeoutSecs: number | null;
  action: ActionType;
  fields: Readonly<Record<string, string | boolean | Record<string, string> | null>>;
};

export type WorkflowDefinition = {
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  enabled: boolean;
};

export type WorkflowIssueCode =
  | "yaml_syntax"
  | "multiple_documents"
  | "invalid_type"
  | "missing_field"
  | "duplicate_field"
  | "unknown_variant"
  | "name_empty"
  | "steps_empty"
  | "step_id_empty"
  | "step_id_invalid"
  | "step_id_duplicate"
  | "reply_in_thread_trigger"
  | "schedule_missing"
  | "schedule_both"
  | "cron_invalid"
  | "interval_invalid"
  | "interval_too_short"
  | "action_not_implemented"
  | "reaction_needs_message"
  | "approver_invalid"
  | "approval_timeout_invalid"
  | "delay_invalid"
  | "delay_too_long";

export type WorkflowIssue = {
  code: WorkflowIssueCode;
  /** Location such as `steps[1].text`; empty for the document root. */
  path: string;
  line: number | null;
  params: Readonly<Record<string, string>>;
};

export type WorkflowValidation =
  | { ok: true; definition: WorkflowDefinition; warnings: WorkflowIssue[] }
  | { ok: false; error: WorkflowIssue };

type FieldType = "string" | "optString" | "bool" | "optStringMap";
type VariantSpec = { fields: Readonly<Record<string, FieldType>>; required: readonly string[] };

const TRIGGER_SPECS: Record<TriggerType, VariantSpec> = {
  message_posted: { fields: { filter: "optString" }, required: [] },
  reaction_added: { fields: { emoji: "optString", filter: "optString" }, required: [] },
  diff_posted: { fields: { filter: "optString" }, required: [] },
  schedule: { fields: { cron: "optString", interval: "optString" }, required: [] },
  webhook: { fields: {}, required: [] },
};

const ACTION_SPECS: Record<ActionType, VariantSpec> = {
  send_message: {
    fields: { text: "string", channel: "optString", reply_in_thread: "bool" },
    required: ["text"],
  },
  send_dm: { fields: { to: "string", text: "string" }, required: ["to", "text"] },
  set_channel_topic: { fields: { topic: "string" }, required: ["topic"] },
  add_reaction: { fields: { emoji: "string" }, required: ["emoji"] },
  call_webhook: {
    fields: { url: "string", method: "optString", headers: "optStringMap", body: "optString" },
    required: ["url"],
  },
  request_approval: {
    fields: { from: "string", message: "string", timeout: "optString" },
    required: ["from", "message"],
  },
  delay: { fields: { duration: "string" }, required: ["duration"] },
};

const MESSAGE_TRIGGERS: readonly TriggerType[] = [
  "message_posted",
  "reaction_added",
  "diff_posted",
];
const MAX_APPROVAL_TIMEOUT_SECS = 30n * 24n * 60n * 60n;
const MAX_DELAY_SECS = 270n;
const U64_MAX = (1n << 64n) - 1n;

class SchemaFailure extends Error {
  constructor(readonly issue: WorkflowIssue) {
    super(issue.code);
  }
}

function issue(
  code: WorkflowIssueCode,
  path: string,
  line: number | null,
  params: Record<string, string> = {},
): WorkflowIssue {
  return { code, path, line, params };
}

function fail(
  code: WorkflowIssueCode,
  path: string,
  value: YamlValue | null,
  params: Record<string, string> = {},
): never {
  throw new SchemaFailure(issue(code, path, value?.line ?? null, params));
}

function invalidType(path: string, value: YamlValue, expected: string): never {
  return fail("invalid_type", path, value, { found: contentKind(value), expected });
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Direct `deserialize_str`: any scalar text, including null spellings. */
function directString(value: YamlValue, path: string): string {
  if (value.kind !== "scalar") return invalidType(path, value, "string");
  return value.text;
}

function directOptionString(value: YamlValue, path: string): string | null {
  return isDirectNone(value) ? null : directString(value, path);
}

/** A strictly typed field decoded from serde's buffered `Content`. */
function contentField(value: YamlValue, type: FieldType, path: string) {
  const kind = contentKind(value);
  if (type === "bool") {
    if (kind !== "bool" || value.kind !== "scalar") return invalidType(path, value, "boolean");
    return plainBool(value) ?? false;
  }
  if ((type === "optString" || type === "optStringMap") && kind === "unit") return null;
  if (type === "optStringMap") {
    if (value.kind !== "map") return invalidType(path, value, "map");
    const headers: Record<string, string> = {};
    for (const [key, entry] of value.entries) {
      if (contentKind(key) !== "string" || key.kind !== "scalar") {
        return invalidType(path, key, "string");
      }
      if (contentKind(entry) !== "string" || entry.kind !== "scalar") {
        return invalidType(join(path, key.text), entry, "string");
      }
      headers[key.text] = entry.text;
    }
    return headers;
  }
  if (kind !== "string" || value.kind !== "scalar") return invalidType(path, value, "string");
  return value.text;
}

/** Decode a variant's struct fields from buffered entries (`ContentDeserializer`). */
function variantFields(
  spec: VariantSpec,
  entries: ReadonlyArray<[string, YamlValue]>,
  path: string,
  container: YamlValue,
): Record<string, string | boolean | Record<string, string> | null> {
  const fields: Record<string, string | boolean | Record<string, string> | null> = {};
  const seen: Record<string, true> = {};
  for (const [key, value] of entries) {
    const type = spec.fields[key];
    if (!type) continue;
    if (seen[key]) fail("duplicate_field", path, value, { field: key });
    seen[key] = true;
    fields[key] = contentField(value, type, join(path, key));
  }
  for (const required of spec.required) {
    if (!seen[required]) fail("missing_field", path, container, { field: required });
  }
  for (const [key, type] of Object.entries(spec.fields)) {
    if (!seen[key]) fields[key] = type === "bool" ? false : null;
  }
  return fields;
}

function deserializeTrigger(value: YamlValue): WorkflowTrigger {
  const path = "trigger";
  if (value.kind !== "map") return invalidType(path, value, "trigger");
  let tag: string | null = null;
  const entries: Array<[string, YamlValue]> = [];
  for (const [key, entry] of value.entries) {
    // Map keys are identifiers, read through `deserialize_str`.
    const name = directString(key, path);
    if (name === "on") {
      if (tag !== null) fail("duplicate_field", path, key, { field: "on" });
      tag = directString(entry, join(path, "on"));
    } else {
      entries.push([name, entry]);
    }
  }
  if (tag === null) return fail("missing_field", path, value, { field: "on" });
  const type = TRIGGER_TYPES.find((candidate) => candidate === tag);
  if (!type) {
    return fail("unknown_variant", join(path, "on"), value, {
      value: tag,
      expected: TRIGGER_TYPES.join(", "),
    });
  }
  const fields = variantFields(TRIGGER_SPECS[type], entries, path, value);
  return {
    on: type,
    filter: typeof fields.filter === "string" ? fields.filter : null,
    emoji: typeof fields.emoji === "string" ? fields.emoji : null,
    cron: typeof fields.cron === "string" ? fields.cron : null,
    interval: typeof fields.interval === "string" ? fields.interval : null,
  };
}

/** Internally tagged `action` read from flattened `Content`: name, or variant index. */
function actionType(value: YamlValue, path: string): ActionType {
  const kind = contentKind(value);
  if (value.kind === "scalar" && kind === "string") {
    const type = ACTION_TYPES.find((candidate) => candidate === value.text);
    if (type) return type;
    return fail("unknown_variant", path, value, {
      value: value.text,
      expected: ACTION_TYPES.join(", "),
    });
  }
  if (value.kind === "scalar" && kind === "integer") {
    const index = parseUnsignedInt(value.text);
    const type =
      index !== null && index < BigInt(ACTION_TYPES.length) ? ACTION_TYPES[Number(index)] : null;
    if (type) return type;
    return fail("unknown_variant", path, value, {
      value: value.text,
      expected: ACTION_TYPES.join(", "),
    });
  }
  return invalidType(path, value, "string");
}

function deserializeStep(value: YamlValue, path: string): WorkflowStep {
  if (value.kind !== "map") return invalidType(path, value, "step");
  const step: Partial<Omit<WorkflowStep, "action" | "fields">> = {};
  const seen: Record<string, true> = {};
  const rest: Array<[string, YamlValue]> = [];
  for (const [key, entry] of value.entries) {
    const name = directString(key, path);
    const known = name === "id" || name === "name" || name === "if" || name === "timeout_secs";
    if (!known) {
      rest.push([name, entry]);
      continue;
    }
    if (seen[name]) fail("duplicate_field", path, key, { field: name });
    seen[name] = true;
    const fieldPath = join(path, name);
    if (name === "id") step.id = directString(entry, fieldPath);
    else if (name === "name") step.name = directOptionString(entry, fieldPath);
    else if (name === "if") step.if = directOptionString(entry, fieldPath);
    else if (isDirectNone(entry)) step.timeoutSecs = null;
    else {
      const seconds = entry.kind === "scalar" && entry.plain ? parseUnsignedInt(entry.text) : null;
      if (seconds === null) invalidType(fieldPath, entry, "u64");
      step.timeoutSecs = Number(seconds);
    }
  }
  if (step.id === undefined) fail("missing_field", path, value, { field: "id" });
  const tags = rest.filter(([key]) => key === "action");
  if (tags.length > 1) fail("duplicate_field", path, tags[1]?.[1] ?? value, { field: "action" });
  const tag = tags[0];
  if (!tag) return fail("missing_field", path, value, { field: "action" });
  const action = actionType(tag[1], join(path, "action"));
  const fields = variantFields(
    ACTION_SPECS[action],
    rest.filter(([key]) => key !== "action"),
    path,
    value,
  );
  return {
    id: step.id,
    name: step.name ?? null,
    if: step.if ?? null,
    timeoutSecs: step.timeoutSecs ?? null,
    action,
    fields,
  };
}

function deserializeDefinition(root: YamlValue | null): WorkflowDefinition {
  if (root === null) return fail("missing_field", "", null, { field: "name" });
  if (root.kind !== "map") return invalidType("", root, "workflow");
  const definition: Partial<WorkflowDefinition> = {};
  const seen: Record<string, true> = {};
  for (const [key, value] of root.entries) {
    const name = directString(key, "");
    if (!["name", "description", "trigger", "steps", "enabled"].includes(name)) continue;
    if (seen[name]) fail("duplicate_field", "", key, { field: name });
    seen[name] = true;
    if (name === "name") definition.name = directString(value, name);
    else if (name === "description") definition.description = directOptionString(value, name);
    else if (name === "trigger") definition.trigger = deserializeTrigger(value);
    else if (name === "enabled") {
      const enabled = plainBool(value);
      if (enabled === null) invalidType(name, value, "boolean");
      definition.enabled = enabled;
    } else if (value.kind === "seq") {
      definition.steps = value.items.map((item, index) => deserializeStep(item, `steps[${index}]`));
    } else if (value.kind === "scalar" && value.plain && value.text === "") {
      definition.steps = [];
    } else {
      invalidType(name, value, "sequence");
    }
  }
  const { name, trigger, steps } = definition;
  if (name === undefined) return fail("missing_field", "", root, { field: "name" });
  if (trigger === undefined) return fail("missing_field", "", root, { field: "trigger" });
  if (steps === undefined) return fail("missing_field", "", root, { field: "steps" });
  return {
    name,
    description: definition.description ?? null,
    trigger,
    steps,
    enabled: definition.enabled ?? true,
  };
}

/** `parse_duration_secs`: `<n>h`, `<n>m`, `<n>s` or plain seconds as u64. */
export function parseDurationSecs(input: string): bigint | null {
  const duration = input.trim();
  for (const [suffix, multiplier] of [
    ["h", 3600n],
    ["m", 60n],
    ["s", 1n],
  ] as const) {
    if (!duration.endsWith(suffix)) continue;
    const amount = rustU64(duration.slice(0, -1).trim());
    if (amount === null) return null;
    const seconds = amount * multiplier;
    return seconds <= U64_MAX ? seconds : null;
  }
  return rustU64(duration);
}

/** Rust `str::parse::<u64>`: optional `+`, ASCII digits, no overflow. */
function rustU64(text: string): bigint | null {
  if (!/^\+?[0-9]+$/.test(text)) return null;
  const value = BigInt(text.replace(/^\+/, ""));
  return value <= U64_MAX ? value : null;
}

function validateDefinition(definition: WorkflowDefinition): WorkflowIssue | null {
  if (definition.name.trim() === "") return issue("name_empty", "name", null);
  if (definition.steps.length === 0) return issue("steps_empty", "steps", null);
  const seen: Record<string, true> = {};
  for (const [index, step] of definition.steps.entries()) {
    const path = `steps[${index}].id`;
    if (step.id.trim() === "") return issue("step_id_empty", path, null);
    if (step.id.length > 64 || !/^[A-Za-z0-9_]+$/.test(step.id)) {
      return issue("step_id_invalid", path, null, { id: step.id });
    }
    if (seen[step.id]) return issue("step_id_duplicate", path, null, { id: step.id });
    seen[step.id] = true;
  }
  if (!MESSAGE_TRIGGERS.includes(definition.trigger.on)) {
    for (const [index, step] of definition.steps.entries()) {
      if (step.action === "send_message" && step.fields.reply_in_thread === true) {
        return issue("reply_in_thread_trigger", `steps[${index}].reply_in_thread`, null, {
          step: step.id,
        });
      }
    }
  }
  const { trigger } = definition;
  if (trigger.on === "schedule") {
    if (trigger.cron === null && trigger.interval === null) {
      return issue("schedule_missing", "trigger", null);
    }
    if (trigger.cron !== null && trigger.interval !== null) {
      return issue("schedule_both", "trigger", null);
    }
    if (trigger.cron !== null && !isValidCron(trigger.cron)) {
      return issue("cron_invalid", "trigger.cron", null, { cron: trigger.cron });
    }
    if (trigger.interval !== null) {
      const seconds = parseDurationSecs(trigger.interval);
      if (seconds === null) {
        return issue("interval_invalid", "trigger.interval", null, { interval: trigger.interval });
      }
      if (seconds < 60n) return issue("interval_too_short", "trigger.interval", null);
    }
  }
  return null;
}

function isTemplated(value: string): boolean {
  return value.includes("{{");
}

/** `normalize_approver_spec`: hex pubkey, npub, or `any`. */
function validApprover(from: string): boolean {
  const spec = from.trim();
  if (spec.toLowerCase() === "any" || /^[0-9a-fA-F]{64}$/.test(spec)) return true;
  if (!spec.startsWith("npub1")) return false;
  try {
    return decode(spec).type === "npub";
  } catch {
    return false;
  }
}

function executionWarnings(definition: WorkflowDefinition): WorkflowIssue[] {
  const warnings: WorkflowIssue[] = [];
  for (const [index, step] of definition.steps.entries()) {
    const path = `steps[${index}]`;
    const params = { step: step.id };
    if (step.action === "send_dm" || step.action === "set_channel_topic") {
      warnings.push(
        issue("action_not_implemented", path, null, { ...params, action: step.action }),
      );
    }
    if (step.action === "add_reaction" && !MESSAGE_TRIGGERS.includes(definition.trigger.on)) {
      warnings.push(issue("reaction_needs_message", path, null, params));
    }
    if (step.action === "request_approval") {
      const from = String(step.fields.from ?? "");
      if (!isTemplated(from) && !validApprover(from)) {
        warnings.push(issue("approver_invalid", `${path}.from`, null, params));
      }
      const timeout = typeof step.fields.timeout === "string" ? step.fields.timeout : "24h";
      const seconds = isTemplated(timeout) ? 1n : parseDurationSecs(timeout);
      if (seconds === null || seconds === 0n || seconds > MAX_APPROVAL_TIMEOUT_SECS) {
        warnings.push(issue("approval_timeout_invalid", `${path}.timeout`, null, params));
      }
    }
    if (step.action === "delay") {
      const duration = String(step.fields.duration ?? "");
      const seconds = isTemplated(duration) ? 0n : parseDurationSecs(duration);
      if (seconds === null) warnings.push(issue("delay_invalid", `${path}.duration`, null, params));
      else if (seconds > MAX_DELAY_SECS) {
        warnings.push(issue("delay_too_long", `${path}.duration`, null, params));
      }
    }
  }
  return warnings;
}

/** Validate workflow YAML exactly as the Relay's `parse_yaml` would. */
export function validateWorkflowYaml(source: string): WorkflowValidation {
  const parsed = parseYamlDocument(source);
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        parsed.reason === "multiple_documents"
          ? issue("multiple_documents", "", null)
          : issue("yaml_syntax", "", parsed.line, { detail: parsed.detail }),
    };
  }
  try {
    const definition = deserializeDefinition(parsed.root);
    const invalid = validateDefinition(definition);
    if (invalid) return { ok: false, error: invalid };
    return { ok: true, definition, warnings: executionWarnings(definition) };
  } catch (error) {
    if (error instanceof SchemaFailure) return { ok: false, error: error.issue };
    throw error;
  }
}
