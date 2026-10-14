import { NotebookText } from "lucide-react";
import { useOpenCanvasChannelId } from "@/features/canvas/lib/canvas-panel-store";
import { CanvasPanel } from "@/features/canvas/ui/CanvasPanel";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { t } from "@/shared/i18n";

/**
 * Channel header toggle for the selected channel's canvas. Hidden for DMs
 * (Buzz Desktop offers no canvas there) and without a Relay connection
 * (demo mode has no canvas backend).
 */
export function CanvasHeaderButton() {
  const { client, demo, selectedChannel, showSidePanel } = useWorkspace();
  const openChannelId = useOpenCanvasChannelId();
  if (demo || !client || !selectedChannel || selectedChannel.type === "dm") return null;
  const open = openChannelId === selectedChannel.id;
  return (
    <button
      aria-label={t("collab.canvas.title")}
      aria-pressed={open}
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-foreground/65 transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-foreground/8 aria-pressed:text-foreground"
      title={t("collab.canvas.title")}
      type="button"
      onClick={() =>
        showSidePanel(
          open ? null : <CanvasPanel channelId={selectedChannel.id} key={selectedChannel.id} />,
        )
      }
    >
      <NotebookText aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
