import { type ReactNode, useState } from "react";
import { t } from "@/shared/i18n";
import type { CommitInfo, ReadmeResult, TreeEntry } from "../git-client";
import { RepoCommitsSection } from "./RepoCommitsSection";
import { RepoReadmeSection } from "./RepoReadmeSection";
import { RepoTreeSection } from "./RepoTreeSection";

export type RepoExtraTab = { id: string; label: string; content: ReactNode };

export function RepoContentTabs({
  repoId,
  treeEntries,
  treeLoading,
  commits,
  commitsLoading,
  readme,
  readmeLoading,
  preview,
  treePath = "",
  onOpenDirectory,
  extraTabs = [],
  initialTab = "code",
}: {
  repoId: string;
  treeEntries: TreeEntry[] | undefined;
  treeLoading: boolean;
  commits: CommitInfo[] | undefined;
  commitsLoading: boolean;
  readme: ReadmeResult | null | undefined;
  readmeLoading: boolean;
  preview: boolean;
  treePath?: string;
  onOpenDirectory?: (path: string) => void;
  extraTabs?: RepoExtraTab[];
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const tabs = [
    { id: "code", label: t("repos.code") },
    { id: "commits", label: t("repos.commits") },
    ...extraTabs,
  ];
  const extra = extraTabs.find((candidate) => candidate.id === tab);

  return (
    <div className="mt-6">
      <div
        aria-label={t("repos.contents")}
        className="flex gap-1 overflow-x-auto border-b"
        role="tablist"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-selected={tab === item.id}
            className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            role="tab"
            type="button"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "code" ? (
        <div role="tabpanel">
          <RepoTreeSection
            entries={treeEntries}
            isLoading={treeLoading}
            repoId={repoId}
            preview={preview}
            path={treePath}
            onOpenDirectory={onOpenDirectory}
          />
          {treePath ? null : <RepoReadmeSection readme={readme} isLoading={readmeLoading} />}
        </div>
      ) : tab === "commits" ? (
        <div role="tabpanel">
          <RepoCommitsSection commits={commits} isLoading={commitsLoading} />
        </div>
      ) : (
        <div role="tabpanel">{extra?.content}</div>
      )}
    </div>
  );
}
