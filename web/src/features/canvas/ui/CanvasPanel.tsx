import { History, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { publishCanvasRevision } from "@/features/canvas/lib/canvas-api";
import { useRegisterOpenCanvas } from "@/features/canvas/lib/canvas-panel-store";
import { agentOwnerCandidates, canEditCanvas } from "@/features/canvas/lib/canvas-permissions";
import type { CanvasRevision } from "@/features/canvas/lib/canvas-protocol";
import { useCanvasAgentOwners } from "@/features/canvas/lib/use-canvas-agent-owners";
import { useCanvasHead } from "@/features/canvas/lib/use-canvas-head";
import { CanvasDocument } from "@/features/canvas/ui/CanvasDocument";
import { CanvasHistory } from "@/features/canvas/ui/CanvasHistory";
import { CanvasNotice } from "@/features/canvas/ui/CanvasNotice";
import { useCanvasAuthorNames } from "@/features/canvas/ui/canvas-display";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { usePersistedPanelWidth } from "@/shared/ui/resizable-panel";
import { RightPanelResizeHandle } from "@/shared/ui/right-panel-sizing";

function CanvasPanelState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <Lock aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * Right-hand canvas panel for one channel. The shell may keep the panel
 * mounted while the user switches channels, so it hands itself over to the
 * newly selected channel (and closes for DMs, which have no canvas).
 */
export function CanvasPanel({ channelId }: { channelId: string }) {
  const { client, channels, pubkey, selectedChannel, showSidePanel } = useWorkspace();
  useRegisterOpenCanvas(channelId);
  const { maximum, minimum, panelWidth, setPanelWidth } = usePersistedPanelWidth({
    defaultWidth: 440,
    minimumWidth: 320,
    maximumWidth: 760,
    reservedWidth: 720,
    storageKey: "buzz-web-canvas-panel-width-v1",
  });
  const [showHistory, setShowHistory] = useState(false);

  const nextChannel = selectedChannel && selectedChannel.id !== channelId ? selectedChannel : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: CanvasPanel is this module-level component, not reactive state
  useEffect(() => {
    if (!nextChannel) return;
    showSidePanel(
      nextChannel.type === "dm" ? null : (
        <CanvasPanel channelId={nextChannel.id} key={nextChannel.id} />
      ),
    );
  }, [nextChannel, showSidePanel]);

  const channel = channels.find((candidate) => candidate.id === channelId) ?? null;
  // Private channels disclose nothing to non-members; don't even ask.
  const readable = channel !== null && (channel.isMember || channel.visibility === "open");
  const canvas = useCanvasHead(client, channelId, readable);
  const agentOwners = useCanvasAgentOwners(
    client,
    channel ? agentOwnerCandidates(channel, pubkey) : [],
  );
  const canEdit = channel !== null && canEditCanvas(channel, pubkey, agentOwners);
  const authorName = useCanvasAuthorNames(canvas.head ? [canvas.head.author] : []);

  async function restore(revision: CanvasRevision, base: CanvasRevision | null) {
    if (!client) throw new Error(t("error.relayClient"));
    const result = await publishCanvasRevision(client, channelId, revision.content, base);
    canvas.adoptHead(result.revision);
    return result;
  }

  const forbidden = channel !== null && (!readable || canvas.status === "forbidden");

  return (
    <aside
      aria-label={t("collab.canvas.title")}
      className="relative flex min-h-0 shrink-0 flex-col border-l bg-background/95 backdrop-blur-xl xl:bg-background/65 xl:backdrop-blur-none max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:shadow-xl max-sm:!w-full"
      style={{ width: panelWidth }}
    >
      <RightPanelResizeHandle
        label={t("collab.canvas.resize")}
        maximum={maximum}
        minimum={minimum}
        panelWidth={panelWidth}
        onResize={setPanelWidth}
      />
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("collab.canvas.title")}</h2>
          {channel ? (
            <p className="truncate text-[11px] text-muted-foreground">#{channel.name}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canvas.status === "ready" && canvas.head ? (
            <button
              aria-pressed={showHistory}
              className="buzz-icon-button"
              title={showHistory ? t("collab.canvas.hideHistory") : t("collab.canvas.history")}
              type="button"
              onClick={() => setShowHistory((open) => !open)}
            >
              <History aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">{t("collab.canvas.history")}</span>
            </button>
          ) : null}
          <button
            aria-label={t("collab.canvas.close")}
            className="buzz-icon-button"
            title={t("collab.canvas.close")}
            type="button"
            onClick={() => showSidePanel(null)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="buzz-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!channel ? (
          <CanvasPanelState
            body={t("collab.canvas.unavailable")}
            title={t("collab.canvas.title")}
          />
        ) : forbidden ? (
          <CanvasPanelState
            body={t("collab.canvas.noAccess.body")}
            title={t("collab.canvas.noAccess.title")}
          />
        ) : canvas.status === "loading" || !client ? (
          <div className="space-y-2 p-3" role="status">
            <span className="sr-only">{t("collab.canvas.loading")}</span>
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
          </div>
        ) : canvas.status === "error" ? (
          <div className="space-y-2 p-3">
            <p className="text-sm text-destructive" role="alert">
              {t("collab.canvas.loadFailed", { detail: (canvas.error ?? "").slice(0, 300) })}
            </p>
            <Button size="sm" type="button" variant="outline" onClick={canvas.reload}>
              {t("collab.canvas.retry")}
            </Button>
          </div>
        ) : (
          <>
            {canvas.error || !canEdit ? (
              <div className="space-y-2 px-3 pt-3">
                {canvas.error ? (
                  <CanvasNotice>{t("collab.canvas.liveStopped")}</CanvasNotice>
                ) : null}
                {channel.archived ? (
                  <CanvasNotice>{t("collab.canvas.archived")}</CanvasNotice>
                ) : !canEdit ? (
                  <CanvasNotice>{t("collab.canvas.managersOnly")}</CanvasNotice>
                ) : null}
              </div>
            ) : null}
            <div className={showHistory && canvas.head ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
              <CanvasDocument
                adoptHead={canvas.adoptHead}
                authorName={authorName}
                canEdit={canEdit}
                channelId={channelId}
                client={client}
                head={canvas.head}
                refreshHead={canvas.refreshHead}
              />
            </div>
            {showHistory && canvas.head ? (
              <CanvasHistory
                canRestore={canEdit}
                channelId={channelId}
                client={client}
                head={canvas.head}
                onRestore={restore}
              />
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
