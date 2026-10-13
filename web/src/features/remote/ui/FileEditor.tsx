import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import { readFile, writeFile } from "@/features/remote/lib/remote-api";
import { remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import { isEditableText } from "@/features/remote/lib/workspace-paths";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/** Save a Blob through a temporary object URL (the download is authorized by the signed fetch). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function FileEditor({
  target,
  workspaceId,
  path,
  queryKey,
  onClose,
}: {
  target: AgentControlTarget;
  workspaceId: string;
  path: string;
  queryKey: readonly unknown[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const name = path.split("/").pop() ?? path;
  const file = useQuery({
    queryKey: [...queryKey, "file", path],
    queryFn: async () => {
      const blob = await readFile(target, workspaceId, path);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { blob, text: isEditableText(bytes) ? new TextDecoder().decode(bytes) : null };
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (file.data?.text !== undefined) setDraft(file.data.text);
  }, [file.data]);
  const save = useMutation({
    mutationFn: (text: string) =>
      writeFile(target, workspaceId, path, new TextEncoder().encode(text)),
    onSuccess: (_, text) => {
      queryClient.setQueryData([...queryKey, "file", path], {
        blob: new Blob([text]),
        text,
      });
      void queryClient.invalidateQueries({ queryKey: [...queryKey, "list"] });
      toast.success(t("remote.files.saved", { name }));
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });
  const dirty = draft !== null && file.data?.text !== undefined && draft !== file.data.text;

  return (
    <section
      aria-label={t("remote.files.editorLabel", { name })}
      className="flex min-h-0 flex-1 flex-col border-t lg:border-l lg:border-t-0"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h3 className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </h3>
        {dirty ? (
          <span className="text-[11px] text-muted-foreground">{t("remote.files.unsaved")}</span>
        ) : null}
        {file.data?.text !== null && file.data ? (
          <Button
            disabled={!dirty || save.isPending}
            size="sm"
            onClick={() => draft !== null && save.mutate(draft)}
          >
            <Save />
            {save.isPending ? t("remote.files.saving") : t("remote.files.save")}
          </Button>
        ) : null}
        <button
          aria-label={t("remote.files.closeEditor")}
          className="buzz-icon-button h-8 w-8"
          title={t("remote.files.closeEditor")}
          type="button"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {file.isPending ? (
        <p className="p-4 text-sm text-muted-foreground">{t("remote.files.loading")}</p>
      ) : file.isError ? (
        <p className="p-4 text-sm text-destructive" role="alert">
          {remoteErrorMessage(file.error)}
        </p>
      ) : file.data.text === null ? (
        <div className="space-y-3 p-4 text-sm">
          <p className="text-muted-foreground">{t("remote.files.binary")}</p>
          <Button size="sm" variant="outline" onClick={() => saveBlob(file.data.blob, name)}>
            <Download />
            {t("remote.files.download", { name })}
          </Button>
        </div>
      ) : (
        <textarea
          aria-label={t("remote.files.editorLabel", { name })}
          className="buzz-scrollbar min-h-[240px] flex-1 resize-none bg-background p-3 font-mono text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          spellCheck={false}
          value={draft ?? ""}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              if (dirty && draft !== null) save.mutate(draft);
            }
          }}
        />
      )}
    </section>
  );
}
