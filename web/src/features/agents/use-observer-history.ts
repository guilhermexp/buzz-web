import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ArchivedFrame,
  archiveAvailable,
  archiveScope,
  clearArchive,
  pruneFrames,
  readFrames,
  readRetentionDays,
  subscribeArchive,
  writeRetentionDays,
} from "@/features/agents/lib/observer-archive";
import {
  buildObservedSessions,
  type ObservedSession,
} from "@/features/agents/lib/observer-sessions";
import { useWorkspace } from "@/features/chat/lib/workspace-context";

export type ObserverHistory = {
  available: boolean;
  loading: boolean;
  error: boolean;
  sessions: ObservedSession[];
  frameCount: number;
  retentionDays: number;
  setRetentionDays: (days: number) => void;
  clear: () => Promise<void>;
};

/**
 * Sessions/turns reconstructed from frames this browser archived while observing live. Only
 * channels the owner can currently see are shown, so lost channel access hides stale history.
 */
export function useObserverHistory(agentPubkey: string | null): ObserverHistory {
  const { relayUrl, pubkey, channels, demo } = useWorkspace();
  const scope = archiveScope(relayUrl, pubkey);
  const available = !demo && archiveAvailable();
  const [frames, setFrames] = useState<ArchivedFrame[]>([]);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState(false);
  const [retentionDays, setRetention] = useState(() => readRetentionDays(scope));

  useEffect(() => {
    setRetention(readRetentionDays(scope));
  }, [scope]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const load = () => {
      readFrames(scope, retentionDays)
        .then((next) => {
          if (cancelled) return;
          setFrames(next);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const unsubscribe = subscribeArchive(scope, load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [available, retentionDays, scope]);

  const visibleChannels = useMemo(() => new Set(channels.map((channel) => channel.id)), [channels]);
  const sessions = useMemo(
    () =>
      buildObservedSessions(
        frames.filter(
          (frame) =>
            (agentPubkey === null || frame.agentPubkey === agentPubkey) &&
            visibleChannels.has(frame.channelId),
        ),
      ),
    [agentPubkey, frames, visibleChannels],
  );

  const setRetentionDays = useCallback(
    (days: number) => {
      writeRetentionDays(scope, days);
      setRetention(days);
      void pruneFrames(scope, days).catch(() => setError(true));
    },
    [scope],
  );

  const clear = useCallback(async () => {
    await clearArchive(scope);
  }, [scope]);

  return {
    available,
    loading,
    error,
    sessions,
    frameCount: frames.length,
    retentionDays,
    setRetentionDays,
    clear,
  };
}
