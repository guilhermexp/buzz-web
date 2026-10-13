import { type AgentPersona, isPortableAcpCommand } from "@/features/agents/lib/catalog-model";
import { t } from "@/shared/i18n";
import {
  decodeBase64Utf8,
  hasPngMagic,
  PngFormatError,
  pngBodyAvatarDataUrl,
  readPngTextChunk,
} from "./snapshot-png";
import { definitionTextViolation } from "./snapshot-validation";

/**
 * `buzz-agent-snapshot v1`, byte-compatible with desktop `managed_agents/agent_snapshot.rs`
 * (serde camelCase, optional fields omitted when empty). Secrets, ids, owner keys, relay URLs
 * and machine-local commands are excluded by construction.
 */
export const AGENT_SNAPSHOT_FORMAT = "buzz-agent-snapshot";
export const LOCKED_AGENT_SNAPSHOT_FORMAT = "buzz-agent-snapshot-encrypted";
export const AGENT_SNAPSHOT_PNG_KEYWORD = "buzz_agent_snapshot";
export const MAX_AGENT_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_AGENT_SNAPSHOT_PNG_BYTES = 10 * 1024 * 1024;

export type MemoryLevel = "none" | "core" | "everything";

export type AgentSnapshotDefinition = {
  name: string;
  sourceIsBuiltin: boolean;
  systemPrompt?: string;
  runtime?: string;
  acpCommand?: string;
  model?: string;
  provider?: string;
  parallelism?: number;
  sessionPolicy?: "thread";
  respondTo?: string;
  respondToAllowlist?: string[];
  namePool?: string[];
  idleTimeoutSeconds?: number;
  maxTurnDurationSeconds?: number;
};

export type AgentSnapshot = {
  format: typeof AGENT_SNAPSHOT_FORMAT;
  version: 1;
  definition: AgentSnapshotDefinition;
  profile: { displayName: string; about?: string; avatarDataUrl?: string; avatarUrl?: string };
  memory: { level: MemoryLevel; entries?: Array<{ slug: string; body: string }> };
};

export type AgentPersonaDraft = Omit<AgentPersona, "id" | "shared" | "eventId" | "createdAt">;

/** Localized, user-presentable snapshot failure. */
export class SnapshotError extends Error {}

export function snapshotFail(message: string): never {
  throw new SnapshotError(message);
}

type JsonObject = Record<string, unknown>;

function invalid(path: string): never {
  snapshotFail(t("collab.export.snapshot.errorInvalidJson", { detail: path }));
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path);
  return value as JsonObject;
}

function requiredString(source: JsonObject, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") invalid(`${path}.${key}`);
  return value;
}

function optionalString(source: JsonObject, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") invalid(`${path}.${key}`);
  return value;
}

function optionalUnsigned(source: JsonObject, key: string, path: string): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${path}.${key}`);
  }
  return value;
}

function stringList(source: JsonObject, key: string, path: string): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    invalid(`${path}.${key}`);
  }
  return value as string[];
}

/** Parse the format/version header the way desktop's serde probe does, before deeper checks. */
export function readFormatHeader(value: unknown, path = "$"): { format: string; version: number } {
  const source = object(value, path);
  const format = requiredString(source, "format", path);
  const version = optionalUnsigned(source, "version", path);
  if (version === undefined) invalid(`${path}.version`);
  return { format, version };
}

function withOptional<T extends object>(target: T, entries: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

/** Typed parse + desktop `validate_snapshot` + memory-consistency guard. */
export function parseAgentSnapshot(value: unknown, path = "$"): AgentSnapshot {
  const { format, version } = readFormatHeader(value, path);
  if (format !== AGENT_SNAPSHOT_FORMAT) {
    snapshotFail(t("collab.export.snapshot.errorFormat", { format }));
  }
  if (version !== 1) snapshotFail(t("collab.export.snapshot.errorVersion", { version }));
  const source = object(value, path);
  const definitionPath = `${path}.definition`;
  const rawDefinition = object(source.definition, definitionPath);
  const builtin = rawDefinition.sourceIsBuiltin;
  if (builtin !== undefined && typeof builtin !== "boolean") {
    invalid(`${definitionPath}.sourceIsBuiltin`);
  }
  const definition: AgentSnapshotDefinition = withOptional(
    {
      name: requiredString(rawDefinition, "name", definitionPath),
      sourceIsBuiltin: builtin === true,
    },
    {
      systemPrompt: optionalString(rawDefinition, "systemPrompt", definitionPath),
      runtime: optionalString(rawDefinition, "runtime", definitionPath),
      acpCommand: optionalString(rawDefinition, "acpCommand", definitionPath),
      model: optionalString(rawDefinition, "model", definitionPath),
      provider: optionalString(rawDefinition, "provider", definitionPath),
      parallelism: optionalUnsigned(rawDefinition, "parallelism", definitionPath),
      sessionPolicy: rawDefinition.sessionPolicy === "thread" ? "thread" : undefined,
      respondTo: optionalString(rawDefinition, "respondTo", definitionPath),
      respondToAllowlist: stringList(rawDefinition, "respondToAllowlist", definitionPath),
      namePool: stringList(rawDefinition, "namePool", definitionPath),
      idleTimeoutSeconds: optionalUnsigned(rawDefinition, "idleTimeoutSeconds", definitionPath),
      maxTurnDurationSeconds: optionalUnsigned(
        rawDefinition,
        "maxTurnDurationSeconds",
        definitionPath,
      ),
    },
  );
  const profilePath = `${path}.profile`;
  const rawProfile = object(source.profile, profilePath);
  const profile: AgentSnapshot["profile"] = withOptional(
    { displayName: requiredString(rawProfile, "displayName", profilePath) },
    {
      about: optionalString(rawProfile, "about", profilePath),
      avatarDataUrl: optionalString(rawProfile, "avatarDataUrl", profilePath),
      avatarUrl: optionalString(rawProfile, "avatarUrl", profilePath),
    },
  );
  const memoryPath = `${path}.memory`;
  const rawMemory = object(source.memory, memoryPath);
  const level = rawMemory.level;
  if (level !== "none" && level !== "core" && level !== "everything")
    invalid(`${memoryPath}.level`);
  const rawEntries = rawMemory.entries ?? [];
  if (!Array.isArray(rawEntries)) invalid(`${memoryPath}.entries`);
  const entries = rawEntries.map((entry, index) => {
    const entryPath = `${memoryPath}.entries[${index}]`;
    const item = object(entry, entryPath);
    return {
      slug: requiredString(item, "slug", entryPath),
      body: requiredString(item, "body", entryPath),
    };
  });
  const snapshot: AgentSnapshot = {
    format: AGENT_SNAPSHOT_FORMAT,
    version: 1,
    definition,
    profile,
    memory: withOptional({ level }, { entries }),
  };
  validateAgentSnapshot(snapshot);
  return snapshot;
}

function validateAgentSnapshot(snapshot: AgentSnapshot): void {
  const { acpCommand, name, systemPrompt } = snapshot.definition;
  if (acpCommand !== undefined && !isPortableAcpCommand(acpCommand)) {
    snapshotFail(t("collab.export.snapshot.errorAcpCommand"));
  }
  if (!name.trim()) snapshotFail(t("collab.export.snapshot.errorEmptyName"));
  const problem = definitionTextViolation({
    displayName: snapshot.profile.displayName,
    systemPrompt: systemPrompt ?? "",
    description: snapshot.profile.about ?? null,
  });
  if (problem) {
    const field = t(
      problem.field === "displayName"
        ? "collab.export.snapshot.fieldDisplayName"
        : problem.field === "systemPrompt"
          ? "collab.export.snapshot.fieldSystemPrompt"
          : "collab.export.snapshot.fieldDescription",
    );
    const { violation } = problem;
    snapshotFail(
      violation.reason === "required"
        ? t("collab.export.snapshot.errorTextRequired", { field })
        : violation.reason === "tooLong"
          ? t("collab.export.snapshot.errorTextTooLong", { field, max: violation.max })
          : t("collab.export.snapshot.errorTextInvisible", {
              field,
              codePoint: violation.codePoint,
            }),
    );
  }
  if (snapshot.memory.level === "none" && snapshot.memory.entries?.length) {
    snapshotFail(t("collab.export.snapshot.errorMemory"));
  }
}

function trimmedOrUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function agentSnapshotFromPersona(persona: AgentPersona): AgentSnapshot {
  const avatar = trimmedOrUndefined(persona.avatarUrl);
  const inlineAvatar = avatar?.startsWith("data:image/") ? avatar : undefined;
  const snapshot: AgentSnapshot = {
    format: AGENT_SNAPSHOT_FORMAT,
    version: 1,
    definition: withOptional(
      { name: persona.displayName, sourceIsBuiltin: false },
      {
        systemPrompt: persona.systemPrompt || undefined,
        runtime: persona.runtime ?? undefined,
        // Machine-local commands never leave this device (desktop `is_portable_acp_command`).
        acpCommand:
          persona.acpCommand && isPortableAcpCommand(persona.acpCommand)
            ? persona.acpCommand
            : undefined,
        model: persona.model ?? undefined,
        provider: persona.provider ?? undefined,
        // Desktop always records parallelism (definition value, else the instance default of 1).
        parallelism: persona.parallelism ?? 1,
        sessionPolicy: persona.sessionPolicy === "thread" ? "thread" : undefined,
        // Desktop has no "nobody" mode; omitting it imports as desktop's default owner-only.
        respondTo:
          persona.respondTo && persona.respondTo !== "nobody" ? persona.respondTo : undefined,
        respondToAllowlist: persona.respondTo === "nobody" ? [] : [...persona.respondToAllowlist],
        namePool: [...persona.namePool],
      },
    ),
    profile: withOptional(
      { displayName: persona.displayName },
      {
        about: trimmedOrUndefined(persona.description),
        avatarDataUrl: inlineAvatar,
        avatarUrl: inlineAvatar ? undefined : avatar,
      },
    ),
    memory: { level: "none" },
  };
  validateAgentSnapshot(snapshot);
  return snapshot;
}

/** Desktop `resolve_snapshot_import_behavior` with the default "clear allowlist" choice. */
function importedRespondTo(
  definition: AgentSnapshotDefinition,
): Pick<AgentPersonaDraft, "respondTo" | "respondToAllowlist"> {
  const allowlist = definition.respondToAllowlist ?? [];
  for (const entry of allowlist) {
    if (!/^[0-9a-fA-F]{64}$/.test(entry.trim())) {
      snapshotFail(t("collab.export.snapshot.errorAllowlistPubkey"));
    }
  }
  const mode = definition.respondTo;
  if (mode !== undefined && mode !== "owner-only" && mode !== "allowlist" && mode !== "anyone") {
    snapshotFail(t("collab.export.snapshot.errorRespondTo", { value: mode }));
  }
  if (mode === "allowlist" && allowlist.length === 0) {
    snapshotFail(t("collab.export.snapshot.errorAllowlistEmpty"));
  }
  // Allowlisted pubkeys belong to the source environment, so they are cleared on import.
  return {
    respondTo: mode === "allowlist" ? "owner-only" : (mode ?? null),
    respondToAllowlist: [],
  };
}

export function personaDraftFromAgentSnapshot(s: AgentSnapshot): AgentPersonaDraft {
  const about = s.profile.about?.trim();
  return {
    displayName: s.profile.displayName.trim(),
    systemPrompt: s.definition.systemPrompt ?? "",
    description: about ? about : null,
    avatarUrl: s.profile.avatarDataUrl ?? s.profile.avatarUrl ?? null,
    runtime: s.definition.runtime ?? null,
    acpCommand: s.definition.acpCommand ?? null,
    model: s.definition.model ?? null,
    provider: s.definition.provider ?? null,
    namePool: [...(s.definition.namePool ?? [])],
    ...importedRespondTo(s.definition),
    parallelism: s.definition.parallelism ?? null,
    sessionPolicy: s.definition.sessionPolicy === "thread" ? "thread" : "channel",
  };
}

/** Desktop `slugify(name, fallback, 50)`. */
export function snapshotSlug(name: string, fallback: string): string {
  const raw = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+|-+$/g, "");
  return (raw || fallback).slice(0, 50).replace(/-+$/g, "");
}

export type SnapshotPayload = { json: unknown; png: Uint8Array | null };

/** Read a `.json` or desktop PNG card into parsed JSON, enforcing the per-kind size caps. */
export async function readSnapshotPayload(
  file: File,
  keyword: string,
  caps: { json: number; png: number },
): Promise<SnapshotPayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = hasPngMagic(bytes);
  const cap = png ? caps.png : caps.json;
  if (bytes.length > cap) {
    snapshotFail(t("collab.export.snapshot.errorTooLarge", { limit: cap / (1024 * 1024) }));
  }
  let text: string;
  if (png) {
    try {
      const chunk = readPngTextChunk(bytes, keyword);
      if (chunk === null) snapshotFail(t("collab.export.snapshot.errorPngNoChunk"));
      text = decodeBase64Utf8(chunk);
    } catch (error) {
      if (error instanceof PngFormatError) snapshotFail(t("collab.export.snapshot.errorPng"));
      throw error;
    }
  } else {
    text = new TextDecoder().decode(bytes);
  }
  try {
    return { json: JSON.parse(text) as unknown, png: png ? bytes : null };
  } catch {
    if (!png && bytes[0] === 0x50 && bytes[1] === 0x4b) return { json: null, png: null };
    return invalid("$");
  }
}

export function agentSnapshotFromPayload({ json, png }: SnapshotPayload): AgentSnapshot {
  const format = (json as JsonObject | null)?.format;
  if (format === LOCKED_AGENT_SNAPSHOT_FORMAT)
    snapshotFail(t("collab.export.snapshot.errorLocked"));
  if (typeof format !== "string") snapshotFail(t("collab.export.snapshot.errorNoFormat"));
  const snapshot = parseAgentSnapshot(json);
  if (png && !snapshot.profile.avatarDataUrl) {
    let avatar: string | null = null;
    try {
      avatar = pngBodyAvatarDataUrl(png);
    } catch {
      snapshotFail(t("collab.export.snapshot.errorPng"));
    }
    if (avatar) snapshot.profile.avatarDataUrl = avatar;
  }
  return snapshot;
}

export async function readAgentSnapshotFile(file: File): Promise<AgentSnapshot> {
  const payload = await readSnapshotPayload(file, AGENT_SNAPSHOT_PNG_KEYWORD, {
    json: MAX_AGENT_SNAPSHOT_JSON_BYTES,
    png: MAX_AGENT_SNAPSHOT_PNG_BYTES,
  });
  return agentSnapshotFromPayload(payload);
}
