import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { WorkspaceTool } from "@/features/chat/ui/WorkspaceToolPanel";

/**
 * Which surface owns the workspace's main and right-hand areas. Tools replace
 * the conversation; thread, channel details, agent activity and feature side
 * panels are mutually exclusive right-hand panels.
 */
export type WorkspacePanels = {
  activeTool: WorkspaceTool | null;
  threadRootId: string | null;
  threadReplyTargetId: string | null;
  focusedMessageId: string | null;
  channelDetailsOpen: boolean;
  activityPanelOpen: boolean;
  mobileNavigationOpen: boolean;
  sidePanel: ReactNode | null;
};

const CLOSED: WorkspacePanels = {
  activeTool: null,
  threadRootId: null,
  threadReplyTargetId: null,
  focusedMessageId: null,
  channelDetailsOpen: false,
  activityPanelOpen: false,
  mobileNavigationOpen: false,
  sidePanel: null,
};

export function useWorkspacePanels() {
  const [panels, setPanels] = useState<WorkspacePanels>(CLOSED);

  const toggleTool = useCallback((tool: WorkspaceTool) => {
    setPanels((current) => ({
      ...CLOSED,
      activeTool: current.activeTool === tool ? null : tool,
      sidePanel: current.sidePanel,
    }));
  }, []);
  const openTool = useCallback((tool: WorkspaceTool) => {
    setPanels((current) => ({ ...CLOSED, activeTool: tool, sidePanel: current.sidePanel }));
  }, []);
  const closeTool = useCallback(() => {
    setPanels((current) => ({ ...current, activeTool: null }));
  }, []);

  const actions = useMemo(
    () => ({
      toggleTool,
      openTool,
      closeTool,
      /** A channel change resets every panel; the conversation is new. */
      resetForChannel: () => setPanels(CLOSED),
      showMessages: () =>
        setPanels((current) => ({
          ...current,
          activeTool: null,
          channelDetailsOpen: false,
          activityPanelOpen: false,
          mobileNavigationOpen: false,
          focusedMessageId: null,
        })),
      reveal: (eventId: string, threadRootId: string | null) =>
        setPanels({ ...CLOSED, threadRootId, focusedMessageId: eventId }),
      openThread: (rootId: string, replyTargetId: string | null) =>
        setPanels({ ...CLOSED, threadRootId: rootId, threadReplyTargetId: replyTargetId }),
      closeThread: () =>
        setPanels((current) => ({
          ...current,
          threadRootId: null,
          threadReplyTargetId: null,
          focusedMessageId: null,
        })),
      toggleChannelDetails: () =>
        setPanels((current) => ({
          ...CLOSED,
          channelDetailsOpen: !current.channelDetailsOpen,
        })),
      closeChannelDetails: () =>
        setPanels((current) => ({ ...current, channelDetailsOpen: false })),
      openActivityPanel: () => setPanels({ ...CLOSED, activityPanelOpen: true }),
      closeActivityPanel: () => setPanels((current) => ({ ...current, activityPanelOpen: false })),
      setMobileNavigationOpen: (mobileNavigationOpen: boolean) =>
        setPanels((current) => ({ ...current, mobileNavigationOpen })),
      showSidePanel: (sidePanel: ReactNode | null) =>
        setPanels((current) => (sidePanel ? { ...CLOSED, sidePanel } : { ...current, sidePanel })),
    }),
    [closeTool, openTool, toggleTool],
  );

  return { panels, ...actions };
}
