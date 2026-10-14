import { useEffect, useSyncExternalStore } from "react";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { countDue } from "@/features/reminders/lib/reminder-codec";
import {
  getReminderStore,
  type ReminderSnapshot,
  type ReminderStore,
} from "@/features/reminders/lib/reminder-store";
import type { BuzzRelayClient } from "@/shared/api/relay-client";

export type ReminderSession = {
  client: BuzzRelayClient;
  store: ReminderStore;
  snapshot: ReminderSnapshot;
};

const subscribeNothing = () => () => undefined;
const getNothing = () => null;

/** The workspace's reminder store, retained (live subscription open) while mounted; null in demo. */
export function useReminderSession(): ReminderSession | null {
  const { client, demo, relayUrl, pubkey } = useWorkspace();
  const store = client && !demo && pubkey ? getReminderStore(relayUrl, pubkey) : null;
  useEffect(() => (store && client ? store.retain(client) : undefined), [store, client]);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNothing,
    store?.getSnapshot ?? getNothing,
  );
  return store && client && snapshot ? { client, store, snapshot } : null;
}

/**
 * Pending reminders whose `not_before` has passed (Inbox badge contribution).
 * Reads the workspace store without retaining it (RemindersHost owns the live
 * subscription), so the shell may call it outside the WorkspaceProvider.
 */
export function useDueReminderCount(relayUrl: string, pubkey: string | null): number {
  const store = pubkey ? getReminderStore(relayUrl, pubkey) : null;
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNothing,
    store?.getSnapshot ?? getNothing,
  );
  return snapshot ? countDue(snapshot.reminders, snapshot.now) : 0;
}
