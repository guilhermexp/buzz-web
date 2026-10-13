import { useCallback } from "react";
import { threadReference } from "@/features/chat/lib/chat-model";
import type { BuzzChannel, UserProfile } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import type { Reminder, ReminderTarget } from "@/features/reminders/lib/reminder-codec";
import { getLocale, t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";

const THREAD_LOOKUP_TIMEOUT_MS = 5_000;

export function formatRelativeSeconds(target: number, now: number): string {
  const seconds = target - now;
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function formatAbsoluteSeconds(seconds: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    seconds * 1_000,
  );
}

export function authorName(
  pubkey: string,
  profiles: Readonly<Record<string, UserProfile>>,
): string {
  return profiles[pubkey.toLowerCase()]?.name || truncatePubkey(pubkey);
}

/** `#channel`, `DM with …`, or "Unknown channel" for a reminder's target channel. */
export function reminderLocation(
  channelId: string,
  channels: readonly BuzzChannel[],
  profiles: Readonly<Record<string, UserProfile>>,
  currentPubkey: string,
): string {
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!channel) return t("collab.reminders.unknownChannel");
  if (channel.type !== "dm")
    return t("collab.reminders.channelLocation", { channel: channel.name });
  const names = channel.participantPubkeys
    .filter((pubkey) => pubkey.toLowerCase() !== currentPubkey.toLowerCase())
    .map((pubkey) => authorName(pubkey, profiles));
  return t("collab.reminders.dmLocation", { name: names.join(", ") || channel.name });
}

export function reminderHeadline(reminder: Reminder): string {
  return (
    reminder.content.target?.preview || reminder.content.note || t("collab.reminders.untitled")
  );
}

/**
 * Navigate to a reminder's target message. Targets carry no thread context
 * (Desktop shape), so the event is looked up to open its thread; a failed or
 * slow lookup degrades to a channel-level reveal, as on Desktop.
 */
export function useOpenReminderTarget(): (target: ReminderTarget) => Promise<void> {
  const { client, revealMessage } = useWorkspace();
  return useCallback(
    async (target: ReminderTarget) => {
      let threadRootId: string | null = null;
      if (client) {
        const timeout = new Promise<null>((resolve) =>
          window.setTimeout(() => resolve(null), THREAD_LOOKUP_TIMEOUT_MS),
        );
        const event = await Promise.race([
          client
            .query({ ids: [target.eventId], limit: 1 })
            .then((events) => events[0] ?? null)
            .catch(() => null),
          timeout,
        ]);
        if (event) threadRootId = threadReference(event).rootId;
      }
      revealMessage(target.channelId, target.eventId, threadRootId);
    },
    [client, revealMessage],
  );
}
