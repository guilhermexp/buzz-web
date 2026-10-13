import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Folder, SquareTerminal, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { AgentControlTarget } from "@/features/remote/lib/agent-control-request";
import {
  fetchGrant,
  listWorkspaces,
  type RemoteCapability,
  type RemoteGrant,
  type RemoteWorkspace,
} from "@/features/remote/lib/remote-api";
import { remoteErrorCode, remoteErrorMessage } from "@/features/remote/lib/remote-errors";
import { FilesPanel } from "@/features/remote/ui/FilesPanel";
import { McpToolsPanel } from "@/features/remote/ui/McpToolsPanel";
import { TerminalPanel } from "@/features/remote/ui/TerminalPanel";
import { WorkspaceSidebar } from "@/features/remote/ui/WorkspaceSidebar";
import { type MessageKey, t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

type Tab = "terminal" | "files" | "tools";

const TABS: { id: Tab; capability: RemoteCapability; label: MessageKey; Icon: typeof Folder }[] = [
  { id: "terminal", capability: "terminal", label: "remote.tab.terminal", Icon: SquareTerminal },
  { id: "files", capability: "files", label: "remote.tab.files", Icon: Folder },
  { id: "tools", capability: "mcp", label: "remote.tab.tools", Icon: Wrench },
];

function Notice({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
          {t("remote.retry")}
        </Button>
      ) : null}
    </div>
  );
}

function WorkspaceDetail({
  target,
  grant,
  workspace,
  queryKey,
  onBack,
}: {
  target: AgentControlTarget;
  grant: RemoteGrant;
  workspace: RemoteWorkspace;
  queryKey: readonly unknown[];
  onBack: () => void;
}) {
  const tabs = TABS.filter((tab) => grant.capabilities.includes(tab.capability));
  const [active, setActive] = useState<Tab>(tabs[0]?.id ?? "terminal");
  const workspaceKey = [...queryKey, "workspace", workspace.id];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {/* Unlayered `.buzz-icon-button` sets `display`, which outranks Tailwind's `md:hidden`,
            so the breakpoint visibility lives on a wrapper. */}
        <span className="contents md:hidden">
          <button
            aria-label={t("remote.back")}
            className="buzz-icon-button h-8 w-8"
            title={t("remote.back")}
            type="button"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </span>
        <h3 className="mr-2 min-w-0 truncate text-sm font-semibold">{workspace.name}</h3>
        <div aria-label={t("remote.tabs")} className="ml-auto flex gap-1" role="tablist">
          {tabs.map(({ id, label, Icon }) => (
            <button
              aria-controls={`remote-panel-${id}`}
              aria-selected={active === id}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent aria-selected:bg-accent aria-selected:text-foreground"
              id={`remote-tab-${id}`}
              key={id}
              role="tab"
              type="button"
              onClick={() => setActive(id)}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {tabs.some((tab) => tab.id === "terminal") ? (
        <div
          aria-labelledby="remote-tab-terminal"
          className="flex min-h-0 flex-1 flex-col"
          hidden={active !== "terminal"}
          id="remote-panel-terminal"
          role="tabpanel"
        >
          <TerminalPanel
            active={active === "terminal"}
            target={target}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </div>
      ) : null}
      {active === "files" ? (
        <div
          aria-labelledby="remote-tab-files"
          className="flex min-h-0 flex-1 flex-col"
          id="remote-panel-files"
          role="tabpanel"
        >
          <FilesPanel
            queryKey={workspaceKey}
            target={target}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </div>
      ) : null}
      {active === "tools" ? (
        <div
          aria-labelledby="remote-tab-tools"
          className="flex min-h-0 flex-1 flex-col"
          id="remote-panel-tools"
          role="tabpanel"
        >
          <McpToolsPanel
            queryKey={workspaceKey}
            target={target}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </div>
      ) : null}
    </div>
  );
}

function RemoteWorkspaces({ target, pubkey }: { target: AgentControlTarget; pubkey: string }) {
  const queryKey = useMemo(
    () => ["remote", target.baseUrl, target.relayUrl, pubkey],
    [target, pubkey],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const grant = useQuery({
    queryKey: [...queryKey, "grant"],
    queryFn: () => fetchGrant(target),
    retry: false,
  });
  const workspaces = useQuery({
    queryKey: [...queryKey, "workspaces"],
    queryFn: () => listWorkspaces(target),
    enabled: grant.isSuccess,
    retry: false,
    refetchInterval: 15_000,
  });

  const error = grant.error ?? workspaces.error;
  if (error) {
    const code = remoteErrorCode(error);
    if (code === "forbidden") {
      return <Notice body={t("remote.noGrantBody")} title={t("remote.noGrantTitle")} />;
    }
    if (code === "revoked") {
      return <Notice body={t("remote.revokedBody")} title={t("remote.revokedTitle")} />;
    }
    return (
      <Notice
        body={remoteErrorMessage(error)}
        title={t("remote.loadFailed")}
        onRetry={() => {
          void grant.refetch();
          void workspaces.refetch();
        }}
      />
    );
  }
  if (!grant.data || !workspaces.data) {
    return <p className="px-6 py-10 text-sm text-muted-foreground">{t("remote.files.loading")}</p>;
  }
  const selected = workspaces.data.find((workspace) => workspace.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        aria-label={t("remote.workspaces")}
        className={`min-h-0 w-full shrink-0 flex-col border-r bg-sidebar/40 md:flex md:w-64 ${
          selected ? "hidden" : "flex"
        }`}
      >
        <WorkspaceSidebar
          grant={grant.data}
          queryKey={queryKey}
          selectedId={selectedId}
          target={target}
          workspaces={workspaces.data}
          onSelect={setSelectedId}
        />
      </aside>
      {selected ? (
        <WorkspaceDetail
          grant={grant.data}
          key={selected.id}
          queryKey={queryKey}
          target={target}
          workspace={selected}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-8 md:flex">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {workspaces.data.length ? t("remote.selectWorkspace") : t("remote.empty")}
          </p>
        </div>
      )}
    </div>
  );
}

/** Remote workspace tool: contained terminals, files and MCP tools via Agent Control. */
export function RemoteWorkspaceView({ onClose }: { onClose: () => void }) {
  const { config, demo, relayUrl, pubkey } = useWorkspace();
  const baseUrl = config.agentControlUrl;
  const target = useMemo(() => (baseUrl ? { baseUrl, relayUrl } : null), [baseUrl, relayUrl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold leading-tight">{t("remote.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("remote.subtitle")}</p>
        </div>
        <button
          aria-label={t("remote.close")}
          className="buzz-icon-button h-8 w-8 shrink-0"
          title={t("remote.close")}
          type="button"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {demo ? (
        <Notice body={t("remote.demoBody")} title={t("remote.notConfiguredTitle")} />
      ) : !target ? (
        <Notice body={t("remote.notConfiguredBody")} title={t("remote.notConfiguredTitle")} />
      ) : (
        <RemoteWorkspaces pubkey={pubkey} target={target} />
      )}
    </div>
  );
}
