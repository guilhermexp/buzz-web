import {
  BookMarked,
  CircleDot,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { Avatar } from "@/features/chat/ui/Avatar";
import type { Repo } from "@/features/repos/use-repos";
import { getLocale, t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Project } from "../../lib/nip34";
import type { Issue, PullRequest } from "../../lib/work-items";
import { ErrorNote, forgeErrorMessage } from "./forge-ui";
import { WorkItemList } from "./WorkItemList";

export type HomeTab = "overview" | "repositories" | "pull-requests" | "issues";
type SortOrder = "name" | "newest" | "oldest";

const HEATMAP_DAYS = 18 * 7;

function fallbackProfile(pubkey: string): UserProfile {
  return { pubkey, name: truncatePubkey(pubkey), about: "", picture: null, isAgent: false };
}

/** Daily activity over the last 18 weeks from real event timestamps. */
function contributionData(timestamps: readonly number[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - (HEATMAP_DAYS - 1));
  const counts = new Map<number, number>();
  for (const timestamp of timestamps) {
    const date = new Date(timestamp * 1_000);
    date.setHours(0, 0, 0, 0);
    const index = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
    if (index >= 0 && index < HEATMAP_DAYS) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const cells = Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: date.toISOString().slice(0, 10), count: counts.get(index) ?? 0 };
  });
  const monthLabels = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + Math.round((index * (HEATMAP_DAYS - 1)) / 4));
    return {
      date: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(date),
    };
  });
  return { cells, monthLabels };
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
}) {
  return (
    <div className="min-h-[112px] rounded-lg border bg-background/30 p-4">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span>{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-4 text-4xl font-semibold leading-none tabular-nums">{value ?? "–"}</div>
    </div>
  );
}

export function ForgeHome<R extends Repo>({
  tab,
  onTabChange,
  repos,
  projects,
  issues,
  pullRequests,
  loading,
  workItemsLoading,
  workItemsError,
  profiles,
  relayUrl,
  repoNameForAddress,
  onOpenProject,
  onOpenRepo,
  onOpenIssue,
  onOpenPullRequest,
}: {
  tab: HomeTab;
  onTabChange: (tab: HomeTab) => void;
  repos: readonly R[];
  projects: readonly Project[] | null;
  issues: readonly Issue[] | null;
  pullRequests: readonly PullRequest[] | null;
  loading: boolean;
  workItemsLoading: boolean;
  workItemsError: unknown;
  profiles: Readonly<Record<string, UserProfile>>;
  relayUrl: string;
  repoNameForAddress: (address: string | null) => string | null;
  onOpenProject: (project: Project) => void;
  onOpenRepo: (repo: R) => void;
  onOpenIssue: (issue: Issue) => void;
  onOpenPullRequest: (pullRequest: PullRequest) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("newest");
  const filteredRepos = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const filtered = repos.filter(
      (repo) =>
        !term ||
        repo.name.toLocaleLowerCase().includes(term) ||
        repo.description.toLocaleLowerCase().includes(term),
    );
    return [...filtered].sort((left, right) => {
      if (sort === "oldest") return left.createdAt - right.createdAt;
      if (sort === "name") return left.name.localeCompare(right.name);
      return right.createdAt - left.createdAt;
    });
  }, [repos, search, sort]);
  const people = useMemo(
    () => [...new Set(repos.flatMap((repo) => [repo.owner, ...repo.contributors]))],
    [repos],
  );
  const contribution = useMemo(
    () =>
      contributionData([
        ...repos.map((repo) => repo.createdAt),
        ...(issues ?? []).flatMap((issue) => [
          issue.createdAt,
          ...issue.comments.map((comment) => comment.createdAt),
        ]),
        ...(pullRequests ?? []).flatMap((pr) => [
          pr.createdAt,
          ...pr.comments.map((comment) => comment.createdAt),
        ]),
      ]),
    [repos, issues, pullRequests],
  );
  const openPullRequests = pullRequests?.filter(
    (pr) => pr.status === "open" || pr.status === "draft",
  ).length;
  const openIssues = issues?.filter(
    (issue) => issue.status === "open" || issue.status === "draft",
  ).length;
  const collections: { key: string; project: Project | null; repo: R | null }[] = projects
    ? projects.map((project) => ({ key: project.id, project, repo: null }))
    : repos.map((repo) => ({ key: `${repo.owner}:${repo.id}`, project: null, repo }));

  return (
    <>
      <div className="mt-7 flex items-end gap-4 border-b">
        <div className="flex min-w-0 flex-1 gap-6 overflow-x-auto" role="tablist">
          {(
            [
              ["overview", t("repos.overview")],
              ["repositories", t("repos.title")],
              ["pull-requests", t("repos.pullRequests")],
              ["issues", t("repos.issues")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-selected={tab === value}
              className={`h-11 shrink-0 border-b-2 px-0.5 text-sm font-medium ${
                tab === value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              role="tab"
              type="button"
              onClick={() => onTabChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" ? (
        <div className="mt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<GitBranch className="h-4 w-4" />}
              label={t("repos.title")}
              value={repos.length}
            />
            <StatCard
              icon={<GitPullRequest className="h-4 w-4" />}
              label={t("projects.stats.openPullRequests")}
              value={openPullRequests ?? null}
            />
            <StatCard
              icon={<FolderGit2 className="h-4 w-4" />}
              label={t("projects.stats.projects")}
              value={projects ? projects.filter((project) => !project.legacy).length : null}
            />
            <StatCard
              icon={<CircleDot className="h-4 w-4" />}
              label={t("projects.stats.openIssues")}
              value={openIssues ?? null}
            />
          </div>

          <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section>
              <h3 className="sr-only">{t("repos.recentActivity")}</h3>
              <div className="space-y-3">
                {collections.map(({ key, project, repo }) => {
                  const owner = project?.owner ?? repo?.owner ?? "";
                  const name = project?.name ?? repo?.name ?? "";
                  const description = project?.description ?? repo?.description ?? "";
                  const createdAt = project?.createdAt ?? repo?.createdAt ?? 0;
                  const profile = profiles[owner] ?? fallbackProfile(owner);
                  return (
                    <button
                      key={key}
                      className="flex min-h-[120px] w-full items-start gap-3 rounded-lg border bg-background/25 p-4 text-left hover:bg-foreground/[0.035]"
                      type="button"
                      onClick={() =>
                        project ? onOpenProject(project) : repo ? onOpenRepo(repo) : undefined
                      }
                    >
                      <Avatar profile={profile} relayUrl={relayUrl} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {project && !project.legacy
                            ? t("projects.createdProject", { actor: profile.name, project: name })
                            : t("repos.createdRepository", {
                                actor: profile.name,
                                repository: name,
                              })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {relativeTime(createdAt)}
                        </p>
                        <div className="mt-3 text-sm font-semibold">{name}</div>
                        {description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-foreground/85">
                            {description}
                          </p>
                        ) : null}
                        {project && !project.legacy ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t(
                              project.repositories.length === 1 ? "repos.countOne" : "repos.count",
                              {
                                count: project.repositories.length,
                              },
                            )}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
                {loading ? (
                  <div className="flex items-center justify-center px-4 py-14 text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    {t("repos.loading")}
                  </div>
                ) : null}
                {!loading && !collections.length ? (
                  <div className="rounded-lg border px-5 py-14 text-center">
                    <BookMarked className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-3 text-sm font-medium">{t("repos.empty")}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t("repos.emptyDescription")}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="space-y-8">
              <section>
                <h3 className="text-sm font-semibold">{t("repos.people")}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {people.slice(0, 12).map((pubkey) => (
                    <Avatar
                      key={pubkey}
                      profile={profiles[pubkey] ?? fallbackProfile(pubkey)}
                      relayUrl={relayUrl}
                      size={30}
                    />
                  ))}
                  {!people.length ? (
                    <span className="text-xs text-muted-foreground">{t("repos.noPeople")}</span>
                  ) : null}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-semibold">{t("repos.contributionActivity")}</h3>
                <div className="mt-3 flex justify-between text-[10px] text-muted-foreground">
                  {contribution.monthLabels.map((month) => (
                    <span key={month.date}>{month.label}</span>
                  ))}
                </div>
                <div
                  aria-label={t("repos.contributionActivity")}
                  className="mt-2 grid grid-flow-col grid-rows-7 gap-1"
                  role="img"
                >
                  {contribution.cells.map((cell) => (
                    <span
                      key={cell.date}
                      className={`aspect-square min-w-0 rounded-[3px] border border-foreground/[0.025] ${
                        cell.count > 1
                          ? "bg-emerald-500/55"
                          : cell.count === 1
                            ? "bg-emerald-500/30"
                            : "bg-foreground/[0.035]"
                      }`}
                      title={t("repos.contributionCount", { count: cell.count })}
                    />
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>
      ) : tab === "repositories" ? (
        <div className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background/30 px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                aria-label={t("repos.search")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder={t("repos.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              aria-label={t("repos.sort")}
              className="h-10 min-w-36 rounded-md border bg-background/30 px-3 text-xs"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortOrder)}
            >
              <option value="newest">{t("repos.sortNewest")}</option>
              <option value="oldest">{t("repos.sortOldest")}</option>
              <option value="name">{t("repos.sortName")}</option>
            </select>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {filteredRepos.map((repo) => (
              <button
                key={`${repo.owner}:${repo.id}`}
                className="flex min-h-[124px] w-full items-start gap-3 rounded-lg border bg-background/20 px-4 py-4 text-left hover:bg-foreground/[0.035]"
                type="button"
                onClick={() => onOpenRepo(repo)}
              >
                <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{repo.name}</div>
                  {repo.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {repo.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{truncatePubkey(repo.owner)}</span>
                    <span>·</span>
                    <span className="shrink-0">{relativeTime(repo.createdAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!loading && repos.length > 0 && !filteredRepos.length ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">
              {t("repos.noMatches")}
            </div>
          ) : null}
        </div>
      ) : issues === null || pullRequests === null ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-muted-foreground">
          {tab === "pull-requests" ? (
            <GitPullRequest className="h-9 w-9 opacity-45" />
          ) : (
            <CircleDot className="h-9 w-9 opacity-45" />
          )}
          <p className="mt-3 text-sm">
            {tab === "pull-requests" ? t("repos.noPullRequests") : t("repos.noIssues")}
          </p>
        </div>
      ) : tab === "pull-requests" ? (
        <WorkItemList
          error={workItemsError}
          items={pullRequests}
          kind="pr"
          loading={workItemsLoading}
          repoName={repoNameForAddress}
          onOpen={onOpenPullRequest}
        />
      ) : (
        <WorkItemList
          error={workItemsError}
          items={issues}
          kind="issue"
          loading={workItemsLoading}
          repoName={repoNameForAddress}
          onOpen={onOpenIssue}
        />
      )}
      {workItemsError && tab === "overview" ? (
        <div className="mt-4">
          <ErrorNote>{forgeErrorMessage(workItemsError)}</ErrorNote>
        </div>
      ) : null}
    </>
  );
}
