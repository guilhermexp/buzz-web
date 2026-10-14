import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  type ActiveHuddle,
  isHuddleLive,
  reconstructActiveHuddle,
} from "@/features/voice/lib/huddle-presence";
import { type HuddleController, huddleControllerFor } from "@/features/voice/lib/huddle-session";
import {
  HUDDLE_LIFECYCLE_KINDS,
  type HuddleSnapshot,
  IDLE_HUDDLE,
  KIND_HUDDLE_LIVENESS,
} from "@/features/voice/lib/huddle-types";
import type { NostrEvent } from "@/shared/api/nostr-types";

const LIFECYCLE_LIMIT = 100;
const LIVENESS_REFRESH_MS = 30_000;
const noopSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE_HUDDLE;

/** The workspace's Huddle session (null in demo mode or before a Relay client exists). */
export function useHuddle(): { controller: HuddleController | null; snapshot: HuddleSnapshot } {
  const { client, demo, pubkey } = useWorkspace();
  const controller = useMemo(
    () => (client && !demo && pubkey ? huddleControllerFor(client, pubkey) : null),
    [client, demo, pubkey],
  );
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  return { controller, snapshot };
}

/**
 * The live huddle in `channelId`, from lifecycle events 48100–48103 checked
 * against the relay's 48104 liveness answer.
 */
export function useChannelHuddle(channelId: string | null): ActiveHuddle | null {
  const { client, demo } = useWorkspace();
  const [events, setEvents] = useState<Map<string, NostrEvent>>(() => new Map());
  const [liveSessions, setLiveSessions] = useState<Set<string> | null>(null);
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    setEvents(new Map());
    setLiveSessions(null);
    if (!client || demo || !channelId) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const refreshLiveness = () => {
      client.query({ kinds: [KIND_HUDDLE_LIVENESS], "#h": [channelId] }).then(
        (found) => {
          if (disposed) return;
          const sessions = new Set<string>();
          for (const event of found) {
            const session = event.tags.find((tag) => tag[0] === "d")?.[1];
            if (session) sessions.add(session);
          }
          setLiveSessions(sessions);
          setClock(Math.floor(Date.now() / 1000));
        },
        () => {
          if (!disposed) setLiveSessions(null);
        },
      );
    };
    void client
      .subscribe(
        { kinds: HUDDLE_LIFECYCLE_KINDS, "#h": [channelId], limit: LIFECYCLE_LIMIT },
        (event) => {
          if (disposed) return;
          setEvents((previous) => {
            if (previous.has(event.id)) return previous;
            const next = new Map(previous);
            next.set(event.id, event);
            return next;
          });
          setClock(Math.floor(Date.now() / 1000));
        },
        { onEose: refreshLiveness },
      )
      .then(
        (stop) => {
          if (disposed) stop();
          else unsubscribe = stop;
        },
        () => undefined,
      );
    const timer = window.setInterval(refreshLiveness, LIVENESS_REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [client, demo, channelId]);

  return useMemo(() => {
    const huddle = reconstructActiveHuddle(events.values());
    return huddle && isHuddleLive(huddle, liveSessions, clock) ? huddle : null;
  }, [events, liveSessions, clock]);
}
