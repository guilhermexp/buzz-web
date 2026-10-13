import { FolderPlus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import type { UserProfile } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { mockRepos } from "@/features/repos/mock-repos";
import { useRepoRefs } from "@/features/repos/use-repo-refs";
import type { Repo } from "@/features/repos/use-repos";
import { t } from "@/shared/i18n";
import type { Project, Repository } from "../lib/nip34";
import { useForgeCollections, useForgeInvalidate, useRepoState, useWorkItems } from "../use-forge";
import { ForgeHome, type HomeTab } from "./forge/ForgeHome";
import {
  Breadcrumbs,
  ErrorNote,
  forgeErrorMessage,
  LoadingRows,
  secondaryButton,
} from "./forge/forge-ui";
import { IssueView, NewIssueForm } from "./forge/IssueViews";
import { NewPullRequestForm } from "./forge/NewPullRequestForm";
import { AddRepositoryForm, CreateProjectForm } from "./forge/ProjectForms";
import { ProjectView } from "./forge/ProjectView";
import { PullRequestView } from "./forge/PullRequestView";
import { WorkItemList } from "./forge/WorkItemList";
import { RepoDetail } from "./RepoDetail";

type View =
  | { name: "home" }
  | { name: "create-project" }
  | { name: "project"; projectId: string }
  | { name: "add-repo"; projectId: string }
  | { name: "repo"; address: string; projectId: string | null; tab?: string }
  | { name: "issue" | "pull"; address: string; id: string; projectId: string | null }
  | { name: "new-issue" | "new-pull"; address: string; projectId: string | null };

type Crumb = { label: string; onClick?: () => void };

/** Demo preview: local sample repositories only, no relay writes. */
function DemoRepoDetail({
  repo,
  onBack,
  onOpenChannel,
}: {
  repo: Repo;
  onBack: () => void;
  onOpenChannel: (id: string) => void;
}) {
  const { relayUrl } = useWorkspace();
  const refs = useRepoRefs(repo.id, { relayUrl, preview: true });
  return (
    <RepoDetail
      breadcrumbs={
        <Breadcrumbs items={[{ label: t("repos.title"), onClick: onBack }, { label: repo.name }]} />
      }
      demo
      refs={refs.data}
      refsLoading={false}
      relayUrl={relayUrl}
      repo={repo}
      onOpenChannel={onOpenChannel}
    />
  );
}

function RepositoryWorkspace({
  repository,
  crumbs,
  initialTab,
  onOpenIssue,
  onOpenPull,
  onNewIssue,
  onNewPull,
  onOpenChannel,
}: {
  repository: Repository;
  crumbs: Crumb[];
  initialTab?: string;
  onOpenIssue: (id: string) => void;
  onOpenPull: (id: string) => void;
  onNewIssue: () => void;
  onNewPull: () => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const { relayUrl } = useWorkspace();
  const state = useRepoState(repository);
  const workItems = useWorkItems([repository]);
  const refs = state.data
    ? {
        branches: state.data.branches.map((branch) => branch.name),
        tags: state.data.tags.map((tag) => tag.name),
        head: state.data.head
          ? {
              ref: state.data.head,
              sha:
                state.data.branches.find((branch) => branch.name === state.data?.head)?.oid ?? "",
            }
          : null,
      }
    : undefined;
  const hasBranches = Boolean(state.data?.branches.length);
  return (
    <RepoDetail
      breadcrumbs={<Breadcrumbs items={[...crumbs, { label: repository.name }]} />}
      demo={false}
      extraTabs={[
        {
          id: "pulls",
          label: t("repos.pullRequests"),
          content: (
            <WorkItemList
              error={workItems.error}
              items={workItems.data?.pullRequests}
              kind="pr"
              loading={workItems.isLoading}
              onCreate={hasBranches ? onNewPull : undefined}
              onOpen={(pr) => onOpenPull(pr.id)}
            />
          ),
        },
        {
          id: "issues",
          label: t("repos.issues"),
          content: (
            <WorkItemList
              error={workItems.error}
              items={workItems.data?.issues}
              kind="issue"
              loading={workItems.isLoading}
              onCreate={onNewIssue}
              onOpen={(issue) => onOpenIssue(issue.id)}
            />
          ),
        },
      ]}
      initialTab={initialTab}
      protections={repository.protections}
      refs={refs}
      refsLoading={state.isLoading}
      relayUrl={relayUrl}
      repo={repository}
      onOpenChannel={onOpenChannel}
    />
  );
}

function WorkItemRoute({
  view,
  repository,
  crumbs,
  onBackToList,
  onOpen,
}: {
  view: Extract<View, { name: "issue" | "pull" | "new-issue" | "new-pull" }>;
  repository: Repository;
  crumbs: Crumb[];
  onBackToList: () => void;
  onOpen: (name: "issue" | "pull", id: string) => void;
}) {
  const state = useRepoState(repository);
  const workItems = useWorkItems([repository]);
  const defaultBranch = state.data?.head ?? state.data?.branches[0]?.name ?? "main";
  const isPull = view.name === "pull" || view.name === "new-pull";
  const listCrumb: Crumb = {
    label: isPull ? t("repos.pullRequests") : t("repos.issues"),
    onClick: onBackToList,
  };
  if (view.name === "new-issue") {
    return (
      <NewIssueForm
        breadcrumbs={
          <Breadcrumbs items={[...crumbs, listCrumb, { label: t("projects.issue.new") }]} />
        }
        repository={repository}
        onCancel={onBackToList}
        onCreated={(id) => onOpen("issue", id)}
      />
    );
  }
  if (view.name === "new-pull") {
    return (
      <NewPullRequestForm
        breadcrumbs={
          <Breadcrumbs items={[...crumbs, listCrumb, { label: t("projects.pr.new") }]} />
        }
        defaultBranch={defaultBranch}
        repository={repository}
        onCancel={onBackToList}
        onCreated={(id) => onOpen("pull", id)}
      />
    );
  }
  if (workItems.isLoading)
    return (
      <div className="mt-8">
        <LoadingRows />
      </div>
    );
  if (workItems.error)
    return (
      <div className="mt-8">
        <ErrorNote>{forgeErrorMessage(workItems.error)}</ErrorNote>
      </div>
    );
  const pullRequest =
    view.name === "pull"
      ? workItems.data?.pullRequests.find((candidate) => candidate.id === view.id)
      : undefined;
  const issue =
    view.name === "issue"
      ? workItems.data?.issues.find((candidate) => candidate.id === view.id)
      : undefined;
  const title = pullRequest?.title ?? issue?.title;
  if (title === undefined) {
    return (
      <div className="mt-8">
        <ErrorNote>{t("projects.workItem.notFound")}</ErrorNote>
      </div>
    );
  }
  const breadcrumbs = <Breadcrumbs items={[...crumbs, listCrumb, { label: title }]} />;
  return pullRequest ? (
    <PullRequestView
      breadcrumbs={breadcrumbs}
      defaultBranch={defaultBranch}
      pullRequest={pullRequest}
      repository={repository}
    />
  ) : issue ? (
    <IssueView breadcrumbs={breadcrumbs} issue={issue} repository={repository} />
  ) : null;
}

export function ReposPanel({
  demo,
  profiles,
  relayUrl,
  onClose,
  onOpenChannel,
}: {
  demo: boolean;
  profiles: Readonly<Record<string, UserProfile>>;
  relayUrl: string;
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const collections = useForgeCollections();
  const refreshForge = useForgeInvalidate();
  const [view, setView] = useState<View>({ name: "home" });
  const [homeTab, setHomeTab] = useState<HomeTab>("overview");
  const projects = collections.data?.projects ?? [];
  const repositories = collections.data?.repositories ?? [];
  const homeWorkItems = useWorkItems(demo ? [] : repositories);
  const [demoRepo, setDemoRepo] = useState<Repo | null>(null);

  const projectById = (id: string | null) => projects.find((project) => project.id === id) ?? null;
  const repositoryByAddress = (address: string) =>
    repositories.find((repository) => repository.address === address) ?? null;
  const home: Crumb = { label: t("repos.title"), onClick: () => setView({ name: "home" }) };
  const crumbsFor = (projectId: string | null): Crumb[] => {
    const project = projectById(projectId);
    return project && !project.legacy
      ? [
          home,
          {
            label: project.name,
            onClick: () => setView({ name: "project", projectId: project.id }),
          },
        ]
      : [home];
  };
  const openRepository = (repository: Repository, projectId: string | null, tab?: string) =>
    setView({ name: "repo", address: repository.address, projectId, tab });

  let body: React.ReactNode;
  if (demo) {
    body = demoRepo ? (
      <DemoRepoDetail
        repo={demoRepo}
        onBack={() => setDemoRepo(null)}
        onOpenChannel={onOpenChannel}
      />
    ) : (
      <ForgeHome
        issues={null}
        loading={false}
        profiles={profiles}
        projects={null}
        pullRequests={null}
        relayUrl={relayUrl}
        repoNameForAddress={() => null}
        repos={mockRepos}
        tab={homeTab}
        workItemsError={null}
        workItemsLoading={false}
        onOpenIssue={() => undefined}
        onOpenProject={() => undefined}
        onOpenPullRequest={() => undefined}
        onOpenRepo={(repo) => {
          setHomeTab("repositories");
          setDemoRepo(repo);
        }}
        onTabChange={setHomeTab}
      />
    );
  } else if (view.name === "home") {
    body = (
      <ForgeHome
        issues={homeWorkItems.data?.issues ?? (repositories.length ? null : [])}
        loading={collections.isLoading}
        profiles={profiles}
        projects={projects}
        pullRequests={homeWorkItems.data?.pullRequests ?? (repositories.length ? null : [])}
        relayUrl={relayUrl}
        repoNameForAddress={(address) =>
          address ? (repositoryByAddress(address)?.name ?? null) : null
        }
        repos={repositories}
        tab={homeTab}
        workItemsError={homeWorkItems.error}
        workItemsLoading={homeWorkItems.isLoading}
        onOpenIssue={(issue) =>
          issue.repoAddress &&
          setView({ name: "issue", address: issue.repoAddress, id: issue.id, projectId: null })
        }
        onOpenProject={(project: Project) =>
          project.legacy && project.repositories[0]
            ? openRepository(project.repositories[0], null)
            : setView({ name: "project", projectId: project.id })
        }
        onOpenPullRequest={(pr) =>
          pr.repoAddress &&
          setView({ name: "pull", address: pr.repoAddress, id: pr.id, projectId: null })
        }
        onOpenRepo={(repository) => openRepository(repository, null)}
        onTabChange={setHomeTab}
      />
    );
  } else if (view.name === "create-project") {
    body = (
      <CreateProjectForm
        breadcrumbs={<Breadcrumbs items={[home, { label: t("projects.create.title") }]} />}
        onCancel={() => setView({ name: "home" })}
        onCreated={(projectId) => setView({ name: "project", projectId })}
      />
    );
  } else if (view.name === "project" || view.name === "add-repo") {
    const project = projectById(view.projectId);
    body = !project ? (
      collections.isLoading ? (
        <div className="mt-8">
          <LoadingRows />
        </div>
      ) : (
        <div className="mt-8">
          <ErrorNote>{t("projects.notFound")}</ErrorNote>
        </div>
      )
    ) : view.name === "project" ? (
      <ProjectView
        breadcrumbs={<Breadcrumbs items={[home, { label: project.name }]} />}
        project={project}
        onAddRepository={() => setView({ name: "add-repo", projectId: project.id })}
        onOpenChannel={onOpenChannel}
        onOpenRepository={(repository) => openRepository(repository, project.id)}
      />
    ) : (
      <AddRepositoryForm
        breadcrumbs={
          <Breadcrumbs items={[...crumbsFor(project.id), { label: t("projects.repo.add") }]} />
        }
        project={project}
        repositories={repositories}
        onCancel={() => setView({ name: "project", projectId: project.id })}
        onDone={() => setView({ name: "project", projectId: project.id })}
      />
    );
  } else {
    const repository = repositoryByAddress(view.address);
    if (!repository) {
      body = collections.isLoading ? (
        <div className="mt-8">
          <LoadingRows />
        </div>
      ) : (
        <div className="mt-8">
          <ErrorNote>{t("repos.notFound")}</ErrorNote>
        </div>
      );
    } else {
      const crumbs = crumbsFor(view.projectId);
      const repoCrumbs: Crumb[] = [
        ...crumbs,
        { label: repository.name, onClick: () => openRepository(repository, view.projectId) },
      ];
      body =
        view.name === "repo" ? (
          <RepositoryWorkspace
            key={`${repository.address}:${view.tab ?? "code"}`}
            crumbs={crumbs}
            initialTab={view.tab}
            repository={repository}
            onNewIssue={() =>
              setView({ name: "new-issue", address: repository.address, projectId: view.projectId })
            }
            onNewPull={() =>
              setView({ name: "new-pull", address: repository.address, projectId: view.projectId })
            }
            onOpenChannel={onOpenChannel}
            onOpenIssue={(id) =>
              setView({ name: "issue", address: repository.address, id, projectId: view.projectId })
            }
            onOpenPull={(id) =>
              setView({ name: "pull", address: repository.address, id, projectId: view.projectId })
            }
          />
        ) : (
          <WorkItemRoute
            key={`${view.name}:${"id" in view ? view.id : ""}`}
            crumbs={repoCrumbs}
            repository={repository}
            view={view}
            onBackToList={() =>
              openRepository(
                repository,
                view.projectId,
                view.name === "pull" || view.name === "new-pull" ? "pulls" : "issues",
              )
            }
            onOpen={(name, id) =>
              setView({ name, address: repository.address, id, projectId: view.projectId })
            }
          />
        );
    }
  }

  return (
    <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1280px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-semibold leading-tight">{t("nav.projects")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("repos.subtitle")}</p>
          </div>
          {!demo && view.name === "home" ? (
            <button
              className={secondaryButton}
              type="button"
              onClick={() => setView({ name: "create-project" })}
            >
              <FolderPlus className="h-4 w-4" />
              {t("projects.create.open")}
            </button>
          ) : null}
          <button
            aria-label={t("common.refresh")}
            className="buzz-icon-button"
            disabled={collections.isFetching || demo}
            title={t("common.refresh")}
            type="button"
            onClick={() => void refreshForge()}
          >
            <RefreshCw className={`h-4 w-4 ${collections.isFetching ? "animate-spin" : ""}`} />
          </button>
          <button
            aria-label={t("repos.close")}
            className="buzz-icon-button"
            title={t("repos.close")}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {collections.error && !demo ? (
          <div className="mt-5">
            <ErrorNote>{forgeErrorMessage(collections.error)}</ErrorNote>
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
}
