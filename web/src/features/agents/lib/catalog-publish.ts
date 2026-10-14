import {
  type AgentPersona,
  type AgentTeam,
  dTagOf,
  isSharedEvent,
  latestByAddress,
  PERSONA_KIND,
  PERSONA_SLUG,
  personaContent,
  personaFromEvent,
  personaTags,
  TEAM_CATALOG_KIND,
  TEAM_KIND,
  type TeamCatalogEntry,
  teamCatalogContent,
  teamCatalogFromEvent,
  teamContent,
  teamFromEvent,
} from "@/features/agents/lib/catalog-model";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { t } from "@/shared/i18n";

const DELETION_KIND = 5;

export type CatalogSnapshot = {
  personas: AgentPersona[];
  teams: AgentTeam[];
  sharedPersonas: Array<AgentPersona & { ownerPubkey: string }>;
  sharedTeams: TeamCatalogEntry[];
};

/** created_at := max(now, head + 1) so a replacement always wins head selection. */
function monotonicCreatedAt(previous: number): number {
  return Math.max(Math.floor(Date.now() / 1000), previous + 1);
}

function coordinate(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey.toLowerCase()}:${d}`;
}

/** Latest own NIP-09 deletion time per addressable coordinate. */
function deletionTimes(deletions: readonly NostrEvent[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const deletion of deletions) {
    for (const tag of deletion.tags) {
      if (tag[0] !== "a" || !tag[1]) continue;
      const current = times.get(tag[1]) ?? 0;
      if (deletion.created_at > current) times.set(tag[1], deletion.created_at);
    }
  }
  return times;
}

function alive(event: NostrEvent, deleted: ReadonlyMap<string, number>): boolean {
  const d = dTagOf(event);
  return (
    d !== null && (deleted.get(coordinate(event.kind, event.pubkey, d)) ?? -1) < event.created_at
  );
}

export async function loadCatalog(
  client: BuzzRelayClient,
  owner: string,
): Promise<CatalogSnapshot> {
  const me = owner.toLowerCase();
  const [own, ownDeletions, sharedPersonaEvents, sharedTeamEvents] = await Promise.all([
    client.query({
      kinds: [PERSONA_KIND, TEAM_KIND, TEAM_CATALOG_KIND],
      authors: [me],
      limit: 1000,
    }),
    client.query({
      kinds: [DELETION_KIND],
      authors: [me],
      "#k": [String(PERSONA_KIND), String(TEAM_KIND), String(TEAM_CATALOG_KIND)],
      limit: 1000,
    }),
    client.query({ kinds: [PERSONA_KIND], limit: 500 }),
    client.query({ kinds: [TEAM_CATALOG_KIND], limit: 200 }),
  ]);
  const deleted = deletionTimes(ownDeletions);
  const ownHeads = latestByAddress(own).filter((event) => alive(event, deleted));
  const sharedTeamIds = new Set(
    ownHeads
      .filter((event) => event.kind === TEAM_CATALOG_KIND && isSharedEvent(event))
      .map((event) => dTagOf(event)),
  );
  const personas = ownHeads
    .filter((event) => event.kind === PERSONA_KIND)
    .map(personaFromEvent)
    .filter((persona): persona is AgentPersona => persona !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const teams = ownHeads
    .filter((event) => event.kind === TEAM_KIND)
    .map(teamFromEvent)
    .filter((team): team is AgentTeam => team !== null)
    .map((team) => ({ ...team, shared: sharedTeamIds.has(team.id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  // Foreign entries are only trusted when they carry the exact share tag the relay gates on.
  const sharedPersonas = latestByAddress(sharedPersonaEvents)
    .filter((event) => event.pubkey.toLowerCase() !== me && isSharedEvent(event))
    .flatMap((event) => {
      const persona = personaFromEvent(event);
      return persona ? [{ ...persona, ownerPubkey: event.pubkey.toLowerCase() }] : [];
    });
  const sharedTeams = latestByAddress(sharedTeamEvents)
    .filter((event) => event.pubkey.toLowerCase() !== me && isSharedEvent(event))
    .map(teamCatalogFromEvent)
    .filter((entry): entry is TeamCatalogEntry => entry !== null);
  return { personas, teams, sharedPersonas, sharedTeams };
}

export async function publishPersona(
  client: BuzzRelayClient,
  persona: AgentPersona,
): Promise<AgentPersona> {
  if (!PERSONA_SLUG.test(persona.id)) throw new Error(t("agents.personaSlugInvalid"));
  if (!persona.displayName.trim()) throw new Error(t("agents.personaNameRequired"));
  const result = await client.publish({
    kind: PERSONA_KIND,
    created_at: monotonicCreatedAt(persona.createdAt),
    content: JSON.stringify(personaContent(persona)),
    tags: personaTags(persona),
  });
  return { ...persona, eventId: result.event.id, createdAt: result.event.created_at };
}

async function publishDeletion(
  client: BuzzRelayClient,
  kind: number,
  owner: string,
  d: string,
): Promise<void> {
  await client.publish({
    kind: DELETION_KIND,
    content: "",
    tags: [
      ["a", coordinate(kind, owner, d)],
      ["k", String(kind)],
    ],
  });
}

export async function deletePersona(
  client: BuzzRelayClient,
  owner: string,
  persona: AgentPersona,
): Promise<void> {
  await publishDeletion(client, PERSONA_KIND, owner, persona.id);
}

/**
 * Publish the team (30176, public grouping only) and its catalog projection: a shared team gets a
 * sanitized 30178 with exactly ["shared","true"]; unsharing retracts the projection.
 */
export async function publishTeam(
  client: BuzzRelayClient,
  team: AgentTeam,
  personas: readonly AgentPersona[],
  owner: string,
  wasShared: boolean,
): Promise<AgentTeam> {
  if (!team.name.trim()) throw new Error(t("agents.teamNameRequired"));
  const projection = team.shared ? teamCatalogContent(team, personas) : null;
  const result = await client.publish({
    kind: TEAM_KIND,
    created_at: monotonicCreatedAt(team.createdAt),
    content: JSON.stringify(teamContent(team)),
    tags: [["d", team.id]],
  });
  if (projection) {
    await client.publish({
      kind: TEAM_CATALOG_KIND,
      created_at: result.event.created_at,
      content: JSON.stringify(projection),
      tags: [
        ["d", team.id],
        ["shared", "true"],
      ],
    });
  } else if (wasShared) {
    await publishDeletion(client, TEAM_CATALOG_KIND, owner, team.id);
  }
  return { ...team, eventId: result.event.id, createdAt: result.event.created_at };
}

export async function deleteTeam(
  client: BuzzRelayClient,
  owner: string,
  team: AgentTeam,
): Promise<void> {
  await publishDeletion(client, TEAM_KIND, owner, team.id);
  if (team.shared) await publishDeletion(client, TEAM_CATALOG_KIND, owner, team.id);
}
