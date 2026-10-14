import { lazy, Suspense } from "react";
import type { WorkspaceTool } from "@/features/chat/ui/WorkspaceToolPanel";

const WorkflowsView = lazy(() =>
  import("@/features/workflows/ui/WorkflowsView").then((module) => ({
    default: module.WorkflowsView,
  })),
);
const PulseView = lazy(() =>
  import("@/features/pulse/ui/PulseView").then((module) => ({ default: module.PulseView })),
);
const RemoteWorkspaceView = lazy(() =>
  import("@/features/remote/ui/RemoteWorkspaceView").then((module) => ({
    default: module.RemoteWorkspaceView,
  })),
);

/** Feature-owned workspace tools; they read session services from `useWorkspace()`. */
export function FeatureToolView({ tool, onClose }: { tool: WorkspaceTool; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      {tool === "workflows" ? (
        <WorkflowsView onClose={onClose} />
      ) : tool === "pulse" ? (
        <PulseView onClose={onClose} />
      ) : tool === "remote" ? (
        <RemoteWorkspaceView onClose={onClose} />
      ) : null}
    </Suspense>
  );
}
