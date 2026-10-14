import { useEffect, useSyncExternalStore } from "react";

/**
 * Which channel's canvas panel is mounted in the shell's side-panel slot. The
 * shell owns that slot and may replace the panel at any time (thread, details,
 * another feature), so the mounted panel itself is the source of truth for the
 * header button's pressed state.
 */
let openChannelId: string | null = null;
const listeners = new Set<() => void>();

function setOpenChannelId(value: string | null) {
  openChannelId = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpenCanvasChannelId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => openChannelId,
    () => null,
  );
}

/** Registers the mounted panel for `channelId` until it unmounts. */
export function useRegisterOpenCanvas(channelId: string) {
  useEffect(() => {
    setOpenChannelId(channelId);
    return () => {
      if (openChannelId === channelId) setOpenChannelId(null);
    };
  }, [channelId]);
}
