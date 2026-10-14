import { Link } from "@tanstack/react-router";
import {
  BookMarked,
  Check,
  Copy,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { mockRepoCommits, mockRepoReadme, mockRepoTree } from "@/features/repos/mock-repos";
import { useGitLog, useGitReadme, useGitTree } from "@/features/repos/use-git-browse";
import type { RepoRefs } from "@/features/repos/use-repo-refs";
import type { Repo } from "@/features/repos/use-repos";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import type { ProtectionTag } from "../lib/nip34";
import { RepoContentTabs, type RepoExtraTab } from "./RepoContentTabs";
import { RepoRefsSection } from "./RepoRefsSection";

function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function RepoDetail({
  repo,
  demo,
  relayUrl,
  refs,
  refsLoading,
  protections = [],
  breadcrumbs,
  headerActions,
  extraTabs,
  initialTab,
  onOpenChannel,
}: {
  repo: Repo;
  demo: boolean;
  relayUrl: string;
  refs: RepoRefs | undefined;
  refsLoading: boolean;
  protections?: ProtectionTag[];
  breadcrumbs: ReactNode;
  headerActions?: ReactNode;
  extraTabs?: RepoExtraTab[];
  initialTab?: string;
  onOpenChannel: (channelId: string) => void;
}) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [treePath, setTreePath] = useState("");
  const webUrl = safeWebUrl(repo.webUrl);
  const defaultRef = refs?.head?.ref ?? refs?.branches[0] ?? "main";
  // An announced repository without any pushed branch has nothing to clone yet.
  const isEmpty = !demo && !refsLoading && (!refs || refs.branches.length === 0);
  const browseOwner = demo || isEmpty || refsLoading ? "" : repo.owner;
  const treeQuery = useGitTree(relayUrl, browseOwner, repo.id, defaultRef, treePath);
  const commitsQuery = useGitLog(relayUrl, browseOwner, repo.id, defaultRef);
  const readmeQuery = useGitReadme(relayUrl, browseOwner, repo.id, defaultRef);
  const browseError = treeQuery.error || commitsQuery.error;

  const copyCloneUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl((current) => (current === url ? null : current)), 2_000);
    } catch {
      setCopiedUrl(null);
    }
  };

  return (
    <div className="mt-8">
      {breadcrumbs}
      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="border-b pb-6">
            <div className="flex flex-wrap items-start gap-3">
              <BookMarked className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-2xl font-semibold">{repo.name}</h3>
                {repo.description ? (
                  <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted-foreground">
                    {repo.description}
                  </p>
                ) : null}
              </div>
              {headerActions ? <div className="flex flex-wrap gap-2">{headerActions}</div> : null}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("repos.updated", { time: relativeTime(repo.createdAt) })}
            </p>
            <RepoRefsSection refs={refs} isLoading={refsLoading} />
          </div>

          {browseError ? (
            <div className="mt-5 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t("error.repoContentsLoad")}: {browseError.message}
            </div>
          ) : null}

          <RepoContentTabs
            commits={demo ? mockRepoCommits : commitsQuery.data}
            commitsLoading={demo || isEmpty ? false : commitsQuery.isLoading}
            extraTabs={extraTabs}
            initialTab={initialTab}
            preview={demo}
            readme={demo ? mockRepoReadme : readmeQuery.data}
            readmeLoading={demo || isEmpty ? false : readmeQuery.isLoading}
            repoId={repo.id}
            treeEntries={demo ? mockRepoTree : treeQuery.data}
            treeLoading={demo || isEmpty ? false : treeQuery.isLoading}
            treePath={treePath}
            onOpenDirectory={demo ? undefined : setTreePath}
          />

          {repo.cloneUrls.length ? (
            <section className="border-b py-6">
              <h4 className="mb-3 text-sm font-semibold">{t("repos.clone")}</h4>
              <div className="space-y-2">
                {repo.cloneUrls.map((url) => (
                  <div key={url} className="flex items-center gap-2 rounded-md border px-3 py-2.5">
                    <code className="min-w-0 flex-1 truncate text-xs" title={url}>
                      {url}
                    </code>
                    <button
                      aria-label={t("repos.copyClone")}
                      className="buzz-icon-button h-7 w-7 shrink-0"
                      title={t("repos.copyClone")}
                      type="button"
                      onClick={() => void copyCloneUrl(url)}
                    >
                      {copiedUrl === url ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {isEmpty ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {t("projects.repo.emptyPushHint")}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{t("repos.owner")}</div>
            <div className="mt-1 break-all font-mono text-xs" title={repo.owner}>
              {truncatePubkey(repo.owner)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              {t("repos.contributors")}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              {repo.contributors.length}
            </div>
          </div>
          {protections.length ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                {t("projects.repo.protections")}
              </div>
              <ul className="mt-1 space-y-1">
                {protections.map((rule) => (
                  <li
                    key={`${rule.pattern}:${rule.rules.join(",")}`}
                    className="flex gap-1.5 text-xs"
                  >
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-all font-mono">
                      {rule.pattern} · {rule.rules.join(" ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 pt-2">
            {repo.channelId ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5"
                type="button"
                onClick={() => onOpenChannel(repo.channelId as string)}
              >
                <MessageSquare className="h-4 w-4" />
                {t("repos.openChannel")}
              </button>
            ) : null}
            <Link
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5"
              params={{ repoId: repo.id }}
              rel="noopener noreferrer"
              search={demo ? { preview: "repositories" } : undefined}
              target="_blank"
              to="/repos/$repoId"
            >
              <ExternalLink className="h-4 w-4" />
              {t("repos.openFull")}
            </Link>
            {webUrl ? (
              <a
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5"
                href={webUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLink className="h-4 w-4" />
                {t("repos.openWeb")}
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
