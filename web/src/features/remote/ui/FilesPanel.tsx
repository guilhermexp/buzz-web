import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  Link2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import {
  deleteFile,
  listFiles,
  type RemoteFileEntry,
  readFile,
  writeFile,
} from "@/features/remote/lib/remote-api";
import { remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import {
  joinWorkspacePath,
  resolveNewFilePath,
  workspaceBreadcrumbs,
} from "@/features/remote/lib/workspace-paths";
import { FileEditor, saveBlob } from "@/features/remote/ui/FileEditor";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EntryIcon({ entry }: { entry: RemoteFileEntry }) {
  if (entry.type === "directory") return <Folder className="h-4 w-4 text-primary" />;
  if (entry.type === "symlink") return <Link2 className="h-4 w-4 text-muted-foreground" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

export function FilesPanel({
  target,
  workspaceId,
  workspaceName,
  queryKey,
}: {
  target: AgentControlTarget;
  workspaceId: string;
  workspaceName: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState("");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const listKey = [...queryKey, "list", directory];
  const entries = useQuery({
    queryKey: listKey,
    queryFn: () => listFiles(target, workspaceId, directory),
    refetchOnMount: "always",
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...queryKey, "list"] });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeFile(target, workspaceId, joinWorkspacePath(directory, file.name), bytes);
        toast.success(t("remote.files.uploaded", { name: file.name }));
      }
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
    onSettled: () => void refresh(),
  });
  const create = useMutation({
    mutationFn: (path: string) => writeFile(target, workspaceId, path, new Uint8Array()),
    onSuccess: (_, path) => {
      setNewFileName(null);
      setOpenFile(path);
      void refresh();
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (path: string) => deleteFile(target, workspaceId, path),
    onSuccess: (_, path) => {
      setPendingDelete(null);
      if (openFile === path || openFile?.startsWith(`${path}/`)) setOpenFile(null);
      toast.success(t("remote.files.deleted", { name: path.split("/").pop() ?? path }));
      void refresh();
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });
  const download = useMutation({
    mutationFn: async (path: string) =>
      saveBlob(await readFile(target, workspaceId, path), path.split("/").pop() ?? path),
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });

  const newFilePath = newFileName === null ? null : resolveNewFilePath(directory, newFileName);
  const submitNewFile = (event: FormEvent) => {
    event.preventDefault();
    if (newFilePath) create.mutate(newFilePath);
  };

  return (
    <section
      aria-label={t("remote.files.label", { name: workspaceName })}
      className="flex min-h-0 flex-1 flex-col lg:flex-row"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          <nav aria-label={t("remote.files.breadcrumbs")} className="min-w-0 flex-1">
            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
              <li>
                <button
                  aria-current={directory === "" ? "location" : undefined}
                  className="rounded px-1.5 py-1 font-medium hover:bg-accent"
                  type="button"
                  onClick={() => setDirectory("")}
                >
                  {t("remote.files.root")}
                </button>
              </li>
              {workspaceBreadcrumbs(directory).map((crumb) => (
                <li className="flex items-center gap-1" key={crumb.path}>
                  <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />
                  <button
                    aria-current={crumb.path === directory ? "location" : undefined}
                    className="max-w-40 truncate rounded px-1.5 py-1 font-mono hover:bg-accent"
                    type="button"
                    onClick={() => setDirectory(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <input
            className="hidden"
            multiple
            ref={uploadRef}
            tabIndex={-1}
            type="file"
            data-testid="remote-upload-input"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) upload.mutate(files);
            }}
          />
          <Button
            disabled={upload.isPending}
            size="sm"
            variant="outline"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload />
            {upload.isPending ? t("remote.files.uploading") : t("remote.files.upload")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNewFileName("")}>
            <FilePlus />
            {t("remote.files.newFile")}
          </Button>
          <button
            aria-label={t("remote.files.refresh")}
            className="buzz-icon-button h-8 w-8"
            title={t("remote.files.refresh")}
            type="button"
            onClick={() => void refresh()}
          >
            <RefreshCw className={`h-4 w-4 ${entries.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        {newFileName !== null ? (
          <form
            className="flex flex-wrap items-start gap-2 border-b px-3 py-2"
            onSubmit={submitNewFile}
          >
            <div className="min-w-48 flex-1">
              <input
                aria-describedby="remote-new-file-error"
                aria-invalid={newFileName !== "" && !newFilePath}
                aria-label={t("remote.files.newFileName")}
                ref={(input) => input?.focus({ preventScroll: true })}
                className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={t("remote.files.newFileName")}
                value={newFileName}
                onChange={(event) => setNewFileName(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setNewFileName(null)}
              />
              {newFileName !== "" && !newFilePath ? (
                <p className="mt-1 text-[11px] text-destructive" id="remote-new-file-error">
                  {t("remote.files.invalidName")}
                </p>
              ) : null}
            </div>
            <Button disabled={!newFilePath || create.isPending} size="sm" type="submit">
              {t("remote.files.createFile")}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setNewFileName(null)}>
              {t("remote.cancel")}
            </Button>
          </form>
        ) : null}
        <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
          {entries.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">{t("remote.files.loading")}</p>
          ) : entries.isError ? (
            <p className="p-4 text-sm text-destructive" role="alert">
              {remoteErrorMessage(entries.error)}
            </p>
          ) : entries.data.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("remote.files.emptyFolder")}</p>
          ) : (
            <ul className="divide-y">
              {entries.data.map((entry) => {
                const path = joinWorkspacePath(directory, entry.name);
                const isDirectory = entry.type === "directory";
                return (
                  <li
                    className={`flex min-h-10 items-center gap-2 px-3 py-1 text-sm ${
                      openFile === path ? "bg-accent" : ""
                    }`}
                    key={entry.name}
                  >
                    <EntryIcon entry={entry} />
                    <button
                      aria-label={
                        isDirectory
                          ? t("remote.files.openFolder", { name: entry.name })
                          : t("remote.files.openFile", { name: entry.name })
                      }
                      className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:underline disabled:no-underline disabled:opacity-70"
                      disabled={entry.type === "other"}
                      type="button"
                      onClick={() => (isDirectory ? setDirectory(path) : setOpenFile(path))}
                    >
                      {entry.name}
                    </button>
                    <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                      {isDirectory
                        ? ""
                        : entry.type === "symlink"
                          ? t("remote.files.link")
                          : formatSize(entry.size)}
                    </span>
                    <span className="hidden w-36 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
                      {new Date(entry.modifiedAt * 1000).toLocaleString()}
                    </span>
                    {pendingDelete === path ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="sr-only">
                          {t("remote.files.deleteConfirm", { name: entry.name })}
                        </span>
                        <Button
                          disabled={remove.isPending}
                          size="sm"
                          variant="destructive"
                          onClick={() => remove.mutate(path)}
                        >
                          {t("remote.files.deleteAction")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                          {t("remote.cancel")}
                        </Button>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center">
                        {entry.type === "file" ? (
                          <button
                            aria-label={t("remote.files.download", { name: entry.name })}
                            className="buzz-icon-button h-8 w-8"
                            title={t("remote.files.download", { name: entry.name })}
                            type="button"
                            onClick={() => download.mutate(path)}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          aria-label={t("remote.files.delete", { name: entry.name })}
                          className="buzz-icon-button h-8 w-8"
                          title={t("remote.files.delete", { name: entry.name })}
                          type="button"
                          onClick={() => setPendingDelete(path)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {openFile ? (
        <div className="flex min-h-[320px] min-w-0 flex-1 flex-col lg:min-h-0">
          <FileEditor
            key={openFile}
            path={openFile}
            queryKey={queryKey}
            target={target}
            workspaceId={workspaceId}
            onClose={() => setOpenFile(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
