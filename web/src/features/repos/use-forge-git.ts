import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  diffRevision,
  type FileChange,
  ForgeGitError,
  fetchBranch,
  listRemoteBranches,
  openForgeRepo,
  readBlobText,
} from "./lib/git-forge";
import { diffLines, splitLines, toHunks } from "./lib/line-diff";
import type { Repository } from "./lib/nip34";
import type { PullRequest, PullRequestRevision } from "./lib/work-items";

export function useRemoteBranches(repository: Repository | null) {
  const { relayUrl, pubkey, demo } = useWorkspace();
  const url = repository?.cloneUrls[0] ?? "";
  return useQuery({
    queryKey: ["forge-git", relayUrl, pubkey, "branches", url],
    enabled: Boolean(url) && !demo,
    staleTime: 10_000,
    retry: false,
    queryFn: () => listRemoteBranches(relayUrl, url),
  });
}

export async function openRepositoryStore(
  relayUrl: string,
  viewer: string,
  repository: Repository,
) {
  return openForgeRepo(relayUrl, viewer, repository.owner, repository.dtag);
}

/**
 * Files changed by one PR revision. The base is the revision's announced
 * `merge-base` when present (stable after merge), otherwise the merge base
 * with the current target branch tip (git `target...revision`).
 */
export function usePullRequestDiff(
  repository: Repository,
  pullRequest: PullRequest,
  revision: PullRequestRevision | null,
  targetBranch: string,
) {
  const { relayUrl, pubkey } = useWorkspace();
  return useQuery({
    queryKey: [
      "forge-git",
      relayUrl,
      pubkey,
      "pr-diff",
      pullRequest.id,
      revision?.commit,
      targetBranch,
    ],
    enabled: Boolean(revision),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      if (!revision) throw new ForgeGitError("revision_unavailable", "");
      const handle = await openRepositoryStore(relayUrl, pubkey, repository);
      const targetUrl = repository.cloneUrls[0] as string;
      const targetTip = await fetchBranch(handle, targetUrl, targetBranch);
      const sourceUrl = revision.cloneUrls[0] ?? pullRequest.cloneUrls[0] ?? targetUrl;
      if (pullRequest.branchName) {
        try {
          await fetchBranch(handle, sourceUrl, pullRequest.branchName);
        } catch (error) {
          // A deleted or force-moved branch may still leave the revision reachable.
          if (!(error instanceof ForgeGitError) || error.code !== "branch_missing") throw error;
        }
      }
      const base = revision.mergeBase ?? targetTip;
      const diff = await diffRevision(handle, base, revision.commit);
      return { ...diff, targetTip };
    },
  });
}

export function useFileDiff(repository: Repository, change: FileChange | null) {
  const { relayUrl, pubkey } = useWorkspace();
  return useQuery({
    queryKey: ["forge-git", relayUrl, pubkey, "file-diff", change?.oldOid, change?.newOid],
    enabled: Boolean(change),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      if (!change) return null;
      const handle = await openRepositoryStore(relayUrl, pubkey, repository);
      const [before, after] = await Promise.all([
        readBlobText(handle, change.oldOid),
        readBlobText(handle, change.newOid),
      ]);
      if (before.kind !== "text") return { kind: before.kind } as const;
      if (after.kind !== "text") return { kind: after.kind } as const;
      const script = diffLines(splitLines(before.text), splitLines(after.text));
      return {
        kind: "text",
        hunks: toHunks(script),
        additions: script.filter((line) => line.type === "add").length,
        deletions: script.filter((line) => line.type === "del").length,
      } as const;
    },
  });
}
