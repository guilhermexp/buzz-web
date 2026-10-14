import type { ReactNode } from "react";
import { CanvasHeaderButton } from "@/features/canvas/ui/CanvasHeaderButton";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import { ForumChannelView } from "@/features/forums/ui/ForumChannelView";
import { PushNotificationBridge } from "@/features/push/ui/PushNotificationBridge";
import { RemindersHost } from "@/features/reminders/ui/RemindersHost";
import { HuddleDock } from "@/features/voice/ui/HuddleDock";
import { HuddleHeaderControl } from "@/features/voice/ui/HuddleHeaderControl";
import { HuddleSessionHost } from "@/features/voice/ui/HuddleSessionHost";

// Extension slots owned by feature folders. Each slot renders nothing when
// its features have nothing to show, so the chat shell stays feature-agnostic.

/** Controls added to the selected channel's header (e.g. Canvas, Huddle). */
export function ChannelHeaderExtras() {
  return (
    <>
      <HuddleHeaderControl />
      <CanvasHeaderButton />
    </>
  );
}

/** Surface above the selected channel's timeline (e.g. an active Huddle). */
export function ChannelSurfaceExtras() {
  return <HuddleDock />;
}

/** Bar above every full-surface tool view (e.g. the active Huddle's controls). */
export function ToolSurfaceExtras() {
  return <HuddleDock inTool />;
}

/**
 * Replacement for the selected channel's body (timeline, activity indicator,
 * typing row and composer), e.g. a forum view. The shell CALLS this function
 * (it is not rendered as an element) inside the WorkspaceProvider on every
 * render of the channel surface; keep it hook-free and return elements (which
 * may read `useWorkspace()`), or `null` to keep the timeline.
 */
export function ChannelBodyOverride({ channel }: { channel: BuzzChannel }): ReactNode | null {
  if (channel.type === "forum") return <ForumChannelView key={channel.id} />;
  return null;
}

/** Rendered once per workspace regardless of tool/channel (hosts, listeners). */
export function WorkspaceBackgroundExtras() {
  return (
    <>
      <RemindersHost />
      <PushNotificationBridge />
      <HuddleSessionHost />
    </>
  );
}
