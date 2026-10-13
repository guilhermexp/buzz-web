import { BellPlus } from "lucide-react";
import type { TimelineMessage } from "@/features/chat/lib/chat-types";
import { useWorkspace } from "@/features/chat/lib/workspace-context";
import { reminderPreview } from "@/features/reminders/lib/reminder-codec";
import { openReminderDialog } from "@/features/reminders/lib/reminder-dialog-state";
import { t } from "@/shared/i18n";
import { canEncryptToSelf } from "@/shared/lib/nostr-signer";

/** "Remind me later" entry for a message's action menu; hidden without a Relay or NIP-44 signer. */
export function RemindMeMenuItem({
  message,
  channelId,
  onSelect,
}: {
  message: TimelineMessage;
  channelId: string;
  onSelect?: () => void;
}) {
  const { client, demo } = useWorkspace();
  if (!client || demo || message.deleted || message.delivery !== "sent" || !canEncryptToSelf()) {
    return null;
  }
  return (
    <button
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-foreground/6"
      role="menuitem"
      type="button"
      onClick={() => {
        onSelect?.();
        openReminderDialog({
          eventId: message.event.id,
          channelId,
          preview: reminderPreview(message.content),
          authorPubkey: message.event.pubkey,
        });
      }}
    >
      <BellPlus className="h-3.5 w-3.5 text-muted-foreground" />
      {t("collab.reminders.remindMeLater")}
    </button>
  );
}
