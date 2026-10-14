/**
 * Event templates for Buzz project forge writes. Shapes follow buzz-sdk
 * builders.rs and Buzz Desktop (projectCreation.ts, pullRequestMutations.ts,
 * pullRequestReviews.ts, projectIssues.mjs). Validation failures throw an
 * Error whose message is a stable code the UI maps to localized copy.
 */
import type { EventTemplate } from "@/shared/api/nostr-types";
import {
  isHexPubkey,
  isValidChannelId,
  isValidRepoId,
  KIND_GIT_ISSUE,
  KIND_GIT_PR_UPDATE,
  KIND_GIT_PULL_REQUEST,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_DRAFT,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_OPEN,
  KIND_PROJECT,
  KIND_REPO_ANNOUNCEMENT,
  KIND_TEXT_NOTE,
  MAX_PROJECT_MEMBERS,
  parseRepositoryAddress,
  type Repository,
  validateProjectTags,
} from "./nip34";
import type { CommentAnchor, PullRequest } from "./work-items";
import {
  normalizeCommentAnchor,
  PR_APPROVAL_LABEL,
  PR_CHANGES_REQUESTED_LABEL,
  PR_INLINE_COMMENT_LABEL,
  PR_REVIEW_REQUEST_LABEL,
} from "./work-items";

export class ForgeInputError extends Error {}

const encoder = new TextEncoder();

function requireCommit(value: string, code: string): string {
  const commit = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) throw new ForgeInputError(code);
  return commit;
}

function uniquePubkeys(pubkeys: readonly string[]): string[] {
  return [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))];
}

export function buildRepositoryTemplate(input: {
  dtag: string;
  name: string;
  description: string;
  channelId: string;
  cloneUrls: readonly string[];
  webUrl?: string;
}): EventTemplate {
  if (!isValidRepoId(input.dtag)) throw new ForgeInputError("repo-id-invalid");
  const name = input.name.trim();
  if (!name) throw new ForgeInputError("repo-name-required");
  if (!isValidChannelId(input.channelId)) throw new ForgeInputError("channel-invalid");
  const description = input.description.trim();
  const cloneUrls = input.cloneUrls.map((url) => url.trim()).filter(Boolean);
  if (cloneUrls.length > 5) throw new ForgeInputError("clone-too-many");
  if (cloneUrls.some((url) => !/^https?:\/\//.test(url)))
    throw new ForgeInputError("clone-invalid");
  const tags: string[][] = [
    ["d", input.dtag],
    ["name", name],
  ];
  if (description) tags.push(["description", description]);
  if (cloneUrls.length) tags.push(["clone", ...cloneUrls]);
  const webUrl = input.webUrl?.trim();
  if (webUrl) tags.push(["web", webUrl]);
  tags.push(["buzz-channel", input.channelId]);
  return { kind: KIND_REPO_ANNOUNCEMENT, content: "", tags };
}

export function buildProjectTemplate(input: {
  dtag: string;
  name: string;
  description: string;
  channelId: string;
  visibility: "listed" | "unlisted";
  repositoryAddresses: readonly string[];
}): EventTemplate {
  const name = input.name.trim();
  if (!name) throw new ForgeInputError("project-name-required");
  if (encoder.encode(name).byteLength > 256) throw new ForgeInputError("project-name-length");
  const description = input.description.trim();
  if (encoder.encode(description).byteLength > 2_048) {
    throw new ForgeInputError("project-description-length");
  }
  if (!input.dtag) throw new ForgeInputError("project-name-required");
  if (!isValidChannelId(input.channelId)) throw new ForgeInputError("channel-invalid");
  const tags: string[][] = [
    ["d", input.dtag],
    ["name", name],
    ["buzz-channel", input.channelId],
  ];
  if (description) tags.push(["description", description]);
  if (input.visibility === "unlisted") tags.push(["buzz-visibility", "unlisted"]);
  for (const address of [...new Set(input.repositoryAddresses)].sort()) tags.push(["a", address]);
  validateProjectTags(tags);
  return { kind: KIND_PROJECT, content: "", tags };
}

/**
 * Read-modify-write a project head: only `a` membership changes; every other
 * tag (including unknown extensions and relay hints) is preserved verbatim.
 */
export function buildProjectMembershipTemplate(input: {
  liveHead: { pubkey: string; tags: string[][]; content: string; created_at: number };
  viewerPubkey: string;
  add?: readonly string[];
  remove?: readonly string[];
  now: number;
}): EventTemplate {
  if (input.liveHead.pubkey.toLowerCase() !== input.viewerPubkey.toLowerCase()) {
    throw new ForgeInputError("project-not-owner");
  }
  const hints = new Map<string, string>();
  for (const tag of input.liveHead.tags) {
    if (tag[0] === "a" && tag[1] && tag[2]) hints.set(tag[1], tag[2]);
  }
  const removed = new Set(input.remove ?? []);
  const current = input.liveHead.tags
    .filter((tag) => tag[0] === "a" && tag[1])
    .map((tag) => tag[1] as string);
  for (const address of input.add ?? []) {
    if (!parseRepositoryAddress(address)) throw new ForgeInputError("repo-address-invalid");
    if (current.includes(address)) throw new ForgeInputError("project-member-exists");
  }
  const members = [...new Set([...current, ...(input.add ?? [])])]
    .filter((address) => !removed.has(address))
    .sort();
  if (members.length > MAX_PROJECT_MEMBERS) throw new ForgeInputError("project-member-cap");
  const tags = [
    ...input.liveHead.tags
      .filter((tag) => tag[0] !== "a" && tag[0] !== "auth")
      .map((tag) => [...tag]),
    ...members.map((address) => {
      const hint = hints.get(address);
      return hint ? ["a", address, hint] : ["a", address];
    }),
  ];
  validateProjectTags(tags);
  return {
    kind: KIND_PROJECT,
    content: input.liveHead.content,
    tags,
    created_at: Math.max(input.now, input.liveHead.created_at + 1),
  };
}

/** A project may only claim repositories its signer owns or maintains (NIP-MP). */
export function canClaimRepository(repository: Repository, projectOwner: string): boolean {
  const owner = projectOwner.toLowerCase();
  return repository.owner === owner || repository.maintainers.includes(owner);
}

export function buildIssueTemplate(input: {
  repository: Pick<Repository, "address" | "owner">;
  title: string;
  body: string;
  labels?: readonly string[];
}): EventTemplate {
  const subject = input.title.trim();
  if (!subject) throw new ForgeInputError("title-required");
  if (subject.length > 256) throw new ForgeInputError("title-length");
  const tags: string[][] = [
    ["a", input.repository.address],
    ["p", input.repository.owner],
    ["subject", subject],
  ];
  for (const label of input.labels ?? []) {
    if (label.trim()) tags.push(["t", label.trim()]);
  }
  return { kind: KIND_GIT_ISSUE, content: input.body.trim(), tags };
}

export function buildPullRequestTemplate(input: {
  repository: Pick<Repository, "address" | "owner" | "cloneUrls">;
  title: string;
  body: string;
  branch: string;
  targetBranch: string;
  commit: string;
  mergeBase: string | null;
  reviewers: readonly string[];
}): EventTemplate {
  const subject = input.title.trim();
  if (!subject) throw new ForgeInputError("title-required");
  if (subject.length > 256) throw new ForgeInputError("title-length");
  if (!input.repository.cloneUrls.length) throw new ForgeInputError("clone-missing");
  if (!input.branch || input.branch === input.targetBranch) {
    throw new ForgeInputError("branch-same");
  }
  const tags: string[][] = [
    ["a", input.repository.address],
    ...uniquePubkeys([input.repository.owner, ...input.reviewers]).map((pubkey) => ["p", pubkey]),
    ["subject", subject],
    ["c", requireCommit(input.commit, "commit-invalid")],
    ["clone", ...input.repository.cloneUrls],
    ["branch-name", input.branch],
    ["target-branch", input.targetBranch],
  ];
  if (input.mergeBase) tags.push(["merge-base", requireCommit(input.mergeBase, "commit-invalid")]);
  return { kind: KIND_GIT_PULL_REQUEST, content: input.body.trim(), tags };
}

/** NIP-34 PR update (new revision); created_at strictly after prior updates. */
export function buildPullRequestUpdateTemplate(input: {
  repository: Pick<Repository, "address" | "owner" | "cloneUrls">;
  pullRequest: Pick<PullRequest, "id" | "author" | "cloneUrls" | "updates">;
  commit: string;
  mergeBase: string | null;
  now: number;
}): EventTemplate {
  const { pullRequest, repository } = input;
  const tags: string[][] = [
    ["a", repository.address],
    ...uniquePubkeys([repository.owner, pullRequest.author]).map((pubkey) => ["p", pubkey]),
    ["E", pullRequest.id],
    ["P", pullRequest.author.toLowerCase()],
    ["c", requireCommit(input.commit, "commit-invalid")],
    ["clone", ...(pullRequest.cloneUrls.length ? pullRequest.cloneUrls : repository.cloneUrls)],
  ];
  if (input.mergeBase) tags.push(["merge-base", requireCommit(input.mergeBase, "commit-invalid")]);
  return {
    kind: KIND_GIT_PR_UPDATE,
    content: "",
    tags,
    created_at: Math.max(input.now, ...pullRequest.updates.map((update) => update.createdAt + 1)),
  };
}

export type LifecycleStatus = "open" | "draft" | "closed";

const STATUS_KIND: Record<LifecycleStatus, number> = {
  open: KIND_GIT_STATUS_OPEN,
  draft: KIND_GIT_STATUS_DRAFT,
  closed: KIND_GIT_STATUS_CLOSED,
};

/**
 * Lifecycle status for an issue or PR root. Merged (1631) is deliberately
 * not offered here: it is only published by `buildMergedStatusTemplate`
 * after a successful git push.
 */
export function buildStatusTemplate(input: {
  rootId: string;
  rootAuthor: string;
  repository: Pick<Repository, "address" | "owner">;
  status: LifecycleStatus;
  createdAt: number;
}): EventTemplate {
  return {
    kind: STATUS_KIND[input.status],
    content: "",
    created_at: input.createdAt,
    tags: [
      ["e", input.rootId, "", "root"],
      ["a", input.repository.address],
      ...uniquePubkeys([input.repository.owner, input.rootAuthor]).map((pubkey) => ["p", pubkey]),
    ],
  };
}

export function buildMergedStatusTemplate(input: {
  pullRequest: Pick<PullRequest, "id" | "author">;
  repository: Pick<Repository, "address" | "owner">;
  mergeCommit: string;
  createdAt: number;
}): EventTemplate {
  const mergeCommit = requireCommit(input.mergeCommit, "commit-invalid");
  return {
    kind: KIND_GIT_STATUS_MERGED,
    content: "",
    created_at: input.createdAt,
    tags: [
      ["e", input.pullRequest.id, "", "root"],
      ["a", input.repository.address],
      ...uniquePubkeys([input.repository.owner, input.pullRequest.author]).map((pubkey) => [
        "p",
        pubkey,
      ]),
      ["merge-commit", mergeCommit],
      ["r", mergeCommit],
    ],
  };
}

export type ReviewDecision = "approve" | "request-changes";

/** Approve / request changes on the PR's current revision (labeled kind 1). */
export function buildReviewDecisionTemplate(input: {
  pullRequest: Pick<PullRequest, "id" | "author" | "commit">;
  repository: Pick<Repository, "address" | "owner">;
  decision: ReviewDecision;
  content: string;
  defaultContent: string;
  createdAt: number;
}): EventTemplate {
  if (!input.pullRequest.commit) throw new ForgeInputError("review-commit-missing");
  return {
    kind: KIND_TEXT_NOTE,
    content: input.content.trim() || input.defaultContent,
    created_at: input.createdAt,
    tags: [
      ["e", input.pullRequest.id, "", "root"],
      ["a", input.repository.address],
      ...uniquePubkeys([input.repository.owner, input.pullRequest.author]).map((pubkey) => [
        "p",
        pubkey,
      ]),
      ["t", input.decision === "approve" ? PR_APPROVAL_LABEL : PR_CHANGES_REQUESTED_LABEL],
      ["c", input.pullRequest.commit],
    ],
  };
}

export function buildReviewRequestTemplate(input: {
  pullRequestId: string;
  repository: Pick<Repository, "address">;
  reviewers: readonly string[];
  content: string;
}): EventTemplate {
  const reviewers = uniquePubkeys(input.reviewers);
  if (!reviewers.length || reviewers.some((pubkey) => !isHexPubkey(pubkey))) {
    throw new ForgeInputError("reviewers-invalid");
  }
  return {
    kind: KIND_TEXT_NOTE,
    content: input.content,
    tags: [
      ["e", input.pullRequestId, "", "root"],
      ["a", input.repository.address],
      ...reviewers.map((pubkey) => ["p", pubkey]),
      ["t", PR_REVIEW_REQUEST_LABEL],
    ],
  };
}

/**
 * Comment on an issue or PR root. With an anchor it becomes an inline review
 * comment bound to `commit` + file + side + line (desktop hooks.ts shape).
 */
export function buildCommentTemplate(input: {
  rootId: string;
  rootAuthor: string;
  repository: Pick<Repository, "address" | "owner">;
  content: string;
  anchor?: CommentAnchor & { commit: string };
  createdAt?: number;
}): EventTemplate {
  const body = input.content.trim();
  if (!body) throw new ForgeInputError("comment-empty");
  const tags: string[][] = [
    ["e", input.rootId, "", "root"],
    ["a", input.repository.address],
    ...uniquePubkeys([input.repository.owner, input.rootAuthor]).map((pubkey) => ["p", pubkey]),
  ];
  if (input.anchor) {
    const anchor = normalizeCommentAnchor(input.anchor);
    if (!anchor) throw new ForgeInputError("anchor-invalid");
    tags.push(
      ["t", PR_INLINE_COMMENT_LABEL],
      ["c", requireCommit(input.anchor.commit, "commit-invalid")],
      ["file", anchor.path],
      ["side", anchor.side],
      ["line", String(anchor.line)],
    );
  }
  return { kind: KIND_TEXT_NOTE, content: body, tags, created_at: input.createdAt };
}
