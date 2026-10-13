/**
 * Relay-backed data for the project forge: project collections (30621),
 * repository announcements (30617), relay-signed ref state (30618) and the
 * folded issue / pull-request work items for a set of repositories.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { EventTemplate, NostrEvent, NostrFilter } from "@/shared/api/nostr-types";
import type { BuzzRelayClient } from "@/shared/api/relay-client";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import {
  buildProjectReadModels,
  eventToRepoState,
  GIT_STATUS_KINDS,
  KIND_DELETION,
  KIND_GIT_ISSUE,
  KIND_GIT_PR_UPDATE,
  KIND_GIT_PULL_REQUEST,
  KIND_PROJECT,
  KIND_REPO_ANNOUNCEMENT,
  KIND_REPO_STATE,
  KIND_TEXT_NOTE,
  type Repository,
} from "./lib/nip34";
import { foldIssues, foldPullRequests } from "./lib/work-items";

const QUERY_LIMIT = 1_000;
/** NIP-11 `max_values` on Buzz relays; larger tag lists are chunked. */
const MAX_FILTER_VALUES = 256;

function requireClient(client: BuzzRelayClient | null): BuzzRelayClient {
  if (!client) throw new Error("relay-unavailable");
  return client;
}

async function queryChunked(
  client: BuzzRelayClient,
  base: NostrFilter,
  tag: `#${string}`,
  values: readonly string[],
): Promise<NostrEvent[]> {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += MAX_FILTER_VALUES) {
    chunks.push(values.slice(index, index + MAX_FILTER_VALUES));
  }
  const results = await Promise.all(chunks.map((chunk) => client.query({ ...base, [tag]: chunk })));
  const byId = new Map<string, NostrEvent>();
  for (const event of results.flat()) byId.set(event.id, event);
  return [...byId.values()];
}

function useForgeKeys() {
  const { relayUrl, pubkey } = useWorkspace();
  return { root: ["forge", relayUrl, pubkey] as const };
}

export function useForgeCollections() {
  const { client, relayUrl, pubkey, demo } = useWorkspace();
  const { root } = useForgeKeys();
  return useQuery({
    queryKey: [...root, "collections"],
    enabled: Boolean(client) && !demo,
    staleTime: 30_000,
    queryFn: async () => {
      const relay = requireClient(client);
      const [projectEvents, repositoryEvents, deletionEvents] = await Promise.all([
        relay.query({ kinds: [KIND_PROJECT], limit: QUERY_LIMIT }),
        relay.query({ kinds: [KIND_REPO_ANNOUNCEMENT], limit: QUERY_LIMIT }),
        relay.query({
          kinds: [KIND_DELETION],
          "#k": [String(KIND_PROJECT), String(KIND_REPO_ANNOUNCEMENT)],
          limit: QUERY_LIMIT,
        }),
      ]);
      return buildProjectReadModels({
        projectEvents,
        repositoryEvents,
        deletionEvents,
        relayOrigin: relayHttpOrigin(relayUrl),
        viewerPubkey: pubkey,
      });
    },
  });
}

/** The relay's own signing key (NIP-11 `self`), trusted for kind 30618. */
export function useRelaySelf() {
  const { relayUrl, demo } = useWorkspace();
  return useQuery({
    queryKey: ["forge-relay-self", relayUrl],
    enabled: !demo,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const response = await fetch(relayHttpOrigin(relayUrl), {
        headers: { Accept: "application/nostr+json" },
      });
      if (!response.ok) throw new Error(`relay-info-${response.status}`);
      const info = (await response.json()) as { self?: unknown };
      return typeof info.self === "string" && /^[0-9a-f]{64}$/.test(info.self) ? info.self : null;
    },
  });
}

export function useRepoState(repository: Repository | null) {
  const { client } = useWorkspace();
  const { root } = useForgeKeys();
  const relaySelf = useRelaySelf();
  return useQuery({
    queryKey: [...root, "repo-state", repository?.address, relaySelf.data],
    enabled: Boolean(client && repository && relaySelf.isFetched),
    staleTime: 15_000,
    queryFn: async () => {
      if (!repository) return null;
      const authors = [repository.owner, ...(relaySelf.data ? [relaySelf.data] : [])];
      const events = await requireClient(client).query({
        kinds: [KIND_REPO_STATE],
        authors,
        "#d": [repository.dtag],
        limit: 10,
      });
      const latest = events.sort((left, right) => right.created_at - left.created_at)[0];
      return latest ? eventToRepoState(latest) : null;
    },
  });
}

/** Issues and pull requests (folded with their updates, statuses and comments). */
export function useWorkItems(repositories: readonly Repository[]) {
  const { client, demo } = useWorkspace();
  const { root } = useForgeKeys();
  const addresses = repositories.map((repository) => repository.address).sort();
  return useQuery({
    queryKey: [...root, "work-items", addresses],
    enabled: Boolean(client) && !demo && addresses.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const relay = requireClient(client);
      const base = { limit: QUERY_LIMIT };
      const [issues, pullRequests, updates, comments, statuses] = await Promise.all([
        queryChunked(relay, { ...base, kinds: [KIND_GIT_ISSUE] }, "#a", addresses),
        queryChunked(relay, { ...base, kinds: [KIND_GIT_PULL_REQUEST] }, "#a", addresses),
        queryChunked(relay, { ...base, kinds: [KIND_GIT_PR_UPDATE] }, "#a", addresses),
        queryChunked(relay, { ...base, kinds: [KIND_TEXT_NOTE] }, "#a", addresses),
        queryChunked(relay, { ...base, kinds: [...GIT_STATUS_KINDS] }, "#a", addresses),
      ]);
      return {
        issues: foldIssues(issues, statuses, comments),
        pullRequests: foldPullRequests(pullRequests, updates, comments, statuses),
      };
    },
  });
}

/** Refresh relay-derived forge data and every git-backed view of this relay. */
export function useForgeInvalidate() {
  const { relayUrl, pubkey } = useWorkspace();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge", relayUrl, pubkey] }),
      queryClient.invalidateQueries({ queryKey: ["forge-git", relayUrl, pubkey] }),
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("git-") &&
          query.queryKey[1] === relayUrl,
      }),
    ]);
  }, [queryClient, relayUrl, pubkey]);
}

/** Sign + publish through the workspace relay, then refresh forge queries. */
export function useForgePublish() {
  const { client } = useWorkspace();
  const invalidate = useForgeInvalidate();
  return useMutation({
    mutationFn: async (templates: EventTemplate[]) => {
      const relay = requireClient(client);
      const published: NostrEvent[] = [];
      for (const template of templates) published.push((await relay.publish(template)).event);
      return published;
    },
    onSuccess: invalidate,
  });
}

/** Fetch the signer's live head of an addressable event right before patching it. */
export async function fetchOwnHead(
  client: BuzzRelayClient | null,
  kind: number,
  pubkey: string,
  dtag: string,
): Promise<NostrEvent | null> {
  const events = await requireClient(client).query({
    kinds: [kind],
    authors: [pubkey],
    "#d": [dtag],
    limit: 5,
  });
  return events.sort((left, right) => right.created_at - left.created_at)[0] ?? null;
}
