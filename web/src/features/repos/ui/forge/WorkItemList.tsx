import { CircleDot, GitPullRequest, MessageSquare, Plus } from "lucide-react";
import { useState } from "react";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";
import { type WorkItemStatus, workItemCounts } from "../../lib/work-items";
import {
  ErrorNote,
  forgeErrorMessage,
  LoadingRows,
  PersonChip,
  StatusBadge,
  secondaryButton,
} from "./forge-ui";

type ListItem = {
  id: string;
  title: string;
  author: string;
  createdAt: number;
  status: WorkItemStatus;
  repoAddress: string | null;
  comments: readonly unknown[];
};

type Filter = "open" | "closed";

/** Issues and pull requests: open / closed filters with real counts. */
export function WorkItemList<T extends ListItem>({
  kind,
  items,
  loading,
  error,
  repoName,
  onOpen,
  onCreate,
}: {
  kind: "issue" | "pr";
  items: readonly T[] | undefined;
  loading: boolean;
  error: unknown;
  repoName?: (address: string | null) => string | null;
  onOpen: (item: T) => void;
  onCreate?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const counts = workItemCounts(items ?? []);
  const openCount = counts.open + counts.draft;
  const closedCount = counts.closed + counts.merged;
  const visible = (items ?? []).filter((item) =>
    filter === "open"
      ? item.status === "open" || item.status === "draft"
      : item.status === "closed" || item.status === "merged",
  );
  const Icon = kind === "issue" ? CircleDot : GitPullRequest;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          aria-label={kind === "issue" ? t("repos.issues") : t("repos.pullRequests")}
          className="flex gap-1 rounded-md border p-0.5"
          role="tablist"
        >
          {(
            [
              ["open", t("projects.list.open", { count: openCount })],
              ["closed", t("projects.list.closed", { count: closedCount })],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-selected={filter === value}
              className={`h-8 rounded px-3 text-xs font-medium ${
                filter === value
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              role="tab"
              type="button"
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {onCreate ? (
          <button className={secondaryButton} type="button" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            {kind === "issue" ? t("projects.issue.new") : t("projects.pr.new")}
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {error ? <ErrorNote>{forgeErrorMessage(error)}</ErrorNote> : null}
        {loading ? <LoadingRows /> : null}
        {!loading && !error && !visible.length ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border px-5 text-center text-muted-foreground">
            <Icon aria-hidden="true" className="h-8 w-8 opacity-45" />
            <p className="mt-3 text-sm">
              {kind === "issue"
                ? filter === "open"
                  ? t("projects.issue.emptyOpen")
                  : t("projects.issue.emptyClosed")
                : filter === "open"
                  ? t("projects.pr.emptyOpen")
                  : t("projects.pr.emptyClosed")}
            </p>
          </div>
        ) : null}
        {visible.length ? (
          <ul className="overflow-hidden rounded-lg border">
            {visible.map((item) => {
              const repository = repoName?.(item.repoAddress) ?? null;
              return (
                <li key={item.id} className="border-b last:border-b-0">
                  <button
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-foreground/[0.035]"
                    type="button"
                    onClick={() => onOpen(item)}
                  >
                    <StatusBadge kind={kind} status={item.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">{item.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {repository ? <span className="font-mono">{repository}</span> : null}
                        <PersonChip pubkey={item.author} size={16} />
                        <span>{relativeTime(item.createdAt)}</span>
                      </span>
                    </span>
                    {item.comments.length ? (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                        title={t("projects.comments.count", { count: item.comments.length })}
                      >
                        <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                        {item.comments.length}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
