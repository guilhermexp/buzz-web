import {
  Check,
  CircleSlash,
  FileWarning,
  GitPullRequestDraft,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import {
  buildPullRequestUpdateTemplate,
  buildReviewDecisionTemplate,
  buildReviewRequestTemplate,
  type ReviewDecision,
} from "../../lib/forge-events";
import { resolveBranchRevision } from "../../lib/git-forge";
import type { Repository } from "../../lib/nip34";
import { canChangeStatus, canPublishRevision, canReview } from "../../lib/permissions";
import { nextReviewCreatedAt, type PullRequest } from "../../lib/work-items";
import { useForgePublish } from "../../use-forge";
import { openRepositoryStore } from "../../use-forge-git";
import {
  forgeErrorMessage,
  PersonChip,
  secondaryButton,
  shortOid,
  textareaClass,
} from "./forge-ui";
import { useLifecycle } from "./IssueViews";

/** Review summary, decisions and permission-aware lifecycle controls. */
export function PullRequestReview({
  repository,
  pullRequest,
  targetBranch,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  targetBranch: string;
}) {
  const { pubkey, profiles, relayUrl } = useWorkspace();
  const publish = useForgePublish();
  const lifecycle = useLifecycle(repository);
  const [summary, setSummary] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const lastDecisionAt = useRef(0);
  const mayReview = canReview(pubkey, repository, pullRequest);
  const mayChange = canChangeStatus(pubkey, repository, pullRequest);
  const mayUpdate = canPublishRevision(pubkey, repository, pullRequest);
  const status = pullRequest.status;
  const candidates = Object.keys(profiles).filter(
    (candidate) => candidate !== pullRequest.author && !pullRequest.reviewers.includes(candidate),
  );

  const decide = async (decision: ReviewDecision) => {
    const createdAt = Math.max(
      nextReviewCreatedAt(pullRequest, Math.floor(Date.now() / 1_000)),
      lastDecisionAt.current + 1,
    );
    lastDecisionAt.current = createdAt;
    try {
      await publish.mutateAsync([
        buildReviewDecisionTemplate({
          pullRequest,
          repository,
          decision,
          content: summary,
          defaultContent: decision === "approve" ? "Approved these changes" : "Requested changes",
          createdAt,
        }),
      ]);
      setSummary("");
      toast.success(
        decision === "approve"
          ? t("projects.review.approved")
          : t("projects.review.changesRequested"),
      );
    } catch (error) {
      toast.error(forgeErrorMessage(error));
    }
  };

  const requestReview = async () => {
    try {
      const name = profiles[reviewer]?.name ?? reviewer.slice(0, 12);
      await publish.mutateAsync([
        buildReviewRequestTemplate({
          pullRequestId: pullRequest.id,
          repository,
          reviewers: [reviewer],
          content: `Requested a review from ${name}`,
        }),
      ]);
      setReviewer("");
      toast.success(t("projects.review.requested"));
    } catch (error) {
      toast.error(forgeErrorMessage(error));
    }
  };

  const refreshRevision = async () => {
    if (!pullRequest.branchName) return;
    setRefreshing(true);
    try {
      const handle = await openRepositoryStore(relayUrl, pubkey, repository);
      const targetUrl = repository.cloneUrls[0] as string;
      const revision = await resolveBranchRevision({
        handle,
        sourceUrl: pullRequest.cloneUrls[0] ?? targetUrl,
        sourceBranch: pullRequest.branchName,
        targetUrl,
        targetBranch,
      });
      if (revision.commit === pullRequest.commit) {
        toast.info(t("projects.pr.upToDate"));
        return;
      }
      await publish.mutateAsync([
        buildPullRequestUpdateTemplate({
          repository,
          pullRequest,
          commit: revision.commit,
          mergeBase: revision.mergeBase,
          now: Math.floor(Date.now() / 1_000),
        }),
      ]);
      toast.success(t("projects.pr.updated", { commit: shortOid(revision.commit) }));
    } catch (error) {
      toast.error(forgeErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section aria-label={t("projects.review.title")} className="space-y-4 rounded-lg border p-4">
      <div>
        <h4 className="text-sm font-semibold">{t("projects.review.title")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("projects.review.summary", {
            approvals: pullRequest.approvals.length,
            changes: pullRequest.changeRequests.length,
            commit: shortOid(pullRequest.commit),
          })}
        </p>
      </div>
      {pullRequest.reviewers.length ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("projects.review.reviewers")}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {pullRequest.reviewers.map((reviewerKey) => {
              const decision = [...pullRequest.approvals, ...pullRequest.changeRequests].find(
                (entry) => entry.author === reviewerKey,
              );
              return (
                <li key={reviewerKey} className="flex items-center gap-2">
                  <PersonChip pubkey={reviewerKey} />
                  {decision ? (
                    decision.decision === "approved" ? (
                      <Check
                        aria-label={t("projects.review.approvedBadge")}
                        className="h-4 w-4 text-emerald-600"
                      />
                    ) : (
                      <FileWarning
                        aria-label={t("projects.review.changesBadge")}
                        className="h-4 w-4 text-amber-600"
                      />
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {mayReview ? (
        <div className="space-y-2">
          <textarea
            aria-label={t("projects.review.summaryPlaceholder")}
            className={textareaClass}
            placeholder={t("projects.review.summaryPlaceholder")}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("projects.review.appliesTo", { commit: shortOid(pullRequest.commit) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={secondaryButton}
              disabled={publish.isPending}
              type="button"
              onClick={() => void decide("approve")}
            >
              <Check className="h-4 w-4" />
              {t("projects.review.approve")}
            </button>
            <button
              className={secondaryButton}
              disabled={publish.isPending}
              type="button"
              onClick={() => void decide("request-changes")}
            >
              <FileWarning className="h-4 w-4" />
              {t("projects.review.requestChanges")}
            </button>
          </div>
        </div>
      ) : null}

      {mayChange && (status === "open" || status === "draft") && candidates.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`reviewer-${pullRequest.id}`}>
            {t("projects.review.chooseReviewer")}
          </label>
          <select
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
            id={`reviewer-${pullRequest.id}`}
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
          >
            <option value="">{t("projects.review.chooseReviewer")}</option>
            {candidates.map((candidate) => (
              <option key={candidate} value={candidate}>
                {profiles[candidate]?.name ?? candidate.slice(0, 12)}
              </option>
            ))}
          </select>
          <button
            className={secondaryButton}
            disabled={!reviewer || publish.isPending}
            type="button"
            onClick={() => void requestReview()}
          >
            <UserPlus className="h-4 w-4" />
            {t("projects.review.request")}
          </button>
        </div>
      ) : null}

      {mayChange || mayUpdate ? (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {mayUpdate && (status === "open" || status === "draft") && pullRequest.branchName ? (
            <button
              className={secondaryButton}
              disabled={refreshing || publish.isPending}
              type="button"
              onClick={() => void refreshRevision()}
            >
              {refreshing ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("projects.pr.updateRevision")}
            </button>
          ) : null}
          {mayChange && status === "draft" ? (
            <button
              className={secondaryButton}
              disabled={lifecycle.pending}
              type="button"
              onClick={() =>
                void lifecycle.change(pullRequest, "open", t("projects.pr.markedReady"))
              }
            >
              <Check className="h-4 w-4" />
              {t("projects.pr.markReady")}
            </button>
          ) : null}
          {mayChange && status === "open" ? (
            <button
              className={secondaryButton}
              disabled={lifecycle.pending}
              type="button"
              onClick={() =>
                void lifecycle.change(pullRequest, "draft", t("projects.pr.convertedDraft"))
              }
            >
              <GitPullRequestDraft className="h-4 w-4" />
              {t("projects.pr.convertDraft")}
            </button>
          ) : null}
          {mayChange && (status === "open" || status === "draft") ? (
            <button
              className={secondaryButton}
              disabled={lifecycle.pending}
              type="button"
              onClick={() => void lifecycle.change(pullRequest, "closed", t("projects.pr.closed"))}
            >
              <CircleSlash className="h-4 w-4" />
              {t("projects.pr.close")}
            </button>
          ) : null}
          {mayChange && status === "closed" ? (
            <button
              className={secondaryButton}
              disabled={lifecycle.pending}
              type="button"
              onClick={() => void lifecycle.change(pullRequest, "open", t("projects.pr.reopened"))}
            >
              <RotateCcw className="h-4 w-4" />
              {t("projects.pr.reopen")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
