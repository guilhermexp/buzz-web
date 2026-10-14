import {
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { Avatar } from "@/features/chat/ui/Avatar";
import { type MessageKey, t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { ForgeInputError } from "../../lib/forge-events";
import { ForgeGitError } from "../../lib/git-forge";
import type { WorkItemStatus } from "../../lib/work-items";

export const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
export const textareaClass =
  "min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring";
export const primaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
export const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-50";

const INPUT_ERROR_KEYS: Record<string, MessageKey> = {
  "repo-id-invalid": "projects.error.repoId",
  "repo-name-required": "projects.error.nameRequired",
  "project-name-required": "projects.error.nameRequired",
  "project-name-length": "projects.error.nameLength",
  "project-description-length": "projects.error.descriptionLength",
  "channel-invalid": "projects.error.channel",
  "clone-too-many": "projects.error.cloneUrls",
  "clone-invalid": "projects.error.cloneUrls",
  "clone-missing": "projects.error.cloneMissing",
  "project-not-owner": "projects.error.notProjectOwner",
  "repo-address-invalid": "projects.error.repoAddress",
  "project-member-exists": "projects.error.memberExists",
  "project-member-cap": "projects.error.memberCap",
  "title-required": "projects.error.titleRequired",
  "title-length": "projects.error.titleLength",
  "branch-same": "projects.error.branchSame",
  "commit-invalid": "projects.error.commit",
  "review-commit-missing": "projects.error.commit",
  "reviewers-invalid": "projects.error.reviewers",
  "comment-empty": "projects.error.commentEmpty",
  "anchor-invalid": "projects.error.anchor",
  "relay-unavailable": "projects.error.relay",
};

const GIT_ERROR_KEYS: Record<ForgeGitError["code"], MessageKey> = {
  branch_missing: "projects.git.branchMissing",
  branch_changed: "projects.git.branchChanged",
  revision_unavailable: "projects.git.revisionUnavailable",
  merge_conflict: "projects.git.mergeConflict",
  push_rejected: "projects.git.pushRejected",
  push_unverified: "projects.git.pushUnverified",
  transport: "projects.git.transport",
};

/** Localized message for a forge failure, with bounded server detail. */
export function forgeErrorMessage(error: unknown): string {
  if (error instanceof ForgeGitError) {
    const base = t(GIT_ERROR_KEYS[error.code]);
    const detail = error.rejection?.detail || (error.code === "transport" ? error.message : "");
    return detail ? `${base} ${detail.slice(0, 300)}` : base;
  }
  if (error instanceof Error) {
    const key = INPUT_ERROR_KEYS[error.message];
    if (key) return t(key);
    if (error instanceof ForgeInputError) return t("projects.error.generic");
    return error.message.slice(0, 300) || t("projects.error.generic");
  }
  return t("projects.error.generic");
}

export function shortOid(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 7) : "";
}

const STATUS_STYLE: Record<WorkItemStatus, string> = {
  open: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  draft: "border-foreground/15 bg-foreground/5 text-muted-foreground",
  closed: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
  merged: "border-violet-600/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

const STATUS_LABEL: Record<WorkItemStatus, MessageKey> = {
  open: "projects.status.open",
  draft: "projects.status.draft",
  closed: "projects.status.closed",
  merged: "projects.status.merged",
};

export function StatusBadge({ status, kind }: { status: WorkItemStatus; kind: "issue" | "pr" }) {
  const Icon =
    kind === "issue"
      ? CircleDot
      : status === "merged"
        ? GitMerge
        : status === "closed"
          ? GitPullRequestClosed
          : status === "draft"
            ? GitPullRequestDraft
            : GitPullRequest;
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${STATUS_STYLE[status]}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {t(STATUS_LABEL[status])}
    </span>
  );
}

export function useProfile(pubkey: string): UserProfile {
  const { profiles } = useWorkspace();
  return (
    profiles[pubkey] ?? {
      pubkey,
      name: truncatePubkey(pubkey),
      about: "",
      picture: null,
      isAgent: false,
    }
  );
}

export function PersonChip({ pubkey, size = 20 }: { pubkey: string; size?: number }) {
  const { relayUrl } = useWorkspace();
  const profile = useProfile(pubkey);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={pubkey}>
      <Avatar profile={profile} relayUrl={relayUrl} size={size} />
      <span className="truncate text-xs font-medium">{profile.name}</span>
    </span>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
      role="alert"
    >
      {children}
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t("projects.loading")} className="space-y-2" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          key={index}
          className="h-14 animate-pulse rounded-lg bg-foreground/[0.05]"
        />
      ))}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav
      aria-label={t("repos.breadcrumb")}
      className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm"
    >
      {items.map((item, index) => (
        <span key={item.label} className="flex min-w-0 items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
          ) : null}
          {item.onClick ? (
            <button
              className="truncate text-muted-foreground hover:text-foreground"
              type="button"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ) : (
            <span aria-current="page" className="truncate font-medium">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
