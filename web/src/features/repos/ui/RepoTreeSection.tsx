import { Link } from "@tanstack/react-router";
import { CornerLeftUp, File, Folder } from "lucide-react";
import { t } from "@/shared/i18n";
import type { TreeEntry } from "../git-client";

const rowClass =
  "flex w-full items-center gap-2 border-b border-black/10 px-3 py-2 text-left text-sm last:border-b-0 dark:border-white/10";

function TreeRow({
  entry,
  path,
  repoId,
  preview,
  onOpenDirectory,
}: {
  entry: TreeEntry;
  path: string;
  repoId: string;
  preview: boolean;
  onOpenDirectory?: (path: string) => void;
}) {
  const fullPath = path ? `${path}/${entry.name}` : entry.name;
  if (entry.type === "tree") {
    if (!onOpenDirectory) {
      return (
        <div className={`${rowClass} text-black/60 dark:text-white/60`} aria-disabled="true">
          <Folder className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
          <span className="font-medium">{entry.name}</span>
        </div>
      );
    }
    return (
      <button
        className={`${rowClass} text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/5`}
        type="button"
        onClick={() => onOpenDirectory(fullPath)}
      >
        <Folder className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
        <span className="font-medium">{entry.name}</span>
      </button>
    );
  }

  return (
    <Link
      to="/repos/$repoId/blob/$"
      params={{ repoId, _splat: fullPath }}
      search={preview ? { preview: "repositories" } : undefined}
      className={`${rowClass} text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/5`}
    >
      <File className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
      <span>{entry.name}</span>
    </Link>
  );
}

export function RepoTreeSection({
  entries,
  isLoading,
  repoId,
  preview = false,
  path = "",
  onOpenDirectory,
}: {
  entries: TreeEntry[] | undefined;
  isLoading: boolean;
  repoId: string;
  preview?: boolean;
  path?: string;
  onOpenDirectory?: (path: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="mt-8">
        <div className="rounded-lg border border-black/10 dark:border-white/10">
          {["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"].map((key) => (
            <div
              key={key}
              className="flex items-center gap-2 border-b border-black/10 px-3 py-2 last:border-b-0 dark:border-white/10"
            >
              <div className="h-4 w-4 animate-pulse rounded bg-black/10 dark:bg-white/10" />
              <div className="h-4 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if ((!entries || entries.length === 0) && !path) return null;

  return (
    <div className="mt-8">
      {path ? (
        <p className="mb-2 truncate font-mono text-xs text-muted-foreground" title={path}>
          {path}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-black/10 bg-white/50 dark:border-white/10 dark:bg-white/5">
        {path && onOpenDirectory ? (
          <button
            aria-label={t("projects.tree.up")}
            className={`${rowClass} text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5`}
            type="button"
            onClick={() => onOpenDirectory(path.split("/").slice(0, -1).join("/"))}
          >
            <CornerLeftUp className="h-4 w-4 shrink-0" />
            <span aria-hidden="true">..</span>
          </button>
        ) : null}
        {(entries ?? []).map((entry) => (
          <TreeRow
            key={entry.name}
            entry={entry}
            path={path}
            repoId={repoId}
            preview={preview}
            onOpenDirectory={onOpenDirectory}
          />
        ))}
      </div>
    </div>
  );
}
