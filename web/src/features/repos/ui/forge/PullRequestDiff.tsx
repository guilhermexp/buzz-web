import { ChevronDown, ChevronRight, FileDiff, LoaderCircle, MessageSquarePlus } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { t } from "@/shared/i18n";
import { buildCommentTemplate } from "../../lib/forge-events";
import type { FileChange } from "../../lib/git-forge";
import { type DiffLine, diffLineKey, toSplitRows } from "../../lib/line-diff";
import type { Repository } from "../../lib/nip34";
import type {
  CommentAnchor,
  PullRequest,
  PullRequestComment,
  PullRequestRevision,
} from "../../lib/work-items";
import { useForgePublish } from "../../use-forge";
import { useFileDiff, usePullRequestDiff } from "../../use-forge-git";
import { CommentCard } from "./Conversation";
import {
  ErrorNote,
  forgeErrorMessage,
  LoadingRows,
  primaryButton,
  secondaryButton,
  shortOid,
  textareaClass,
} from "./forge-ui";

type Layout = "unified" | "split";

const LINE_TONE: Record<DiffLine["type"], string> = {
  add: "bg-emerald-500/10",
  del: "bg-red-500/10",
  context: "",
};

function anchorOf(path: string, line: DiffLine): CommentAnchor {
  return line.type === "del"
    ? { path, side: "old", line: line.oldLine }
    : { path, side: "new", line: line.newLine };
}

function sameAnchor(left: CommentAnchor | null, right: CommentAnchor): boolean {
  return Boolean(
    left && left.path === right.path && left.side === right.side && left.line === right.line,
  );
}

function InlineComposer({
  repository,
  pullRequest,
  revision,
  anchor,
  onDone,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  revision: PullRequestRevision;
  anchor: CommentAnchor;
  onDone: () => void;
}) {
  const [content, setContent] = useState("");
  const publish = useForgePublish();
  return (
    <form
      className="space-y-2 border-y bg-background p-3 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          try {
            await publish.mutateAsync([
              buildCommentTemplate({
                rootId: pullRequest.id,
                rootAuthor: pullRequest.author,
                repository,
                content,
                anchor: { ...anchor, commit: revision.commit },
              }),
            ]);
            toast.success(t("projects.comments.posted"));
            onDone();
          } catch (error) {
            toast.error(forgeErrorMessage(error));
          }
        })();
      }}
    >
      <p className="text-[11px] text-muted-foreground">
        {t("projects.review.inlineTarget", {
          path: anchor.path,
          line: anchor.line,
          commit: shortOid(revision.commit),
        })}
      </p>
      <textarea
        aria-label={t("projects.review.inlinePlaceholder")}
        className={textareaClass}
        placeholder={t("projects.review.inlinePlaceholder")}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button className={secondaryButton} type="button" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button
          className={primaryButton}
          disabled={!content.trim() || publish.isPending}
          type="submit"
        >
          {publish.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {t("projects.review.addComment")}
        </button>
      </div>
    </form>
  );
}

function LineCell({
  line,
  side,
  onComment,
}: {
  line: DiffLine | null;
  side: "old" | "new";
  onComment: ((line: DiffLine) => void) | null;
}) {
  if (!line) return <td className="bg-foreground/[0.03]" colSpan={2} />;
  const number =
    side === "old"
      ? line.type === "add"
        ? ""
        : line.oldLine
      : line.type === "del"
        ? ""
        : line.newLine;
  const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return (
    <>
      <td
        className={`w-12 select-none px-2 text-right align-top text-muted-foreground ${LINE_TONE[line.type]}`}
      >
        <span className="inline-flex items-center gap-1">
          {onComment ? (
            <button
              aria-label={t("projects.review.commentOnLine")}
              className="opacity-40 hover:opacity-100 focus-visible:opacity-100"
              type="button"
              onClick={() => onComment(line)}
            >
              <MessageSquarePlus className="h-3 w-3" />
            </button>
          ) : null}
          {number}
        </span>
      </td>
      <td className={`whitespace-pre-wrap break-all px-2 align-top ${LINE_TONE[line.type]}`}>
        <span aria-hidden="true" className="select-none text-muted-foreground">
          {marker}
        </span>
        {line.text}
      </td>
    </>
  );
}

function FileDiffBody({
  repository,
  pullRequest,
  revision,
  change,
  layout,
  comments,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  revision: PullRequestRevision;
  change: FileChange;
  layout: Layout;
  comments: PullRequestComment[];
}) {
  const diff = useFileDiff(repository, change);
  const [composer, setComposer] = useState<CommentAnchor | null>(null);
  if (diff.isLoading) return <LoadingRows rows={2} />;
  if (diff.error) return <ErrorNote>{forgeErrorMessage(diff.error)}</ErrorNote>;
  const data = diff.data;
  if (!data) return null;
  if (data.kind !== "text") {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        {data.kind === "binary" ? t("projects.diff.binary") : t("projects.diff.tooLarge")}
      </p>
    );
  }
  const commentsAt = (anchor: CommentAnchor) =>
    comments.filter((comment) => sameAnchor(comment.anchor, anchor));
  const extras = (line: DiffLine): ReactNode => {
    const anchor = anchorOf(change.path, line);
    const thread = commentsAt(anchor);
    if (!thread.length && !sameAnchor(composer, anchor)) return null;
    return (
      <tr>
        <td colSpan={layout === "split" ? 4 : 3} className="p-0">
          <div className="space-y-2 bg-foreground/[0.02] px-3 py-2 font-sans">
            {thread.map((comment) => (
              <CommentCard
                key={comment.id}
                author={comment.author}
                content={comment.content}
                createdAt={comment.createdAt}
              />
            ))}
          </div>
          {sameAnchor(composer, anchor) ? (
            <InlineComposer
              anchor={anchor}
              pullRequest={pullRequest}
              repository={repository}
              revision={revision}
              onDone={() => setComposer(null)}
            />
          ) : null}
        </td>
      </tr>
    );
  };
  const onComment = (line: DiffLine) => setComposer(anchorOf(change.path, line));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-5">
        {data.hunks.map((hunk) => (
          <tbody key={`${hunk.oldStart}-${hunk.newStart}`}>
            <tr>
              <td
                className="bg-sky-500/10 px-3 py-1 text-[11px] text-muted-foreground"
                colSpan={layout === "split" ? 4 : 3}
              >
                {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
              </td>
            </tr>
            {layout === "unified"
              ? hunk.lines.map((line) => (
                  <Fragment key={diffLineKey(line)}>
                    <tr>
                      <td
                        className={`w-12 select-none px-2 text-right align-top text-muted-foreground ${LINE_TONE[line.type]}`}
                      >
                        {line.type === "add" ? "" : line.oldLine}
                      </td>
                      <LineCell line={line} side="new" onComment={onComment} />
                    </tr>
                    {extras(line)}
                  </Fragment>
                ))
              : toSplitRows(hunk.lines).map((row) => (
                  <Fragment
                    key={`${row.left ? diffLineKey(row.left) : ""}|${row.right ? diffLineKey(row.right) : ""}`}
                  >
                    <tr>
                      <LineCell line={row.left} side="old" onComment={onComment} />
                      <LineCell line={row.right} side="new" onComment={onComment} />
                    </tr>
                    {row.left ? extras(row.left) : null}
                    {row.right && row.right !== row.left ? extras(row.right) : null}
                  </Fragment>
                ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const CHANGE_LABEL: Record<
  FileChange["status"],
  | "projects.diff.added"
  | "projects.diff.deleted"
  | "projects.diff.modified"
  | "projects.diff.renamed"
> = {
  added: "projects.diff.added",
  deleted: "projects.diff.deleted",
  modified: "projects.diff.modified",
  renamed: "projects.diff.renamed",
};

export function PullRequestDiff({
  repository,
  pullRequest,
  revision,
  targetBranch,
}: {
  repository: Repository;
  pullRequest: PullRequest;
  revision: PullRequestRevision | null;
  targetBranch: string;
}) {
  const diff = usePullRequestDiff(repository, pullRequest, revision, targetBranch);
  const [layout, setLayout] = useState<Layout>("unified");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const revisionComments = pullRequest.comments.filter(
    (comment) =>
      comment.anchor && (comment.commit ?? pullRequest.initialCommit) === revision?.commit,
  );
  return (
    <section aria-label={t("projects.diff.title")} className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {diff.data
            ? t("projects.diff.summary", {
                count: diff.data.files.length,
                base: shortOid(diff.data.mergeBase),
                head: shortOid(diff.data.headOid),
              })
            : null}
        </p>
        <fieldset className="flex gap-1 rounded-md border p-0.5">
          <legend className="sr-only">{t("projects.diff.layout")}</legend>
          {(["unified", "split"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={layout === value}
              className={`h-7 rounded px-2.5 text-xs font-medium ${
                layout === value
                  ? "bg-foreground/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              type="button"
              onClick={() => setLayout(value)}
            >
              {value === "unified" ? t("projects.diff.unified") : t("projects.diff.split")}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="mt-3 space-y-3">
        {diff.isLoading ? <LoadingRows /> : null}
        {diff.error ? <ErrorNote>{forgeErrorMessage(diff.error)}</ErrorNote> : null}
        {diff.data && !diff.data.files.length ? (
          <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            {t("projects.diff.empty")}
          </p>
        ) : null}
        {revision &&
          diff.data?.files.map((change) => {
            const open = !collapsed[change.path];
            return (
              <div key={change.path} className="overflow-hidden rounded-lg border">
                <button
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 border-b bg-foreground/[0.03] px-3 py-2 text-left"
                  type="button"
                  onClick={() => setCollapsed((current) => ({ ...current, [change.path]: open }))}
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <FileDiff aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
                    {change.oldPath && change.oldPath !== change.path ? `${change.oldPath} → ` : ""}
                    {change.path}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t(CHANGE_LABEL[change.status])}
                  </span>
                </button>
                {open ? (
                  <FileDiffBody
                    change={change}
                    comments={revisionComments.filter(
                      (comment) => comment.anchor?.path === change.path,
                    )}
                    layout={layout}
                    pullRequest={pullRequest}
                    repository={repository}
                    revision={revision}
                  />
                ) : null}
              </div>
            );
          })}
      </div>
    </section>
  );
}
