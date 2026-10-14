import { GitBranch, GitCommit, GitMerge } from "lucide-react";
import { type ReactNode, useState } from "react";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Repository } from "../../lib/nip34";
import type { PullRequest, PullRequestComment } from "../../lib/work-items";
import { CommentCard, CommentComposer, MarkdownBody } from "./Conversation";
import { PersonChip, StatusBadge, shortOid } from "./forge-ui";
import { MergePanel } from "./MergePanel";
import { PullRequestDiff } from "./PullRequestDiff";
import { PullRequestReview } from "./PullRequestReview";

function CommentAside({ comment }: { comment: PullRequestComment }) {
  const commit = comment.commit;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {comment.decision ? (
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${
            comment.decision === "approved"
              ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
              : "border-amber-600/30 text-amber-700 dark:text-amber-400"
          }`}
        >
          {comment.decision === "approved"
            ? t("projects.review.approvedBadge")
            : t("projects.review.changesBadge")}
        </span>
      ) : null}
      {comment.isTrustedReviewRequest ? (
        <span className="rounded-full border px-2 py-0.5">{t("projects.review.requestBadge")}</span>
      ) : null}
      {comment.anchor ? (
        <span className="font-mono text-muted-foreground">
          {comment.anchor.path}:{comment.anchor.line}
        </span>
      ) : null}
      {commit && comment.revisionStatus ? (
        <span
          className={`rounded-full border px-2 py-0.5 font-mono ${
            comment.revisionStatus === "current" ? "" : "text-muted-foreground"
          }`}
          title={commit}
        >
          {comment.revisionStatus === "current"
            ? t("projects.review.currentRevision", { commit: shortOid(commit) })
            : t("projects.review.historicalRevision", { commit: shortOid(commit) })}
        </span>
      ) : null}
    </span>
  );
}

export function PullRequestView({
  repository,
  pullRequest,
  defaultBranch,
  breadcrumbs,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  defaultBranch: string;
  breadcrumbs: ReactNode;
}) {
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const targetBranch = pullRequest.targetBranch ?? defaultBranch;
  const revisions = pullRequest.revisions;
  const current = revisions[revisions.length - 1] ?? null;
  const revision = revisions.find((candidate) => candidate.id === revisionId) ?? current;

  return (
    <div className="mt-8">
      {breadcrumbs}
      <header className="mt-5 border-b pb-5">
        <h3 className="break-words text-xl font-semibold">{pullRequest.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge kind="pr" status={pullRequest.status} />
          <PersonChip pubkey={pullRequest.author} />
          <span>{t("projects.openedAt", { time: relativeTime(pullRequest.createdAt) })}</span>
          {pullRequest.branchName ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
              {t("projects.pr.branches", { source: pullRequest.branchName, target: targetBranch })}
            </span>
          ) : null}
          {pullRequest.mergeCommit ? (
            <span
              className="inline-flex items-center gap-1 font-mono"
              title={pullRequest.mergeCommit}
            >
              <GitMerge aria-hidden="true" className="h-3.5 w-3.5" />
              {t("projects.pr.mergedAs", { commit: shortOid(pullRequest.mergeCommit) })}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-3 border-b">
            <div className="flex gap-1" role="tablist" aria-label={t("projects.pr.sections")}>
              {(
                [
                  ["conversation", t("projects.pr.conversation")],
                  ["files", t("projects.pr.files")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-selected={tab === value}
                  className={`px-3 py-2 text-sm font-medium ${
                    tab === value
                      ? "border-b-2 border-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  role="tab"
                  type="button"
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {revisions.length ? (
              <label className="mb-1.5 flex items-center gap-2 text-xs">
                <GitCommit aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <span className="sr-only">{t("projects.pr.revision")}</span>
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 font-mono text-xs"
                  value={revision?.id ?? ""}
                  onChange={(event) => setRevisionId(event.target.value)}
                >
                  {revisions.map((candidate, index) => (
                    <option key={candidate.id} value={candidate.id}>
                      {t(
                        index === revisions.length - 1
                          ? "projects.pr.revisionCurrent"
                          : "projects.pr.revisionOption",
                        {
                          number: index + 1,
                          commit: shortOid(candidate.commit),
                        },
                      )}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {tab === "conversation" ? (
            <div className="mt-4 space-y-3">
              <article className="rounded-lg border px-3 py-2.5">
                {pullRequest.content.trim() ? (
                  <MarkdownBody content={pullRequest.content} />
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    {t("projects.noDescription")}
                  </p>
                )}
              </article>
              {pullRequest.updates.map((update) => (
                <p
                  key={update.id}
                  className="flex items-center gap-2 px-1 text-xs text-muted-foreground"
                >
                  <GitCommit aria-hidden="true" className="h-3.5 w-3.5" />
                  <PersonChip pubkey={update.author} size={16} />
                  {t("projects.pr.revisionPushed", {
                    commit: shortOid(update.commit),
                    time: relativeTime(update.createdAt),
                  })}
                </p>
              ))}
              {pullRequest.comments.map((comment) => (
                <CommentCard
                  key={comment.id}
                  aside={<CommentAside comment={comment} />}
                  author={comment.author}
                  content={comment.content}
                  createdAt={comment.createdAt}
                />
              ))}
              <CommentComposer
                label={t("projects.comments.placeholder")}
                repository={repository}
                rootAuthor={pullRequest.author}
                rootId={pullRequest.id}
              />
            </div>
          ) : (
            <PullRequestDiff
              pullRequest={pullRequest}
              repository={repository}
              revision={revision}
              targetBranch={targetBranch}
            />
          )}
        </div>

        <aside className="space-y-4">
          <PullRequestReview
            pullRequest={pullRequest}
            repository={repository}
            targetBranch={targetBranch}
          />
          <MergePanel
            pullRequest={pullRequest}
            repository={repository}
            targetBranch={targetBranch}
          />
        </aside>
      </div>
    </div>
  );
}
