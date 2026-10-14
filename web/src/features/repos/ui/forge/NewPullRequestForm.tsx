import { GitPullRequest, LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import { buildPullRequestTemplate } from "../../lib/forge-events";
import { resolveBranchRevision } from "../../lib/git-forge";
import type { Repository } from "../../lib/nip34";
import { useForgePublish } from "../../use-forge";
import { openRepositoryStore, useRemoteBranches } from "../../use-forge-git";
import {
  ErrorNote,
  fieldClass,
  forgeErrorMessage,
  primaryButton,
  secondaryButton,
  textareaClass,
} from "./forge-ui";

/**
 * Open a pull request (kind 1618) from a branch already pushed to the
 * repository. The tip commit and merge base come from the live git refs, so
 * the event names the exact revision reviewers will see.
 */
export function NewPullRequestForm({
  repository,
  defaultBranch,
  breadcrumbs,
  onCreated,
  onCancel,
}: {
  repository: Repository;
  defaultBranch: string;
  breadcrumbs: ReactNode;
  onCreated: (pullRequestId: string) => void;
  onCancel: () => void;
}) {
  const { relayUrl, pubkey } = useWorkspace();
  const branches = useRemoteBranches(repository);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState(defaultBranch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const publish = useForgePublish();
  const names = (branches.data ?? []).map((branch) => branch.name);
  const sourceOptions = names.filter((name) => name !== target);
  const busy = preparing || publish.isPending;

  return (
    <div className="mt-8 max-w-3xl">
      {breadcrumbs}
      <h3 className="mt-5 text-xl font-semibold">{t("projects.pr.new")}</h3>
      {branches.error ? (
        <div className="mt-4">
          <ErrorNote>{forgeErrorMessage(branches.error)}</ErrorNote>
        </div>
      ) : null}
      {branches.isSuccess && sourceOptions.length === 0 ? (
        <p className="mt-4 rounded-md border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          {t("projects.pr.noBranches")}
        </p>
      ) : null}
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void (async () => {
            setPreparing(true);
            try {
              const url = repository.cloneUrls[0] as string;
              const handle = await openRepositoryStore(relayUrl, pubkey, repository);
              const revision = await resolveBranchRevision({
                handle,
                sourceUrl: url,
                sourceBranch: source,
                targetUrl: url,
                targetBranch: target,
              });
              setPreparing(false);
              const [pullRequest] = await publish.mutateAsync([
                buildPullRequestTemplate({
                  repository,
                  title,
                  body,
                  branch: source,
                  targetBranch: target,
                  commit: revision.commit,
                  mergeBase: revision.mergeBase,
                  reviewers: [],
                }),
              ]);
              toast.success(t("projects.pr.created"));
              if (pullRequest) onCreated(pullRequest.id);
            } catch (failure) {
              setError(forgeErrorMessage(failure));
            } finally {
              setPreparing(false);
            }
          })();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">{t("projects.pr.targetBranch")}</span>
            <select
              className={fieldClass}
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {(names.includes(target) ? names : [target, ...names]).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">{t("projects.pr.sourceBranch")}</span>
            <select
              className={fieldClass}
              disabled={!sourceOptions.length}
              required
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">{t("projects.pr.chooseBranch")}</option>
              {sourceOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">{t("projects.field.title")}</span>
          <input
            className={fieldClass}
            maxLength={256}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">{t("projects.field.description")}</span>
          <textarea
            className={textareaClass}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end gap-2">
          <button className={secondaryButton} type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className={primaryButton}
            disabled={!title.trim() || !source || busy}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <GitPullRequest className="h-4 w-4" />
            )}
            {t("projects.pr.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
