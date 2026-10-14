/**
 * Client-side folding of NIP-34 work items (issues 1621, PRs 1618 + updates
 * 1619, statuses 1630-1633, labeled kind 1 review comments). Trust rules are
 * Buzz Desktop's (projectPullRequests.mjs / projectIssues.mjs): lifecycle and
 * revision changes count only from the root author or repository owner; review
 * decisions only from requested reviewers or the owner, never the PR author,
 * and only for the PR's current commit.
 */
import type { NostrEvent } from "@/shared/api/nostr-types";
import {
  getAllTags,
  getTag,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_DRAFT,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_OPEN,
} from "./nip34";

export const PR_REVIEW_REQUEST_LABEL = "review-request";
export const PR_APPROVAL_LABEL = "approval";
export const PR_CHANGES_REQUESTED_LABEL = "changes-requested";
export const PR_INLINE_COMMENT_LABEL = "inline-comment";

export type WorkItemStatus = "open" | "draft" | "closed" | "merged";

export interface CommentAnchor {
  path: string;
  side: "old" | "new";
  line: number;
}

/** Validate an inline diff anchor without normalizing attacker-controlled paths. */
export function normalizeCommentAnchor(anchor: {
  path?: unknown;
  side?: unknown;
  line?: unknown;
}): CommentAnchor | null {
  const { path, side, line } = anchor;
  if (typeof path !== "string" || !path || path.length > 4_096) return null;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  if (side !== "old" && side !== "new") return null;
  if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1) return null;
  return { path, side, line };
}

/** Root author plus the owner named by the root's repository `a` tag. */
export function allowedActorsForRoot(root: NostrEvent): Set<string> {
  const allowed = new Set([root.pubkey.toLowerCase()]);
  const owner = (getTag(root, "a") ?? "").split(":")[1] ?? "";
  if (/^[0-9a-fA-F]{64}$/.test(owner)) allowed.add(owner.toLowerCase());
  return allowed;
}

function referencesRoot(event: NostrEvent, rootId: string): boolean {
  return event.tags.some((tag) => (tag[0] === "e" || tag[0] === "E") && tag[1] === rootId);
}

function latestTrustedStatus(root: NostrEvent, statuses: readonly NostrEvent[]) {
  const allowed = allowedActorsForRoot(root);
  let latest: NostrEvent | undefined;
  for (const event of statuses) {
    if (!allowed.has(event.pubkey.toLowerCase()) || !referencesRoot(event, root.id)) continue;
    if (!latest || event.created_at > latest.created_at) latest = event;
  }
  return latest;
}

function statusFromKind(kind: number | undefined, root: NostrEvent): WorkItemStatus {
  if (kind === KIND_GIT_STATUS_OPEN) return "open";
  if (kind === KIND_GIT_STATUS_MERGED) return "merged";
  if (kind === KIND_GIT_STATUS_CLOSED) return "closed";
  if (kind === KIND_GIT_STATUS_DRAFT) return "draft";
  return getAllTags(root, "t").some((label) => label.toLowerCase() === "draft") ? "draft" : "open";
}

export interface WorkItemComment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  commit: string | null;
  anchor: CommentAnchor | null;
  labels: string[];
  mentions: string[];
}

function eventToComment(event: NostrEvent): WorkItemComment {
  const lineTag = getTag(event, "line");
  const labels = getAllTags(event, "t").map((label) => label.toLowerCase());
  const isDecisionOrRequest =
    labels.includes(PR_REVIEW_REQUEST_LABEL) || labels.includes(PR_APPROVAL_LABEL);
  return {
    id: event.id,
    author: event.pubkey.toLowerCase(),
    content: event.content,
    createdAt: event.created_at,
    commit: getTag(event, "c") ?? null,
    anchor: isDecisionOrRequest
      ? null
      : normalizeCommentAnchor({
          path: getTag(event, "file"),
          side: getTag(event, "side"),
          line: lineTag && /^[1-9]\d*$/.test(lineTag) ? Number(lineTag) : Number.NaN,
        }),
    labels,
    mentions: getAllTags(event, "p").map((pubkey) => pubkey.toLowerCase()),
  };
}

function commentsFor(rootId: string, comments: readonly NostrEvent[]): WorkItemComment[] {
  return comments
    .filter((event) => referencesRoot(event, rootId))
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
    .map(eventToComment);
}

export interface Issue {
  id: string;
  title: string;
  content: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  repoAddress: string | null;
  labels: string[];
  status: WorkItemStatus;
  statusCreatedAt: number | null;
  comments: WorkItemComment[];
}

export function foldIssues(
  issues: readonly NostrEvent[],
  statuses: readonly NostrEvent[],
  comments: readonly NostrEvent[],
): Issue[] {
  return issues
    .map((issue) => {
      const status = latestTrustedStatus(issue, statuses);
      const issueComments = commentsFor(issue.id, comments);
      return {
        id: issue.id,
        title: getTag(issue, "subject") || issue.content.split("\n")[0] || "",
        content: issue.content,
        author: issue.pubkey.toLowerCase(),
        createdAt: issue.created_at,
        updatedAt: Math.max(
          issue.created_at,
          status?.created_at ?? 0,
          ...issueComments.map((comment) => comment.createdAt),
        ),
        repoAddress: getTag(issue, "a") ?? null,
        labels: getAllTags(issue, "t"),
        status: statusFromKind(status?.kind, issue),
        statusCreatedAt: status?.created_at ?? null,
        comments: issueComments,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export interface PullRequestRevision {
  /** PR root id for the initial revision, else the 1619 update id. */
  id: string;
  commit: string;
  createdAt: number;
  author: string;
  cloneUrls: string[];
  mergeBase: string | null;
}

export interface ReviewDecisionEntry {
  id: string;
  author: string;
  createdAt: number;
  commit: string;
  decision: "approved" | "changes-requested";
}

export interface PullRequestComment extends WorkItemComment {
  /** Trusted review decision label on this comment, if any. */
  decision: "approved" | "changes-requested" | null;
  /** "current" when bound to the PR's current revision, else "historical". */
  revisionStatus: "current" | "historical" | null;
  isTrustedReviewRequest: boolean;
}

export interface PullRequest {
  id: string;
  title: string;
  content: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  repoAddress: string | null;
  labels: string[];
  recipients: string[];
  reviewers: string[];
  status: WorkItemStatus;
  statusCreatedAt: number | null;
  mergeCommit: string | null;
  branchName: string | null;
  targetBranch: string | null;
  initialCommit: string | null;
  commit: string | null;
  mergeBase: string | null;
  cloneUrls: string[];
  updates: PullRequestRevision[];
  revisions: PullRequestRevision[];
  approvals: ReviewDecisionEntry[];
  changeRequests: ReviewDecisionEntry[];
  comments: PullRequestComment[];
}

function cloneUrlsOf(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "clone")
    .flatMap((tag) => tag.slice(1))
    .filter(Boolean);
}

function toRevision(event: NostrEvent): PullRequestRevision | null {
  const commit = getTag(event, "c");
  if (!commit) return null;
  return {
    id: event.id,
    commit: commit.toLowerCase(),
    createdAt: event.created_at,
    author: event.pubkey.toLowerCase(),
    cloneUrls: cloneUrlsOf(event),
    mergeBase: getTag(event, "merge-base") ?? null,
  };
}

function decisionOf(comment: WorkItemComment): "approved" | "changes-requested" | null {
  const approve = comment.labels.includes(PR_APPROVAL_LABEL);
  const change = comment.labels.includes(PR_CHANGES_REQUESTED_LABEL);
  if (approve === change) return null;
  return approve ? "approved" : "changes-requested";
}

export function foldPullRequest(
  root: NostrEvent,
  updates: readonly NostrEvent[],
  commentEvents: readonly NostrEvent[],
  statuses: readonly NostrEvent[],
): PullRequest {
  const allowed = allowedActorsForRoot(root);
  const author = root.pubkey.toLowerCase();
  const trustedUpdates = updates
    .filter((event) => allowed.has(event.pubkey.toLowerCase()) && getTag(event, "E") === root.id)
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
    .flatMap((event) => {
      const revision = toRevision(event);
      return revision ? [revision] : [];
    });
  const initial = toRevision(root);
  const latest = trustedUpdates[trustedUpdates.length - 1] ?? initial;
  const initialCommit = initial?.commit ?? null;
  const currentCommit = latest?.commit ?? null;
  const status = latestTrustedStatus(root, statuses);
  const parsed = commentsFor(root.id, commentEvents);

  const reviewers = new Set(getAllTags(root, "p").map((pubkey) => pubkey.toLowerCase()));
  for (const comment of parsed) {
    if (comment.labels.includes(PR_REVIEW_REQUEST_LABEL) && allowed.has(comment.author)) {
      for (const pubkey of comment.mentions) reviewers.add(pubkey);
    }
  }
  reviewers.delete(author);
  const trustedReviewers = new Set(reviewers);
  for (const actor of allowed) if (actor !== author) trustedReviewers.add(actor);

  const comments: PullRequestComment[] = parsed.map((comment) => {
    const decision = decisionOf(comment);
    const trustedDecision = decision && trustedReviewers.has(comment.author) ? decision : null;
    const commit = comment.commit ?? initialCommit;
    const bound = Boolean(trustedDecision || comment.anchor);
    return {
      ...comment,
      decision: trustedDecision,
      revisionStatus: bound
        ? currentCommit && commit === currentCommit
          ? "current"
          : "historical"
        : null,
      isTrustedReviewRequest:
        comment.labels.includes(PR_REVIEW_REQUEST_LABEL) && allowed.has(comment.author),
    };
  });

  const byReviewer = new Map<string, ReviewDecisionEntry>();
  for (const comment of comments) {
    if (!comment.decision || comment.revisionStatus !== "current" || !currentCommit) continue;
    const existing = byReviewer.get(comment.author);
    if (
      !existing ||
      comment.createdAt > existing.createdAt ||
      (comment.createdAt === existing.createdAt && comment.id > existing.id)
    ) {
      byReviewer.set(comment.author, {
        id: comment.id,
        author: comment.author,
        createdAt: comment.createdAt,
        commit: currentCommit,
        decision: comment.decision,
      });
    }
  }
  const decisions = [...byReviewer.values()].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );

  return {
    id: root.id,
    title: getTag(root, "subject") || root.content.split("\n")[0] || "",
    content: root.content,
    author,
    createdAt: root.created_at,
    updatedAt: Math.max(
      root.created_at,
      status?.created_at ?? 0,
      ...trustedUpdates.map((update) => update.createdAt),
      ...comments.map((comment) => comment.createdAt),
    ),
    repoAddress: getTag(root, "a") ?? null,
    labels: getAllTags(root, "t"),
    recipients: getAllTags(root, "p").map((pubkey) => pubkey.toLowerCase()),
    reviewers: [...reviewers],
    status: statusFromKind(status?.kind, root),
    statusCreatedAt: status?.created_at ?? null,
    mergeCommit:
      status?.kind === KIND_GIT_STATUS_MERGED ? (getTag(status, "merge-commit") ?? null) : null,
    branchName: getTag(root, "branch-name") ?? null,
    targetBranch: getTag(root, "target-branch") ?? null,
    initialCommit,
    commit: currentCommit,
    mergeBase: latest?.mergeBase ?? null,
    cloneUrls: latest?.cloneUrls.length ? latest.cloneUrls : cloneUrlsOf(root),
    updates: trustedUpdates,
    revisions: [...(initial ? [initial] : []), ...trustedUpdates],
    approvals: decisions.filter((decision) => decision.decision === "approved"),
    changeRequests: decisions.filter((decision) => decision.decision === "changes-requested"),
    comments,
  };
}

export function foldPullRequests(
  roots: readonly NostrEvent[],
  updates: readonly NostrEvent[],
  comments: readonly NostrEvent[],
  statuses: readonly NostrEvent[],
): PullRequest[] {
  return roots
    .map((root) => foldPullRequest(root, updates, comments, statuses))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Keep consecutive lifecycle writes ordered within one whole-second timestamp. */
export function nextStatusCreatedAt(item: { statusCreatedAt: number | null }, now: number): number {
  return Math.max(now, (item.statusCreatedAt ?? 0) + 1);
}

/** Keep a reviewer's consecutive decisions ordered across whole-second timestamps. */
export function nextReviewCreatedAt(pullRequest: PullRequest, now: number): number {
  return Math.max(
    now,
    ...[...pullRequest.approvals, ...pullRequest.changeRequests].map(
      (decision) => decision.createdAt + 1,
    ),
  );
}

export function workItemCounts(items: readonly { status: WorkItemStatus }[]) {
  const counts: Record<WorkItemStatus, number> = { open: 0, draft: 0, closed: 0, merged: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
