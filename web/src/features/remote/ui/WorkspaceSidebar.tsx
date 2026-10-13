import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import {
  createWorkspace,
  deleteWorkspace,
  type RemoteGrant,
  type RemoteWorkspace,
} from "@/features/remote/lib/remote-api";
import { remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function statusLabel(status: RemoteWorkspace["status"]): string {
  if (status === "running") return t("remote.status.running");
  if (status === "stopped") return t("remote.status.stopped");
  return t("remote.status.missing");
}

export function WorkspaceSidebar({
  target,
  grant,
  workspaces,
  selectedId,
  queryKey,
  onSelect,
}: {
  target: AgentControlTarget;
  grant: RemoteGrant;
  workspaces: readonly RemoteWorkspace[];
  selectedId: string | null;
  queryKey: readonly unknown[];
  onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(workspaces.length === 0);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const restricted = !grant.workspaces.includes("*");
  const idValid = WORKSPACE_ID_PATTERN.test(id) && (!restricted || grant.workspaces.includes(id));
  const atQuota = workspaces.length >= grant.maxWorkspaces;

  const create = useMutation({
    mutationFn: () => createWorkspace(target, { id, name: name.trim() || id }),
    onSuccess: async () => {
      toast.success(t("remote.created", { name: name.trim() || id }));
      await queryClient.invalidateQueries({ queryKey: [...queryKey, "workspaces"] });
      onSelect(id);
      setCreating(false);
      setId("");
      setName("");
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (workspace: RemoteWorkspace) => deleteWorkspace(target, workspace.id),
    onSuccess: async (_, workspace) => {
      toast.success(t("remote.deleted", { name: workspace.name }));
      setPendingDelete(null);
      if (selectedId === workspace.id) onSelect(null);
      await queryClient.invalidateQueries({ queryKey: [...queryKey, "workspaces"] });
    },
    onError: (error) => toast.error(remoteErrorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (idValid && !atQuota) create.mutate();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h3 className="flex-1 text-xs font-semibold">{t("remote.workspaces")}</h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t("remote.quota", { count: workspaces.length, max: grant.maxWorkspaces })}
        </span>
        {!creating && !atQuota ? (
          <button
            aria-label={t("remote.createTitle")}
            className="buzz-icon-button h-7 w-7"
            title={t("remote.createTitle")}
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {creating && !atQuota ? (
        <form
          aria-label={t("remote.createTitle")}
          className="space-y-2 border-b p-3"
          onSubmit={submit}
        >
          <label className="block space-y-1 text-xs" htmlFor="remote-workspace-id">
            <span className="font-medium">{t("remote.idLabel")}</span>
            <input
              aria-describedby="remote-workspace-id-hint"
              aria-invalid={id !== "" && !idValid}
              autoComplete="off"
              className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              id="remote-workspace-id"
              spellCheck={false}
              value={id}
              onChange={(event) => setId(event.target.value.toLowerCase())}
            />
            <span
              className={`block text-[11px] ${id !== "" && !idValid ? "text-destructive" : "text-muted-foreground"}`}
              id="remote-workspace-id-hint"
            >
              {id !== "" && !idValid ? t("remote.error.badId") : t("remote.idHint")}
            </span>
          </label>
          <label className="block space-y-1 text-xs" htmlFor="remote-workspace-name">
            <span className="font-medium">{t("remote.nameLabel")}</span>
            <input
              className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              id="remote-workspace-name"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={!idValid || create.isPending} size="sm" type="submit">
              {create.isPending ? t("remote.creating") : t("remote.create")}
            </Button>
            {workspaces.length ? (
              <Button size="sm" type="button" variant="ghost" onClick={() => setCreating(false)}>
                {t("remote.cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {workspaces.length === 0 ? (
        <p className="p-3 text-xs leading-5 text-muted-foreground md:hidden">{t("remote.empty")}</p>
      ) : (
        <ul className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {workspaces.map((workspace) => (
            <li className="group" key={workspace.id}>
              {pendingDelete === workspace.id ? (
                <fieldset className="space-y-2 rounded-md border border-destructive/40 p-2 text-xs">
                  <p>{t("remote.deleteConfirm", { name: workspace.name })}</p>
                  <div className="flex gap-2">
                    <Button
                      disabled={remove.isPending}
                      size="sm"
                      variant="destructive"
                      onClick={() => remove.mutate(workspace)}
                    >
                      {t("remote.deleteAction")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                      {t("remote.cancel")}
                    </Button>
                  </div>
                </fieldset>
              ) : (
                <div
                  className={`flex items-center gap-1 rounded-md ${
                    workspace.id === selectedId ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <button
                    aria-current={workspace.id === selectedId ? "true" : undefined}
                    aria-label={t("remote.open", { name: workspace.name })}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                    type="button"
                    onClick={() => onSelect(workspace.id)}
                  >
                    <Box aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{workspace.name}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${
                            workspace.status === "running"
                              ? "bg-[hsl(var(--buzz-positive))]"
                              : "bg-muted-foreground/50"
                          }`}
                        />
                        <span className="truncate font-mono">{workspace.id}</span>
                        <span>· {statusLabel(workspace.status)}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={t("remote.delete", { name: workspace.name })}
                    className="buzz-icon-button mr-1 h-7 w-7 shrink-0"
                    title={t("remote.delete", { name: workspace.name })}
                    type="button"
                    onClick={() => setPendingDelete(workspace.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
