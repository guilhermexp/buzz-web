import { CircleDot, CircleSlash, LoaderCircle, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";
import {
  buildIssueTemplate,
  buildStatusTemplate,
  type LifecycleStatus,
} from "../../lib/forge-events";
import type { Repository } from "../../lib/nip34";
import { canChangeStatus } from "../../lib/permissions";
import { type Issue, nextStatusCreatedAt } from "../../lib/work-items";
import { useForgePublish } from "../../use-forge";
import { CommentCard, CommentComposer } from "./Conversation";
import {
  fieldClass,
  forgeErrorMessage,
  PersonChip,
  primaryButton,
  StatusBadge,
  secondaryButton,
  textareaClass,
} from "./forge-ui";

export function NewIssueForm({
  repository,
  breadcrumbs,
  onCreated,
  onCancel,
}: {
  repository: Repository;
  breadcrumbs: ReactNode;
  onCreated: (issueId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [error, setError] = useState<string | null>(null);
  const publish = useForgePublish();
  return (
    <div className="mt-8 max-w-3xl">
      {breadcrumbs}
      <h3 className="mt-5 text-xl font-semibold">{t("projects.issue.new")}</h3>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void (async () => {
            try {
              const [issue] = await publish.mutateAsync([
                buildIssueTemplate({
                  repository,
                  title,
                  body,
                  labels: labels.split(",").map((label) => label.trim()),
                }),
              ]);
              toast.success(t("projects.issue.created"));
              if (issue) onCreated(issue.id);
            } catch (failure) {
              setError(forgeErrorMessage(failure));
            }
          })();
        }}
      >
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
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">{t("projects.field.labels")}</span>
          <input
            className={fieldClass}
            placeholder={t("projects.field.labelsHint")}
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
        </label>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button className={secondaryButton} type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className={primaryButton}
            disabled={!title.trim() || publish.isPending}
            type="submit"
          >
            {publish.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <CircleDot className="h-4 w-4" />
            )}
            {t("projects.issue.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Publish a lifecycle status for an issue or PR root (author / owner only). */
export function useLifecycle(repository: Repository) {
  const publish = useForgePublish();
  const change = async (
    item: { id: string; author: string; statusCreatedAt: number | null },
    status: LifecycleStatus,
    successMessage: string,
  ) => {
    try {
      await publish.mutateAsync([
        buildStatusTemplate({
          rootId: item.id,
          rootAuthor: item.author,
          repository,
          status,
          createdAt: nextStatusCreatedAt(item, Math.floor(Date.now() / 1_000)),
        }),
      ]);
      toast.success(successMessage);
    } catch (error) {
      toast.error(forgeErrorMessage(error));
    }
  };
  return { change, pending: publish.isPending };
}

export function IssueView({
  repository,
  issue,
  breadcrumbs,
}: {
  repository: Repository;
  issue: Issue;
  breadcrumbs: ReactNode;
}) {
  const { pubkey } = useWorkspace();
  const lifecycle = useLifecycle(repository);
  const mayChange = canChangeStatus(pubkey, repository, issue);
  return (
    <div className="mt-8 max-w-4xl">
      {breadcrumbs}
      <header className="mt-5 border-b pb-5">
        <h3 className="break-words text-xl font-semibold">{issue.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge kind="issue" status={issue.status} />
          <PersonChip pubkey={issue.author} />
          <span>{t("projects.openedAt", { time: relativeTime(issue.createdAt) })}</span>
          {issue.labels.map((label) => (
            <span key={label} className="rounded-full border px-2 py-0.5 text-[11px]">
              {label}
            </span>
          ))}
        </div>
        {mayChange ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {issue.status === "closed" || issue.status === "merged" ? (
              <button
                className={secondaryButton}
                disabled={lifecycle.pending}
                type="button"
                onClick={() => void lifecycle.change(issue, "open", t("projects.issue.reopened"))}
              >
                <RotateCcw className="h-4 w-4" />
                {t("projects.issue.reopen")}
              </button>
            ) : (
              <button
                className={secondaryButton}
                disabled={lifecycle.pending}
                type="button"
                onClick={() => void lifecycle.change(issue, "closed", t("projects.issue.closed"))}
              >
                <CircleSlash className="h-4 w-4" />
                {t("projects.issue.close")}
              </button>
            )}
          </div>
        ) : null}
      </header>
      <div className="mt-5 space-y-3">
        <CommentCard author={issue.author} content={issue.content} createdAt={issue.createdAt} />
        {issue.comments.map((comment) => (
          <CommentCard
            key={comment.id}
            author={comment.author}
            content={comment.content}
            createdAt={comment.createdAt}
          />
        ))}
        <CommentComposer
          label={t("projects.comments.placeholder")}
          repository={repository}
          rootAuthor={issue.author}
          rootId={issue.id}
        />
      </div>
    </div>
  );
}
