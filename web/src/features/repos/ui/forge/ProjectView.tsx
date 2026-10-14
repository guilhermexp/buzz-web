import { AlertTriangle, BookMarked, FolderGit2, MessageSquare, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";
import type { Project, Repository } from "../../lib/nip34";
import { workItemCounts } from "../../lib/work-items";
import { useWorkItems } from "../../use-forge";
import { PersonChip, secondaryButton } from "./forge-ui";

export function ProjectView({
  project,
  breadcrumbs,
  onOpenRepository,
  onAddRepository,
  onOpenChannel,
}: {
  project: Project;
  breadcrumbs: ReactNode;
  onOpenRepository: (repository: Repository) => void;
  onAddRepository: () => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const { pubkey, channels } = useWorkspace();
  const workItems = useWorkItems(project.repositories);
  const isOwner = pubkey === project.owner && !project.legacy;
  const channel = channels.find((candidate) => candidate.id === project.channelId);

  return (
    <div className="mt-8">
      {breadcrumbs}
      <header className="mt-5 flex flex-wrap items-start gap-3 border-b pb-5">
        <FolderGit2 aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-2xl font-semibold">{project.name}</h3>
          {project.description ? (
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted-foreground">
              {project.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <PersonChip pubkey={project.owner} />
            <span>{t("repos.updated", { time: relativeTime(project.createdAt) })}</span>
            {project.visibility === "unlisted" ? (
              <span className="rounded-full border px-2 py-0.5">
                {t("projects.field.unlisted")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.channelId ? (
            <button
              className={secondaryButton}
              type="button"
              onClick={() => onOpenChannel(project.channelId as string)}
            >
              <MessageSquare className="h-4 w-4" />
              {channel
                ? t("projects.openChannelNamed", { channel: channel.name })
                : t("repos.openChannel")}
            </button>
          ) : null}
          {isOwner ? (
            <button className={secondaryButton} type="button" onClick={onAddRepository}>
              <Plus className="h-4 w-4" />
              {t("projects.repo.add")}
            </button>
          ) : null}
        </div>
      </header>

      <section className="mt-5">
        <h4 className="text-sm font-semibold">{t("repos.title")}</h4>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {project.repositories.map((repository) => {
            const items = workItems.data;
            const prs = workItemCounts(
              items?.pullRequests.filter((pr) => pr.repoAddress === repository.address) ?? [],
            );
            const issues = workItemCounts(
              items?.issues.filter((issue) => issue.repoAddress === repository.address) ?? [],
            );
            return (
              <li key={repository.address}>
                <button
                  className="flex min-h-[112px] w-full items-start gap-3 rounded-lg border px-4 py-4 text-left hover:bg-foreground/[0.035]"
                  type="button"
                  onClick={() => onOpenRepository(repository)}
                >
                  <BookMarked
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{repository.name}</span>
                    {repository.description ? (
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                        {repository.description}
                      </span>
                    ) : null}
                    <span className="mt-2 block text-[11px] text-muted-foreground">
                      {items
                        ? t("projects.repo.counts", {
                            prs: prs.open + prs.draft,
                            issues: issues.open + issues.draft,
                          })
                        : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {project.unavailableRepositoryAddresses.length ? (
          <div className="mt-3 flex gap-2 rounded-md border px-3 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t("projects.repo.unavailable", {
                count: project.unavailableRepositoryAddresses.length,
              })}
            </span>
          </div>
        ) : null}
        {!project.repositories.length && !project.unavailableRepositoryAddresses.length ? (
          <p className="mt-3 rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            {t("projects.repo.none")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
