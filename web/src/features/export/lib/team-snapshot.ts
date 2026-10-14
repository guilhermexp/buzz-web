import type { AgentPersona, AgentTeam } from "@/features/agents/lib/catalog-model";
import { t } from "@/shared/i18n";
import {
  type AgentPersonaDraft,
  type AgentSnapshot,
  agentSnapshotFromPersona,
  parseAgentSnapshot,
  personaDraftFromAgentSnapshot,
  readAgentSnapshotFile,
  readFormatHeader,
  readSnapshotPayload,
  SnapshotError,
  type SnapshotPayload,
  snapshotFail,
} from "./agent-snapshot";
import { hasPngMagic, readPngTextChunk } from "./snapshot-png";

/** `buzz-team-snapshot v1`, matching desktop `managed_agents/team_snapshot.rs`. */
export const TEAM_SNAPSHOT_FORMAT = "buzz-team-snapshot";
export const TEAM_SNAPSHOT_PNG_KEYWORD = "buzz_team_snapshot";
export const MAX_TEAM_SNAPSHOT_JSON_BYTES = 25 * 1024 * 1024;
export const MAX_TEAM_SNAPSHOT_PNG_BYTES = 50 * 1024 * 1024;

export type TeamSnapshot = {
  format: typeof TEAM_SNAPSHOT_FORMAT;
  version: 1;
  team: { name: string; description?: string; instructions?: string };
  members: AgentSnapshot[];
};

export type TeamDraft = Omit<AgentTeam, "id" | "personaIds" | "shared" | "eventId" | "createdAt">;

export function teamSnapshotFromTeam(
  team: AgentTeam,
  personas: readonly AgentPersona[],
): TeamSnapshot {
  const members = team.personaIds.map((id) => {
    const persona = personas.find((candidate) => candidate.id === id);
    if (!persona) snapshotFail(t("collab.export.snapshot.errorMissingPersona"));
    return agentSnapshotFromPersona(persona);
  });
  const meta: TeamSnapshot["team"] = { name: team.name };
  if (team.description !== null) meta.description = team.description;
  if (team.instructions !== null) meta.instructions = team.instructions;
  const snapshot: TeamSnapshot = { format: TEAM_SNAPSHOT_FORMAT, version: 1, team: meta, members };
  validateTeamHeader(snapshot);
  return snapshot;
}

function validateTeamHeader(snapshot: TeamSnapshot): void {
  if (!snapshot.team.name.trim()) snapshotFail(t("collab.export.snapshot.errorTeamName"));
  if (!snapshot.members.length) snapshotFail(t("collab.export.snapshot.errorTeamMembers"));
}

function optionalTeamString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    snapshotFail(t("collab.export.snapshot.errorInvalidJson", { detail: `$.team.${key}` }));
  }
  return value;
}

/** Typed parse + desktop `validate_team_snapshot` (every member passes the agent rules). */
export function parseTeamSnapshot(value: unknown): TeamSnapshot {
  const { format, version } = readFormatHeader(value);
  if (format !== TEAM_SNAPSHOT_FORMAT) {
    snapshotFail(t("collab.export.snapshot.errorFormat", { format }));
  }
  if (version !== 1) snapshotFail(t("collab.export.snapshot.errorVersion", { version }));
  const source = value as Record<string, unknown>;
  const team = source.team;
  if (!team || typeof team !== "object" || Array.isArray(team)) {
    snapshotFail(t("collab.export.snapshot.errorInvalidJson", { detail: "$.team" }));
  }
  const rawTeam = team as Record<string, unknown>;
  if (typeof rawTeam.name !== "string") {
    snapshotFail(t("collab.export.snapshot.errorInvalidJson", { detail: "$.team.name" }));
  }
  if (!Array.isArray(source.members)) {
    snapshotFail(t("collab.export.snapshot.errorInvalidJson", { detail: "$.members" }));
  }
  const meta: TeamSnapshot["team"] = { name: rawTeam.name };
  const description = optionalTeamString(rawTeam, "description");
  const instructions = optionalTeamString(rawTeam, "instructions");
  if (description !== undefined) meta.description = description;
  if (instructions !== undefined) meta.instructions = instructions;
  const snapshot: TeamSnapshot = {
    format: TEAM_SNAPSHOT_FORMAT,
    version: 1,
    team: meta,
    members: [],
  };
  if (!meta.name.trim()) snapshotFail(t("collab.export.snapshot.errorTeamName"));
  snapshot.members = source.members.map((member: unknown, index: number) => {
    try {
      return parseAgentSnapshot(member, `$.members[${index}]`);
    } catch (error) {
      if (!(error instanceof SnapshotError)) throw error;
      return snapshotFail(
        t("collab.export.snapshot.errorTeamMember", { index: index + 1, reason: error.message }),
      );
    }
  });
  validateTeamHeader(snapshot);
  return snapshot;
}

export function teamDraftFromSnapshot(s: TeamSnapshot): {
  team: TeamDraft;
  personas: AgentPersonaDraft[];
} {
  return {
    team: {
      name: s.team.name.trim(),
      description: s.team.description?.trim() || null,
      instructions: s.team.instructions ?? null,
    },
    personas: s.members.map((member, index) => {
      try {
        return personaDraftFromAgentSnapshot(member);
      } catch (error) {
        if (!(error instanceof SnapshotError)) throw error;
        return snapshotFail(
          t("collab.export.snapshot.errorTeamMember", { index: index + 1, reason: error.message }),
        );
      }
    }),
  };
}

/** Desktop `decode_team_snapshot_from_bytes`: retired flat team JSON and ZIP packs are refused. */
export function teamSnapshotFromPayload({ json, png }: SnapshotPayload): TeamSnapshot {
  if (json === null && !png) snapshotFail(t("collab.export.snapshot.errorLegacyTeam"));
  const probe = json as Record<string, unknown> | null;
  if (
    !png &&
    probe?.format !== TEAM_SNAPSHOT_FORMAT &&
    probe?.version === 1 &&
    probe?.type === "team"
  ) {
    snapshotFail(t("collab.export.snapshot.errorLegacyTeam"));
  }
  return parseTeamSnapshot(json);
}

export async function readTeamSnapshotFile(file: File): Promise<TeamSnapshot> {
  const payload = await readSnapshotPayload(file, TEAM_SNAPSHOT_PNG_KEYWORD, {
    json: MAX_TEAM_SNAPSHOT_JSON_BYTES,
    png: MAX_TEAM_SNAPSHOT_PNG_BYTES,
  });
  return teamSnapshotFromPayload(payload);
}

export type ImportedSnapshot =
  | { kind: "persona"; snapshot: AgentSnapshot }
  | { kind: "team"; snapshot: TeamSnapshot };

/** Sniff agent vs team (desktop chunk keyword for PNG cards, `format`/legacy shape for JSON). */
export async function readAnySnapshotFile(file: File): Promise<ImportedSnapshot> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let team: boolean;
  if (hasPngMagic(bytes)) {
    try {
      team = readPngTextChunk(bytes, TEAM_SNAPSHOT_PNG_KEYWORD) !== null;
    } catch {
      team = false;
    }
  } else {
    try {
      const probe = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | null;
      team = probe?.format === TEAM_SNAPSHOT_FORMAT || probe?.type === "team";
    } catch {
      team = /\.team\.json$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    }
  }
  return team
    ? { kind: "team", snapshot: await readTeamSnapshotFile(file) }
    : { kind: "persona", snapshot: await readAgentSnapshotFile(file) };
}
