import { Headphones, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { useChannelHuddle, useHuddle } from "@/features/voice/lib/use-huddle";
import { t } from "@/shared/i18n";

const HEADER_BUTTON =
  "relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-foreground/65 transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40";

/** Channel header control: start a huddle, or join the one already running here. */
export function HuddleHeaderControl() {
  const { selectedChannel } = useWorkspace();
  const { controller, snapshot } = useHuddle();
  const channelId = selectedChannel?.id ?? null;
  const activeHuddle = useChannelHuddle(channelId);
  const [pending, setPending] = useState(false);

  if (
    !controller ||
    !selectedChannel ||
    !channelId ||
    selectedChannel.archived ||
    !selectedChannel.isMember ||
    selectedChannel.type === "forum"
  ) {
    return null;
  }
  const inThisChannel = snapshot.phase !== "idle" && snapshot.parentChannelId === channelId;
  if (inThisChannel) return null;

  const busy = pending || snapshot.phase === "starting" || snapshot.phase === "joining";
  const run = async () => {
    if (busy) return;
    setPending(true);
    // Failures land in the session snapshot; HuddleDock announces them.
    try {
      if (controller.getSnapshot().phase !== "idle") await controller.leave();
      if (activeHuddle) await controller.join(channelId, activeHuddle.ephemeralChannelId);
      else await controller.start(channelId);
    } finally {
      setPending(false);
    }
  };

  if (activeHuddle) {
    const count = Math.max(1, activeHuddle.participants.length);
    return (
      <button
        aria-label={t("voice.joinHuddle")}
        className={`${HEADER_BUTTON} text-foreground`}
        disabled={busy}
        title={t("voice.huddleActive", { count })}
        type="button"
        onClick={() => void run()}
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Headphones className="h-4 w-4 text-[hsl(var(--buzz-positive))]" />
        )}
        <span className="text-[11px] font-medium leading-none">{t("voice.joinHuddle")}</span>
        <span aria-hidden="true" className="text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={t("voice.startHuddle")}
      className={HEADER_BUTTON}
      disabled={busy}
      title={t("voice.startHuddle")}
      type="button"
      onClick={() => void run()}
    >
      {busy ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <Headphones className="h-4 w-4" />
      )}
    </button>
  );
}
