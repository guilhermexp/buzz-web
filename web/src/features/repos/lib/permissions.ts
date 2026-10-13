/**
 * Viewer permissions and merge preconditions, mirroring Buzz Desktop
 * (PullRequestReviewCard.tsx, pullRequestReviews.ts). These gate controls;
 * the relay and git transport still enforce the real authorization.
 */
import type { Repository } from "./nip34";
import type { Issue, PullRequest } from "./work-items";

type Viewer = string | null | undefined;

function same(left: Viewer, right: string): boolean {
  return Boolean(left) && left?.toLowerCase() === right.toLowerCase();
}

/** Root author or repository owner may change lifecycle state. */
export function canChangeStatus(
  viewer: Viewer,
  repository: Pick<Repository, "owner">,
  item: Pick<Issue | PullRequest, "author">,
): boolean {
  return same(viewer, item.author) || same(viewer, repository.owner);
}

/** Only the PR author or repository owner may publish a new revision (1619). */
export const canPublishRevision = canChangeStatus;

export function canReview(
  viewer: Viewer,
  repository: Pick<Repository, "owner">,
  pullRequest: Pick<PullRequest, "author" | "commit" | "status" | "reviewers">,
): boolean {
  if (!viewer || !pullRequest.commit) return false;
  if (pullRequest.status !== "open" && pullRequest.status !== "draft") return false;
  if (same(viewer, pullRequest.author)) return false;
  return (
    same(viewer, repository.owner) ||
    pullRequest.reviewers.some((reviewer) => same(viewer, reviewer))
  );
}

export type MergeBlocker =
  | "not-owner"
  | "not-open"
  | "missing-branch"
  | "missing-commit"
  | "missing-clone-url";

/**
 * Why the viewer cannot merge in the browser, or null when they may try.
 * Desktop restricts merging to the repository owner (the only identity whose
 * 1631 status other clients trust) and to open, non-draft PRs.
 */
export function mergeBlocker(
  viewer: Viewer,
  repository: Pick<Repository, "owner" | "cloneUrls">,
  pullRequest: Pick<PullRequest, "status" | "branchName" | "commit" | "cloneUrls">,
): MergeBlocker | null {
  if (!same(viewer, repository.owner)) return "not-owner";
  if (pullRequest.status !== "open") return "not-open";
  if (!pullRequest.branchName) return "missing-branch";
  if (!pullRequest.commit) return "missing-commit";
  if (!repository.cloneUrls[0] && !pullRequest.cloneUrls[0]) return "missing-clone-url";
  return null;
}
