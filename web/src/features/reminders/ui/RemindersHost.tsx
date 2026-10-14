import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import {
  hasNavigableTarget,
  type Reminder,
  type ReminderTarget,
} from "@/features/reminders/lib/reminder-codec";
import {
  claimDueRemindersExclusive,
  reminderWatermarkKey,
} from "@/features/reminders/lib/reminder-delivery";
import {
  closeReminderDialog,
  useReminderDialogTarget,
} from "@/features/reminders/lib/reminder-dialog-state";
import { useReminderSession } from "@/features/reminders/lib/use-reminders";
import { RemindMeDialog } from "@/features/reminders/ui/RemindMeDialog";
import {
  reminderHeadline,
  reminderLocation,
  useOpenReminderTarget,
} from "@/features/reminders/ui/reminder-presentation";
import { t } from "@/shared/i18n";

/** At most this many individual announcements per check; the rest are summarized. */
const MAX_ANNOUNCED = 3;
const DUE_TOAST_DURATION_MS = 15_000;

type Announcer = {
  locationOf: (channelId: string) => string;
  open: (target: ReminderTarget) => Promise<void>;
};

function showSystemNotification(title: string, body: string, tag: string, onClick: () => void) {
  // Only when the page is hidden (the toast covers a visible page) and the user
  // already granted permission; permission prompts belong to the Push surface.
  if (document.visibilityState === "visible") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow service-worker notifications; the in-app toast remains.
  }
}

function announce(due: readonly Reminder[], announcer: Announcer): void {
  for (const reminder of due.slice(0, MAX_ANNOUNCED)) {
    const target = reminder.content.target;
    const navigable = hasNavigableTarget(target);
    const title = navigable
      ? t("collab.reminders.dueTitleIn", { location: announcer.locationOf(target.channelId) })
      : t("collab.reminders.dueTitle");
    const body = reminderHeadline(reminder);
    const open = () => {
      if (navigable) void announcer.open(target);
    };
    toast(title, {
      id: `buzz-reminder-${reminder.id}`,
      description: body,
      duration: DUE_TOAST_DURATION_MS,
      ...(navigable ? { action: { label: t("collab.reminders.open"), onClick: open } } : {}),
    });
    showSystemNotification(title, body, `buzz-reminder-${reminder.id}`, open);
  }
  if (due.length > MAX_ANNOUNCED) {
    toast(t("collab.reminders.moreDue", { count: due.length - MAX_ANNOUNCED }), {
      duration: DUE_TOAST_DURATION_MS,
    });
  }
}

/**
 * Workspace-wide reminder runtime: keeps the author-private reminder
 * subscription open, announces each reminder once when it comes due (across
 * reloads and tabs, via a persisted watermark), and hosts the Remind-me dialog.
 */
export function RemindersHost() {
  const session = useReminderSession();
  const { relayUrl, pubkey, channels, profiles } = useWorkspace();
  const dialogTarget = useReminderDialogTarget();
  const openTarget = useOpenReminderTarget();
  const announcer = useRef<Announcer>({ locationOf: () => "", open: openTarget });
  announcer.current = {
    locationOf: (channelId) => reminderLocation(channelId, channels, profiles, pubkey),
    open: openTarget,
  };
  const snapshot = session?.snapshot ?? null;

  useEffect(() => {
    if (snapshot?.status !== "ready") return;
    const key = reminderWatermarkKey(relayUrl, pubkey);
    void claimDueRemindersExclusive(key, snapshot.reminders, snapshot.now).then((due) => {
      if (due.length) announce(due, announcer.current);
    });
  }, [snapshot, relayUrl, pubkey]);

  useEffect(() => closeReminderDialog, []);

  return session && dialogTarget ? (
    <RemindMeDialog session={session} target={dialogTarget} onClose={closeReminderDialog} />
  ) : null;
}
