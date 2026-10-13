import { LoaderCircle, Plus, RefreshCw, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { useWorkflowList } from "@/features/workflows/lib/use-workflow-list";
import type { WorkflowRecord } from "@/features/workflows/lib/workflow-events";
import { triggerSummary } from "@/features/workflows/lib/workflow-format";
import { WorkflowDetail } from "@/features/workflows/ui/WorkflowDetail";
import { type SavedWorkflow, WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { t } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";

type Mode = { kind: "view" } | { kind: "create" } | { kind: "edit"; workflow: WorkflowRecord };
type IssuedSecret = { workflowId: string; secret: string | null; lost: boolean };

function workflowKey(workflow: Pick<WorkflowRecord, "ownerPubkey" | "id">): string {
  return `${workflow.ownerPubkey}:${workflow.id}`;
}

/** Workflows tool: definitions per accessible channel, editor, triggers, runs and approvals. */
export function WorkflowsView({ onClose }: { onClose: () => void }) {
  const { channels, pubkey, profiles, ensureProfiles, selectedChannel } = useWorkspace();
  const list = useWorkflowList();
  const [channelFilter, setChannelFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [issuedSecret, setIssuedSecret] = useState<IssuedSecret | null>(null);
  const memberChannels = useMemo(
    () =>
      channels.filter((channel) => channel.isMember && channel.type !== "dm" && !channel.archived),
    [channels],
  );
  const channelNames = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel.name])),
    [channels],
  );
  const visible = list.workflows.filter(
    (workflow) => channelFilter === "all" || workflow.channelId === channelFilter,
  );
  const selected = selectedKey
    ? (list.workflows.find((workflow) => workflowKey(workflow) === selectedKey) ?? null)
    : null;
  const showDetail = mode.kind !== "view" || selected !== null;

  useEffect(() => {
    const owners = [...new Set(list.workflows.map((workflow) => workflow.ownerPubkey))];
    if (owners.length) void ensureProfiles(owners);
  }, [ensureProfiles, list.workflows]);

  const personLabel = useCallback(
    (key: string) => profiles[key.toLowerCase()]?.name || truncatePubkey(key),
    [profiles],
  );

  async function handleSaved(saved: SavedWorkflow) {
    await list.refresh();
    setSelectedKey(workflowKey({ ownerPubkey: pubkey, id: saved.workflowId }));
    setMode({ kind: "view" });
    if (saved.webhookSecret || saved.webhookSecretLost) {
      setIssuedSecret({
        workflowId: saved.workflowId,
        secret: saved.webhookSecret,
        lost: saved.webhookSecretLost,
      });
    }
  }

  const unavailable = memberChannels.length ? null : t("workflows.noChannels");
  const secretFor = selected && issuedSecret?.workflowId === selected.id ? issuedSecret : null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section
        aria-label={t("workflows.list")}
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-r lg:flex lg:w-[340px]",
          showDetail ? "hidden" : "flex",
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <Workflow className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {t("workflows.title")}
          </h2>
          <button
            aria-label={t("workflows.create")}
            className="buzz-icon-button"
            disabled={Boolean(unavailable)}
            title={t("workflows.create")}
            type="button"
            onClick={() => {
              setMode({ kind: "create" });
              setSelectedKey(null);
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            aria-label={t("workflows.refresh")}
            className="buzz-icon-button"
            disabled={Boolean(unavailable) || list.refreshing}
            title={t("workflows.refresh")}
            type="button"
            onClick={() => void list.refresh()}
          >
            <RefreshCw className={cn("h-4 w-4", list.refreshing && "animate-spin")} />
          </button>
          <button
            aria-label={t("workflows.close")}
            className="buzz-icon-button"
            title={t("workflows.close")}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {memberChannels.length > 1 ? (
          <div className="shrink-0 border-b px-3 py-2">
            <select
              aria-label={t("workflows.channelFilter")}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
            >
              <option value="all">{t("workflows.allChannels")}</option>
              {memberChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {list.error ? (
          <p className="border-b bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
            {list.error}
          </p>
        ) : null}

        <div className="buzz-scrollbar min-h-0 flex-1 overflow-y-auto">
          {unavailable ? (
            <p className="px-5 py-14 text-center text-sm text-muted-foreground">{unavailable}</p>
          ) : list.loading ? (
            <p
              className="flex items-center justify-center px-5 py-14 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {t("workflows.loading")}
            </p>
          ) : !visible.length ? (
            <div className="px-5 py-14 text-center">
              <Workflow className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm">{t("workflows.empty")}</p>
              <p className="mx-auto mt-1 max-w-64 text-xs text-muted-foreground">
                {t("workflows.emptyHint")}
              </p>
            </div>
          ) : (
            <ul>
              {visible.map((workflow) => {
                const key = workflowKey(workflow);
                const definition = workflow.validation.ok ? workflow.validation.definition : null;
                const isSelected = key === selectedKey && mode.kind === "view";
                return (
                  <li key={key}>
                    <button
                      aria-pressed={isSelected}
                      className={cn(
                        "flex w-full flex-col gap-1 border-b px-3 py-3 text-left transition-colors",
                        isSelected ? "bg-foreground/[0.055]" : "hover:bg-foreground/[0.035]",
                      )}
                      data-testid="workflow-list-item"
                      type="button"
                      onClick={() => {
                        setSelectedKey(key);
                        setMode({ kind: "view" });
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {definition?.name ?? workflow.id}
                        </span>
                        {definition ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                              definition.enabled
                                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {definition.enabled ? t("workflows.enabled") : t("workflows.disabled")}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          #{channelNames[workflow.channelId] ?? workflow.channelId}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">
                          {workflow.ownerPubkey === pubkey
                            ? t("workflows.you")
                            : personLabel(workflow.ownerPubkey)}
                        </span>
                      </span>
                      {definition ? (
                        <span className="line-clamp-1 text-xs text-foreground/80">
                          {triggerSummary(definition.trigger)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        aria-label={t("workflows.details")}
        className={cn("min-h-0 min-w-0 flex-1 flex-col", showDetail ? "flex" : "hidden lg:flex")}
      >
        {mode.kind !== "view" ? (
          <WorkflowEditor
            channels={memberChannels}
            defaultChannelId={
              channelFilter !== "all"
                ? channelFilter
                : selectedChannel?.isMember
                  ? selectedChannel.id
                  : null
            }
            key={mode.kind === "edit" ? workflowKey(mode.workflow) : "create"}
            latest={
              mode.kind === "edit"
                ? (list.workflows.find(
                    (workflow) => workflowKey(workflow) === workflowKey(mode.workflow),
                  ) ?? null)
                : null
            }
            workflow={mode.kind === "edit" ? mode.workflow : null}
            onCancel={() => setMode({ kind: "view" })}
            onConflict={() => void list.refresh()}
            onSaved={(saved) => void handleSaved(saved)}
          />
        ) : selected ? (
          <WorkflowDetail
            channelName={channelNames[selected.channelId] ?? selected.channelId}
            key={workflowKey(selected)}
            personLabel={personLabel}
            webhookSecret={secretFor?.secret ?? null}
            webhookSecretLost={secretFor?.lost ?? false}
            workflow={selected}
            onBack={() => setSelectedKey(null)}
            onChanged={() => void list.refresh()}
            onDeleted={() => {
              setSelectedKey(null);
              void list.refresh();
            }}
            onEdit={() => setMode({ kind: "edit", workflow: selected })}
            onSecretDone={() => setIssuedSecret(null)}
          />
        ) : (
          <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t("workflows.selectPrompt")}
          </p>
        )}
      </section>
    </div>
  );
}
