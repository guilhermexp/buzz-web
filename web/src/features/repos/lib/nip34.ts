/**
 * NIP-34 / NIP-MP read models for Buzz projects (kind 30621) and repository
 * announcements (kind 30617), mirroring Buzz Desktop's projectModels.ts.
 */
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { Repo } from "../use-repos";

export const KIND_TEXT_NOTE = 1;
export const KIND_GIT_PULL_REQUEST = 1618;
export const KIND_GIT_PR_UPDATE = 1619;
export const KIND_GIT_ISSUE = 1621;
export const KIND_GIT_STATUS_OPEN = 1630;
export const KIND_GIT_STATUS_MERGED = 1631;
export const KIND_GIT_STATUS_CLOSED = 1632;
export const KIND_GIT_STATUS_DRAFT = 1633;
export const KIND_REPO_ANNOUNCEMENT = 30617;
export const KIND_REPO_STATE = 30618;
export const KIND_PROJECT = 30621;
export const KIND_DELETION = 5;

export const GIT_STATUS_KINDS = [
  KIND_GIT_STATUS_OPEN,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_DRAFT,
] as const;

export const MAX_PROJECT_MEMBERS = 64;
const MAX_D_TAG_BYTES = 256;
const encoder = new TextEncoder();

export function getTag(event: Pick<NostrEvent, "tags">, name: string): string | undefined {
  const value = event.tags.find((tag) => tag[0] === name)?.[1];
  return value ? value : undefined;
}

export function getAllTags(event: Pick<NostrEvent, "tags">, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && tag[1]).map((tag) => tag[1] as string);
}

export function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function isValidChannelId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Relay `validate_repo_id`: `[A-Za-z0-9._-]{1,64}`, no leading dot, no `..`. */
export function isValidRepoId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value) && !value.startsWith(".") && !value.includes("..");
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function parseRepositoryAddress(value: string): { owner: string; dtag: string } | null {
  const match = /^30617:([0-9a-f]{64}):(.+)$/.exec(value.trim());
  if (!match) return null;
  const dtag = match[2] as string;
  if (encoder.encode(dtag).byteLength > MAX_D_TAG_BYTES) return null;
  return { owner: match[1] as string, dtag };
}

export function repositoryAddress(owner: string, dtag: string): string {
  return `${KIND_REPO_ANNOUNCEMENT}:${owner.toLowerCase()}:${dtag}`;
}

/** Canonical relay-hosted clone URL (`<relay-origin>/git/<owner>/<repo>`). */
export function relayCloneUrl(relayOrigin: string, owner: string, dtag: string): string {
  return `${relayOrigin.replace(/\/+$/, "")}/git/${owner.toLowerCase()}/${dtag}`;
}

export type ProtectionTag = { pattern: string; rules: string[] };

export interface Repository extends Repo {
  dtag: string;
  address: string;
  maintainers: string[];
  protections: ProtectionTag[];
  /** Explicitly announced clone URLs (empty when the event has none). */
  announcedCloneUrls: string[];
  eventTags: string[][];
  eventContent: string;
}

export function eventToRepository(event: NostrEvent, relayOrigin: string): Repository | null {
  const dtag = getTag(event, "d");
  if (event.kind !== KIND_REPO_ANNOUNCEMENT || !dtag) return null;
  if (encoder.encode(dtag).byteLength > MAX_D_TAG_BYTES) return null;
  const owner = event.pubkey.toLowerCase();
  if (!isHexPubkey(owner)) return null;
  const announcedCloneUrls = event.tags
    .filter((tag) => tag[0] === "clone")
    .flatMap((tag) => tag.slice(1))
    .filter(Boolean);
  const channel = getTag(event, "buzz-channel");
  return {
    id: dtag,
    dtag,
    name: getTag(event, "name") ?? dtag,
    description: getTag(event, "description") ?? event.content ?? "",
    cloneUrls: announcedCloneUrls.length
      ? announcedCloneUrls
      : [relayCloneUrl(relayOrigin, owner, dtag)],
    announcedCloneUrls,
    webUrl: getTag(event, "web") ?? null,
    channelId: channel && isValidChannelId(channel) ? channel : null,
    owner,
    contributors: [...new Set(getAllTags(event, "p"))],
    createdAt: event.created_at,
    address: repositoryAddress(owner, dtag),
    maintainers: event.tags
      .filter((tag) => tag[0] === "maintainers")
      .flatMap((tag) => tag.slice(1))
      .map((value) => value.toLowerCase())
      .filter(isHexPubkey),
    protections: event.tags
      .filter((tag) => tag[0] === "buzz-protect" && tag[1])
      .map((tag) => ({ pattern: tag[1] as string, rules: tag.slice(2) })),
    eventTags: event.tags.map((tag) => [...tag]),
    eventContent: event.content,
  };
}

/** Keep the newest head per (kind, pubkey, d); ties break on the lower id (NIP-01). */
export function latestAddressable(events: readonly NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const dtag = getTag(event, "d");
    if (!dtag) continue;
    const key = `${event.kind}:${event.pubkey.toLowerCase()}:${dtag}`;
    const current = latest.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

const SINGLETON_TAGS: Record<string, number> = {
  name: 256,
  description: 2_048,
  "buzz-channel": 256,
  "buzz-visibility": 256,
};

/** NIP-MP envelope validation shared by the read parser and write helpers. */
export function validateProjectTags(tags: readonly string[][]): void {
  const dTags = tags.filter((tag) => tag[0] === "d");
  if (dTags.length !== 1 || !dTags[0]?.[1]) throw new Error("project-d-cardinality");
  if (encoder.encode(dTags[0][1]).byteLength > MAX_D_TAG_BYTES) throw new Error("project-d-length");
  for (const [name, maxBytes] of Object.entries(SINGLETON_TAGS)) {
    const matches = tags.filter((tag) => tag[0] === name);
    if (matches.length > 1) throw new Error(`project-duplicate-${name}`);
    const value = matches[0]?.[1];
    if (value !== undefined && encoder.encode(value).byteLength > maxBytes) {
      throw new Error(`project-${name}-length`);
    }
  }
  const members = tags.filter((tag) => tag[0] === "a");
  if (members.length > MAX_PROJECT_MEMBERS) throw new Error("project-member-cap");
  const seen = new Set<string>();
  for (const tag of members) {
    const address = tag[1] ?? "";
    if (tag.length !== 2 && tag.length !== 3) throw new Error("project-member-arity");
    if (!parseRepositoryAddress(address)) throw new Error("project-member-malformed");
    if (seen.has(address)) throw new Error("project-member-duplicate");
    seen.add(address);
  }
}

export interface Project {
  /** `30621:<owner>:<d>` for explicit projects, the repo address for legacy ones. */
  id: string;
  dtag: string;
  name: string;
  description: string;
  owner: string;
  createdAt: number;
  channelId: string | null;
  visibility: "listed" | "unlisted";
  repositoryAddresses: string[];
  repositories: Repository[];
  unavailableRepositoryAddresses: string[];
  /** A bare repository announcement not claimed by any explicit project. */
  legacy: boolean;
  eventTags: string[][];
  eventContent: string;
}

function eventToProject(
  event: NostrEvent,
  repositoriesByAddress: ReadonlyMap<string, Repository>,
): Project | null {
  if (event.kind !== KIND_PROJECT || !isHexPubkey(event.pubkey.toLowerCase())) return null;
  try {
    validateProjectTags(event.tags);
  } catch {
    return null;
  }
  const dtag = getTag(event, "d") as string;
  const owner = event.pubkey.toLowerCase();
  const repositoryAddresses = getAllTags(event, "a").sort();
  const channel = getTag(event, "buzz-channel");
  return {
    id: `${KIND_PROJECT}:${owner}:${dtag}`,
    dtag,
    name: getTag(event, "name") ?? dtag,
    description: getTag(event, "description") ?? "",
    owner,
    createdAt: event.created_at,
    channelId: channel && isValidChannelId(channel) ? channel : null,
    visibility: getTag(event, "buzz-visibility") === "unlisted" ? "unlisted" : "listed",
    repositoryAddresses,
    repositories: repositoryAddresses.flatMap((address) => {
      const repository = repositoriesByAddress.get(address);
      return repository ? [repository] : [];
    }),
    unavailableRepositoryAddresses: repositoryAddresses.filter(
      (address) => !repositoriesByAddress.has(address),
    ),
    legacy: false,
    eventTags: event.tags.map((tag) => [...tag]),
    eventContent: event.content,
  };
}

function deletionThresholds(deletions: readonly NostrEvent[]): Map<string, number> {
  const thresholds = new Map<string, number>();
  for (const event of deletions) {
    for (const tag of event.tags) {
      if (tag[0] !== "a" || !tag[1]) continue;
      const [kind, owner] = tag[1].split(":");
      // A deletion only applies to coordinates its signer owns.
      if (owner !== event.pubkey.toLowerCase() || !kind) continue;
      thresholds.set(tag[1], Math.max(thresholds.get(tag[1]) ?? 0, event.created_at));
    }
  }
  return thresholds;
}

export function buildProjectReadModels({
  projectEvents,
  repositoryEvents,
  deletionEvents = [],
  relayOrigin,
  viewerPubkey,
}: {
  projectEvents: readonly NostrEvent[];
  repositoryEvents: readonly NostrEvent[];
  deletionEvents?: readonly NostrEvent[];
  relayOrigin: string;
  viewerPubkey: string | null;
}): { projects: Project[]; repositories: Repository[] } {
  const thresholds = deletionThresholds(deletionEvents);
  const isDeleted = (event: NostrEvent) => {
    const coordinate = `${event.kind}:${event.pubkey.toLowerCase()}:${getTag(event, "d")}`;
    const threshold = thresholds.get(coordinate);
    return threshold !== undefined && event.created_at <= threshold;
  };
  const repositories = latestAddressable(repositoryEvents)
    .filter((event) => !isDeleted(event))
    .flatMap((event) => {
      const repository = eventToRepository(event, relayOrigin);
      return repository ? [repository] : [];
    });
  const byAddress = new Map(repositories.map((repository) => [repository.address, repository]));
  const viewer = viewerPubkey?.toLowerCase() ?? null;
  const explicit = latestAddressable(projectEvents)
    .filter((event) => !isDeleted(event))
    .flatMap((event) => {
      const project = eventToProject(event, byAddress);
      if (!project) return [];
      if (project.visibility === "unlisted" && project.owner !== viewer) return [];
      return [project];
    });
  // A project claims a repository only when it is signed by the repository
  // owner or one of its maintainers (NIP-MP); claims grant no authority.
  const claimed = new Set(
    explicit.flatMap((project) =>
      project.repositoryAddresses.filter((address) => {
        const repository = byAddress.get(address);
        return (
          repository &&
          (repository.owner === project.owner || repository.maintainers.includes(project.owner))
        );
      }),
    ),
  );
  const legacy: Project[] = repositories
    .filter((repository) => !claimed.has(repository.address))
    .map((repository) => ({
      id: repository.address,
      dtag: repository.dtag,
      name: repository.name,
      description: repository.description,
      owner: repository.owner,
      createdAt: repository.createdAt,
      channelId: repository.channelId,
      visibility: "listed",
      repositoryAddresses: [repository.address],
      repositories: [repository],
      unavailableRepositoryAddresses: [],
      legacy: true,
      eventTags: [],
      eventContent: "",
    }));
  return {
    projects: [...explicit, ...legacy].sort((left, right) => right.createdAt - left.createdAt),
    repositories: repositories.sort((left, right) => right.createdAt - left.createdAt),
  };
}

export interface RepoState {
  head: string | null;
  branches: { name: string; oid: string }[];
  tags: { name: string; oid: string }[];
  createdAt: number;
}

/** Parse the relay-signed kind 30618 ref snapshot. */
export function eventToRepoState(event: NostrEvent): RepoState {
  const branches: RepoState["branches"] = [];
  const tags: RepoState["tags"] = [];
  let head: string | null = null;
  for (const tag of event.tags) {
    const [name, value] = tag;
    if (!name || !value) continue;
    if (name === "HEAD" && value.startsWith("ref: refs/heads/")) {
      head = value.slice("ref: refs/heads/".length);
    } else if (name.startsWith("refs/heads/")) {
      branches.push({ name: name.slice("refs/heads/".length), oid: value });
    } else if (name.startsWith("refs/tags/")) {
      tags.push({ name: name.slice("refs/tags/".length), oid: value });
    }
  }
  return { head, branches, tags, createdAt: event.created_at };
}
