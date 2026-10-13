import { AlertTriangle, CheckCircle2, GitMerge, LoaderCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import { buildMergedStatusTemplate } from "../../lib/forge-events";
import { ForgeGitError, type MergeOutcome, mergeAndPush } from "../../lib/git-forge";
import type { Repository } from "../../lib/nip34";
import { mergeBlocker } from "../../lib/permissions";
import { nextStatusCreatedAt, type PullRequest } from "../../lib/work-items";
import { useForgePublish } from "../../use-forge";
import { openRepositoryStore } from "../../use-forge-git";
import { ErrorNote, forgeErrorMessage, primaryButton, secondaryButton, shortOid } from "./forge-ui";

type MergeState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "running" }
  | { phase: "rejected"; error: ForgeGitError }
  | { phase: "failed"; message: string; paths: string[] }
  /** Git ref updated, but the 1631 status could not be published yet. */
  | { phase: "pushed"; outcome: MergeOutcome; message: string };

/**
 * Browser merge for the repository owner: merge (or fast-forward) the PR's
 * exact revision into the target branch with isomorphic-git, push it through
 * git-receive-pack with NIP-98, confirm the advertised ref, and only then
 * publish the kind 1631 merged status naming the merge commit.
 */
export function MergePanel({
  repository,
  pullRequest,
  targetBranch,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  targetBranch: string;
}) {
  const { relayUrl, pubkey } = useWorkspace();
  const publish = useForgePublish();
  const [state, setState] = useState<MergeState>({ phase: "idle" });
  const blocker = mergeBlocker(pubkey, repository, pullRequest);
  if (blocker === "not-owner" || blocker === "not-open") return null;

  const publishMerged = async (outcome: MergeOutcome) => {
    try {
      await publish.mutateAsync([
        buildMergedStatusTemplate({
          pullRequest,
          repository,
          mergeCommit: outcome.mergeCommit,
          createdAt: nextStatusCreatedAt(pullRequest, Math.floor(Date.now() / 1_000)),
        }),
      ]);
      setState({ phase: "idle" });
      toast.success(t("projects.merge.done", { commit: shortOid(outcome.mergeCommit) }));
    } catch (error) {
      setState({ phase: "pushed", outcome, message: forgeErrorMessage(error) });
    }
  };

  const runMerge = async () => {
    setState({ phase: "running" });
    let outcome: MergeOutcome;
    try {
      const handle = await openRepositoryStore(relayUrl, pubkey, repository);
      const targetUrl = repository.cloneUrls[0] ?? (pullRequest.cloneUrls[0] as string);
      outcome = await mergeAndPush({
        handle,
        targetUrl,
        targetBranch,
        sourceUrl: pullRequest.cloneUrls[0] ?? targetUrl,
        sourceBranch: pullRequest.branchName as string,
        expectedCommit: pullRequest.commit as string,
        viewerPubkey: pubkey,
        message: `Merge pull request: ${pullRequest.title}\n\nBuzz-Pull-Request: ${pullRequest.id}\nRevision: ${pullRequest.commit}`,
      });
    } catch (error) {
      if (error instanceof ForgeGitError && error.code === "push_rejected") {
        setState({ phase: "rejected", error });
      } else {
        setState({
          phase: "failed",
          message: forgeErrorMessage(error),
          paths: error instanceof ForgeGitError ? error.paths : [],
        });
      }
      return;
    }
    await publishMerged(outcome);
  };

  return (
    <section aria-label={t("projects.merge.title")} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <GitMerge
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">{t("projects.merge.title")}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("projects.merge.description", {
              commit: shortOid(pullRequest.commit),
              target: targetBranch,
            })}
          </p>
        </div>
        {state.phase === "confirm" ? (
          <div className="flex gap-2">
            <button
              className={secondaryButton}
              type="button"
              onClick={() => setState({ phase: "idle" })}
            >
              {t("common.cancel")}
            </button>
            <button className={primaryButton} type="button" onClick={() => void runMerge()}>
              <GitMerge className="h-4 w-4" />
              {t("projects.merge.confirm", { target: targetBranch })}
            </button>
          </div>
        ) : state.phase === "pushed" ? (
          <button
            className={primaryButton}
            disabled={publish.isPending}
            type="button"
            onClick={() => void publishMerged(state.outcome)}
          >
            {publish.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {t("projects.merge.publishStatus")}
          </button>
        ) : (
          <button
            className={primaryButton}
            disabled={state.phase === "running" || blocker !== null}
            type="button"
            onClick={() => setState({ phase: "confirm" })}
          >
            {state.phase === "running" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="h-4 w-4" />
            )}
            {state.phase === "running" ? t("projects.merge.running") : t("projects.merge.action")}
          </button>
        )}
      </div>

      {blocker ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("projects.merge.incomplete")}</p>
      ) : null}

      {state.phase === "rejected" ? (
        <div
          className="mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs leading-5 text-destructive"
          role="alert"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert aria-hidden="true" className="h-4 w-4" />
            {t("projects.merge.rejected", { target: targetBranch })}
          </p>
          {state.error.rejection?.denials.length ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {state.error.rejection.denials.map((denial) => (
                <li key={`${denial.refName}:${denial.reason}`}>
                  <span className="font-mono">{denial.refName}</span>: {denial.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {state.error.rejection?.detail ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/80">
              {state.error.rejection.detail}
            </pre>
          ) : null}
          <p>{t("projects.merge.notMerged")}</p>
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <div className="mt-3 space-y-2">
          <ErrorNote>
            {state.message}
            {state.paths.length ? (
              <span className="mt-1 block font-mono">{state.paths.join(", ")}</span>
            ) : null}
          </ErrorNote>
          <p className="text-xs text-muted-foreground">{t("projects.merge.notMerged")}</p>
        </div>
      ) : null}

      {state.phase === "pushed" ? (
        <div className="mt-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-5">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {t("projects.merge.statusPending", {
              commit: shortOid(state.outcome.mergeCommit),
              target: targetBranch,
            })}{" "}
            {state.message}
          </span>
        </div>
      ) : null}
    </section>
  );
}
