import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyEvent } from "nostr-tools/pure";
import { isRecord } from "@/features/agents/lib/guards";
import type { NostrEvent } from "@/shared/api/nostr-types";
import { t } from "@/shared/i18n";

export const PERSONA_KIND = 30175;
export const TEAM_KIND = 30176;
export const TEAM_CATALOG_KIND = 30178;
export const PERSONA_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TEAM_MEMBERS = 64;
const MAX_TEAM_CATALOG_BYTES = 192 * 1024;

export type PersonaRespondTo = "owner-only" | "allowlist" | "anyone" | "nobody";
export type SessionPolicy = "channel" | "thread";

export type AgentPersona = {
  id: string;
  displayName: string;
  systemPrompt: string;
  description: string | null;
  avatarUrl: string | null;
  runtime: string | null;
  /** ACP transport command selected alongside the runtime (desktop `acp_command`). */
  acpCommand: string | null;
  model: string | null;
  provider: string | null;
  namePool: string[];
  respondTo: PersonaRespondTo | null;
  respondToAllowlist: string[];
  parallelism: number | null;
  sessionPolicy: SessionPolicy;
  shared: boolean;
  eventId: string | null;
  createdAt: number;
};

export type AgentTeam = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  personaIds: string[];
  shared: boolean;
  eventId: string | null;
  createdAt: number;
};

/** A member as embedded in a shared 30178 projection (what foreign readers see). */
export type TeamCatalogMember = {
  memberKey: string;
  displayName: string;
  systemPrompt: string | null;
  avatarUrl: string | null;
  runtime: string | null;
  acpCommand: string | null;
  model: string | null;
  provider: string | null;
  namePool: string[];
  respondTo: PersonaRespondTo | null;
  parallelism: number | null;
  sessionPolicy: SessionPolicy;
};

export type TeamCatalogEntry = {
  ownerPubkey: string;
  id: string;
  eventId: string;
  createdAt: number;
  name: string;
  description: string | null;
  instructions: string | null;
  members: TeamCatalogMember[];
};

const RESPOND_TO: readonly PersonaRespondTo[] = ["owner-only", "allowlist", "anyone", "nobody"];

/** The relay's exact share predicate: one tag, exactly two elements, value "true". */
export function isSharedEvent(event: NostrEvent): boolean {
  const shared = event.tags.filter((tag) => tag[0] === "shared");
  return shared.length === 1 && shared[0]?.length === 2 && shared[0][1] === "true";
}

export function dTagOf(event: NostrEvent): string | null {
  const tags = event.tags.filter((tag) => tag[0] === "d");
  return tags.length === 1 && tags[0]?.[1] ? tags[0][1] : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function respondTo(value: unknown): PersonaRespondTo | null {
  return RESPOND_TO.find((mode) => mode === value) ?? null;
}

function parallelism(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(32, Math.max(1, value))
    : null;
}

/** Slug a display name into a NIP-AP persona d tag, mirroring desktop `normalize_d_tag`. */
export function personaSlug(raw: string): string {
  let slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!/^[a-z0-9]/.test(slug)) slug = `a${slug}`;
  return slug.slice(0, 64);
}

/** A d tag not yet used by this owner: the slug, then `-2`, `-3`… within the 64-char limit. */
export function uniqueSlug(raw: string, taken: ReadonlySet<string>): string {
  const base = personaSlug(raw || "agent");
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Head selection for replaceable catalog kinds: newest created_at, ties to the lowest id. */
export function latestByAddress(events: readonly NostrEvent[]): NostrEvent[] {
  const heads = new Map<string, NostrEvent>();
  for (const event of events) {
    const d = dTagOf(event);
    if (d === null) continue;
    const key = `${event.kind}:${event.pubkey}:${d}`;
    const current = heads.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      heads.set(key, event);
    }
  }
  return [...heads.values()];
}

function verified(event: NostrEvent, kind: number): Record<string, unknown> | null {
  if (event.kind !== kind) return null;
  try {
    if (!verifyEvent(event)) return null;
    const content = JSON.parse(event.content) as unknown;
    return isRecord(content) ? content : null;
  } catch {
    return null;
  }
}

export function personaFromEvent(event: NostrEvent): AgentPersona | null {
  const content = verified(event, PERSONA_KIND);
  const id = dTagOf(event);
  const displayName = text(content?.display_name);
  if (!content || !id || !PERSONA_SLUG.test(id) || !displayName) return null;
  return {
    id,
    displayName,
    systemPrompt: typeof content.system_prompt === "string" ? content.system_prompt : "",
    description: text(content.description),
    avatarUrl: text(content.avatar_url),
    runtime: text(content.runtime),
    // Foreign readers only ever see shared heads; only portable commands are trusted from those.
    acpCommand: isSharedEvent(event)
      ? (portableAcpCommand(text(content.acp_command)) ?? null)
      : text(content.acp_command),
    model: text(content.model),
    provider: text(content.provider),
    namePool: stringList(content.name_pool),
    respondTo: respondTo(content.respond_to),
    respondToAllowlist: stringList(content.respond_to_allowlist).map((key) => key.toLowerCase()),
    parallelism: parallelism(content.parallelism),
    sessionPolicy: content.session_policy === "thread" ? "thread" : "channel",
    shared: isSharedEvent(event),
    eventId: event.id,
    createdAt: event.created_at,
  };
}

export function teamFromEvent(event: NostrEvent): AgentTeam | null {
  const content = verified(event, TEAM_KIND);
  const id = dTagOf(event);
  const name = text(content?.name);
  if (!content || !id || !name) return null;
  return {
    id,
    name,
    description: text(content.description),
    instructions: text(content.instructions),
    personaIds: stringList(content.persona_ids),
    shared: false,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

export function teamCatalogFromEvent(event: NostrEvent): TeamCatalogEntry | null {
  if (utf8ToBytes(event.content).length > MAX_TEAM_CATALOG_BYTES) return null;
  const content = verified(event, TEAM_CATALOG_KIND);
  const id = dTagOf(event);
  const name = text(content?.name);
  if (content?.v !== 1 || !id || !name || !Array.isArray(content.members)) return null;
  if (content.members.length > MAX_TEAM_MEMBERS) return null;
  const members = content.members.flatMap((member): TeamCatalogMember[] => {
    const displayName = isRecord(member) ? text(member.display_name) : null;
    if (!isRecord(member) || !displayName || typeof member.member_key !== "string") return [];
    return [
      {
        memberKey: member.member_key,
        displayName,
        systemPrompt: text(member.system_prompt),
        avatarUrl: text(member.avatar_url),
        runtime: text(member.runtime),
        acpCommand: portableAcpCommand(text(member.acp_command)) ?? null,
        model: text(member.model),
        provider: text(member.provider),
        namePool: stringList(member.name_pool),
        // A projection never carries allowlist pubkeys, so an "allowlist" mode is meaningless here.
        respondTo:
          respondTo(member.respond_to) === "allowlist"
            ? "owner-only"
            : respondTo(member.respond_to),
        parallelism: parallelism(member.parallelism),
        sessionPolicy: member.session_policy === "thread" ? "thread" : "channel",
      },
    ];
  });
  return {
    ownerPubkey: event.pubkey.toLowerCase(),
    id,
    eventId: event.id,
    createdAt: event.created_at,
    name,
    description: text(content.description),
    instructions: text(content.instructions),
    members,
  };
}

/**
 * Desktop `is_portable_acp_command`: exactly "buzz-acp" or `buzz-<name>-acp`, ≤255 bytes. Anything
 * else is a local command and never crosses a shared/foreign boundary.
 */
export function isPortableAcpCommand(command: string): boolean {
  return (
    utf8ToBytes(command).length <= 255 &&
    (command === "buzz-acp" || /^buzz-[A-Za-z0-9_-]+-acp$/.test(command))
  );
}

function portableAcpCommand(command: string | null): string | undefined {
  return command && isPortableAcpCommand(command) ? command : undefined;
}

/** Runtime ids are bare identifiers; anything path-like is local configuration and stays private. */
function portableRuntime(persona: AgentPersona): string | undefined {
  return persona.runtime && /^[A-Za-z0-9._-]{1,64}$/.test(persona.runtime)
    ? persona.runtime
    : undefined;
}

function clampedParallelism(persona: AgentPersona): number | undefined {
  return persona.parallelism === null ? undefined : Math.min(32, Math.max(1, persona.parallelism));
}

/**
 * 30175 content in desktop field order. A shared persona is world-readable, so unlike desktop
 * (which still publishes `respond_to_allowlist` when shared) the allowlist pubkeys are withheld
 * and an allowlist mode degrades to owner-only.
 */
export function personaContent(persona: AgentPersona): Record<string, unknown> {
  const shared = persona.shared;
  const mode = shared && persona.respondTo === "allowlist" ? "owner-only" : persona.respondTo;
  const entries: Array<[string, unknown]> = [
    ["display_name", persona.displayName],
    ["system_prompt", persona.systemPrompt || undefined],
    [
      "acp_command",
      shared
        ? (portableAcpCommand(persona.acpCommand) ?? "buzz-acp")
        : (persona.acpCommand ?? undefined),
    ],
    ["avatar_url", persona.avatarUrl ?? undefined],
    ["runtime", shared ? portableRuntime(persona) : (persona.runtime ?? undefined)],
    ["model", persona.model ?? undefined],
    ["provider", persona.provider ?? undefined],
    ["name_pool", persona.namePool.length ? persona.namePool : undefined],
    ["respond_to", mode ?? undefined],
    [
      "respond_to_allowlist",
      !shared && persona.respondToAllowlist.length ? persona.respondToAllowlist : undefined,
    ],
    ["parallelism", clampedParallelism(persona)],
    ["description", persona.description ?? undefined],
    ["session_policy", persona.sessionPolicy === "thread" ? "thread" : undefined],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export function personaTags(persona: AgentPersona): string[][] {
  return [["d", persona.id], ...(persona.shared ? [["shared", "true"]] : [])];
}

/** 30176 is not share-gated on the relay, so it carries only public grouping fields. */
export function teamContent(team: AgentTeam): Record<string, unknown> {
  return {
    name: team.name,
    ...(team.description ? { description: team.description } : {}),
    instructions: team.instructions,
    persona_ids: team.personaIds,
  };
}

/** Opaque member label: SHA-256 over a domain prefix and the local persona id (desktop v1). */
export function memberKeyFor(personaId: string): string {
  return bytesToHex(sha256(utf8ToBytes(`buzz:team-catalog:member-key:v1\0${personaId}`)));
}

/**
 * The shareable 30178 projection: explicit allow-list of safe fields only. No allowlist pubkeys,
 * env, relay URLs, local ids, commands beyond portable aliases, or secrets.
 */
export function teamCatalogContent(
  team: AgentTeam,
  personas: readonly AgentPersona[],
): Record<string, unknown> {
  const members = team.personaIds.map((personaId) => {
    const persona = personas.find((candidate) => candidate.id === personaId);
    if (!persona) throw new Error(t("agents.teamMemberMissing", { id: personaId }));
    const mode = persona.respondTo === "allowlist" ? "owner-only" : persona.respondTo;
    const entries: Array<[string, unknown]> = [
      ["member_key", memberKeyFor(persona.id)],
      ["display_name", persona.displayName],
      ["system_prompt", persona.systemPrompt],
      ["avatar_url", persona.avatarUrl ?? undefined],
      ["runtime", portableRuntime(persona)],
      ["acp_command", portableAcpCommand(persona.acpCommand)],
      ["model", persona.model ?? undefined],
      ["provider", persona.provider ?? undefined],
      ["name_pool", persona.namePool.length ? persona.namePool : undefined],
      ["respond_to", mode ?? undefined],
      ["parallelism", clampedParallelism(persona)],
      ["session_policy", persona.sessionPolicy === "thread" ? "thread" : undefined],
    ];
    return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  });
  return {
    v: 1,
    name: team.name,
    ...(team.description ? { description: team.description } : {}),
    ...(team.instructions ? { instructions: team.instructions } : {}),
    members: members.slice(0, MAX_TEAM_MEMBERS),
  };
}

/** Persona draft from an imported shared catalog member (a fresh local id is assigned). */
export function personaFromCatalogMember(member: TeamCatalogMember, id: string): AgentPersona {
  return {
    id,
    displayName: member.displayName,
    systemPrompt: member.systemPrompt ?? "",
    description: null,
    avatarUrl: member.avatarUrl,
    runtime: member.runtime,
    acpCommand: member.acpCommand,
    model: member.model,
    provider: member.provider,
    namePool: member.namePool,
    respondTo: member.respondTo,
    respondToAllowlist: [],
    parallelism: member.parallelism,
    sessionPolicy: member.sessionPolicy,
    shared: false,
    eventId: null,
    createdAt: 0,
  };
}
