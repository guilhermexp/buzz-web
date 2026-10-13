import { useSyncExternalStore } from "react";
import type { ReminderTarget } from "@/features/reminders/lib/reminder-codec";

let dialogTarget: ReminderTarget | null = null;
const listeners = new Set<() => void>();

function setDialogTarget(target: ReminderTarget | null): void {
  dialogTarget = target;
  for (const listener of listeners) listener();
}

/** Open the workspace's "Remind me later" dialog (rendered by RemindersHost). */
export function openReminderDialog(target: ReminderTarget): void {
  setDialogTarget(target);
}

export function closeReminderDialog(): void {
  setDialogTarget(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReminderDialogTarget(): ReminderTarget | null {
  return useSyncExternalStore(subscribe, () => dialogTarget);
}
